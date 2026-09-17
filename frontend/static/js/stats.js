/* ==========================================================
   stats.js - painel de estatisticas do PET Cassino
   Depende de base.js (formataDinheiro, mostrarErro, baseUrl)
   ========================================================== */

const INTERVALO_ATUALIZACAO = 15000;   // 15s
const LIMITE_RODADAS = 14;             // rodadas mostradas por jogo
const LIMITE_APOSTAS = 40;             // linhas na tabela de apostas

let timerAtualizacao = null;
let carregando = false;
let mapaJogadores = {};                // id -> objeto do jogador

/* ---------- utilidades ---------- */

function urlAPI() {
    const ip = localStorage.getItem("pet_api_ip");
    if (ip) return `http://${ip}`;
    return typeof baseUrl === "string" && baseUrl ? baseUrl : "";
}

async function pegar(caminho) {
    const resposta = await fetch(urlAPI() + caminho);
    if (!resposta.ok) throw new Error(`${caminho} respondeu ${resposta.status}`);
    return resposta.json();
}

// Busca que nao derruba a tela toda se um endpoint falhar.
async function pegarOuVazio(caminho, padrao) {
    try {
        const dados = await pegar(caminho);
        return dados ?? padrao;
    } catch (erro) {
        console.warn(erro);
        return padrao;
    }
}

// A API pode devolver uma lista direta ou algo como { items: [...] }.
function comoLista(dados) {
    if (Array.isArray(dados)) return dados;
    if (!dados || typeof dados !== "object") return [];
    for (const chave of ["items", "results", "data", "players", "games", "statistics"]) {
        if (Array.isArray(dados[chave])) return dados[chave];
    }
    return [];
}

// Le o primeiro campo existente entre varios nomes possiveis.
function campo(obj, nomes, padrao = null) {
    if (!obj) return padrao;
    for (const nome of nomes) {
        const valor = obj[nome];
        if (valor !== undefined && valor !== null && valor !== "") return valor;
    }
    return padrao;
}

function numero(valor) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
}

function dinheiro(valor) {
    return formataDinheiro(numero(valor));
}

function dinheiroComSinal(valor) {
    const n = numero(valor);
    return (n > 0 ? "+" : "") + formataDinheiro(n);
}

function classeSinal(valor) {
    const n = numero(valor);
    if (n > 0) return "positivo";
    if (n < 0) return "negativo";
    return "neutro";
}

function dataDe(obj, nomes) {
    const bruto = campo(obj, nomes);
    if (!bruto) return null;
    const d = new Date(bruto);
    return isNaN(d.getTime()) ? null : d;
}

function horaCurta(data) {
    if (!data) return "—";
    const hoje = new Date();
    const mesmoDia = data.toDateString() === hoje.toDateString();
    return mesmoDia
        ? data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
        : data.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function idCurto(valor) {
    const texto = String(valor ?? "");
    return texto.length > 8 ? "#" + texto.slice(-6) : "#" + texto;
}

function escapar(texto) {
    return String(texto ?? "").replace(/[&<>"']/g, c => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

function nomeDoJogador(id) {
    const jogador = mapaJogadores[String(id)];
    return jogador ? campo(jogador, ["name", "player_name", "nome"], idCurto(id)) : idCurto(id);
}

/* ---------- traducoes ---------- */

const NOMES_STATUS = {
    created: "Criada",
    waiting: "Aguardando",
    open: "Aberta",
    pending: "Pendente",
    running: "Em andamento",
    started: "Em andamento",
    in_progress: "Em andamento",
    closed: "Fechada",
    finished: "Encerrada",
    ended: "Encerrada",
    done: "Encerrada",
    crashed: "Explodiu",
    cancelled: "Cancelada",
    canceled: "Cancelada"
};

const NOMES_JOGOS = {
    roulette: "Roleta",
    roleta: "Roleta",
    crash: "Crash",
    coinflip: "Cara ou coroa",
    coin_flip: "Cara ou coroa",
    slots: "Caça-níquel",
    slot: "Caça-níquel",
    slot_machine: "Caça-níquel",
    caca_niquel: "Caça-níquel",
    blackjack: "Blackjack",
    dice: "Dados"
};

function traduzStatus(status) {
    const chave = String(status ?? "").toLowerCase().trim();
    if (!chave || chave === "—") return "—";
    return NOMES_STATUS[chave] || (chave.charAt(0).toUpperCase() + chave.slice(1));
}

function traduzJogo(jogo) {
    const chave = String(jogo ?? "").toLowerCase().trim();
    if (!chave) return "—";
    return NOMES_JOGOS[chave] || (chave.charAt(0).toUpperCase() + chave.slice(1));
}

/* ---------- leitura de campos numericos das rodadas ---------- */

// Procura um numero valido no objeto, mesmo que a API use outro nome de campo
// ou devolva o valor dentro de um objeto aninhado (ex.: { result: { number: 7 } }).
function procuraNumero(obj, nomesConhecidos, padraoChave, valido) {
    if (!obj || typeof obj !== "object") return null;

    // null, undefined, "" e booleanos viram numero em JS; aqui eles nao contam.
    const paraNumero = valor => {
        if (valor === null || valor === undefined || valor === "" || typeof valor === "boolean") return null;
        const n = Number(valor);
        return Number.isFinite(n) ? n : null;
    };

    for (const nome of nomesConhecidos) {
        const n = paraNumero(obj[nome]);
        if (n !== null && valido(n)) return n;
    }

    for (const [chave, valor] of Object.entries(obj)) {
        if (!padraoChave.test(chave)) continue;
        const n = paraNumero(valor);
        if (n !== null && valido(n)) return n;
        if (valor && typeof valor === "object") {
            const aninhado = procuraNumero(valor, nomesConhecidos, padraoChave, valido);
            if (aninhado !== null) return aninhado;
        }
    }
    return null;
}

function numeroSorteado(jogo) {
    return procuraNumero(
        jogo,
        ["drawn_number", "number_drawn", "winning_number", "drawn", "number", "result", "result_number", "roulette_number", "numero_sorteado"],
        /(draw|number|numero|result|resultado|winning|sorte)/i,
        n => Number.isInteger(n) && n >= 0 && n <= 36
    );
}

function pontoCrash(jogo) {
    return procuraNumero(
        jogo,
        ["crash_point", "crash_multiplier", "crash_value", "multiplier", "point", "result", "resultado"],
        /(crash|multipl|point|ponto|result|resultado)/i,
        n => n > 0 && n < 100000
    );
}

// Algumas APIs so trazem o resultado no detalhe da rodada, nao na listagem.
async function completarRodadas(rodadas, caminho, leitor) {
    const faltando = rodadas.filter(j => leitor(j) === null && campo(j, ["id"]) !== null);
    if (!faltando.length) return rodadas;

    const detalhes = await Promise.all(
        faltando.map(j => pegarOuVazio(`${caminho}/${campo(j, ["id"])}`, null))
    );

    const mapa = {};
    detalhes.forEach(d => { if (d) mapa[String(campo(d, ["id"]))] = d; });

    return rodadas.map(j => {
        const detalhe = mapa[String(campo(j, ["id"]))];
        return detalhe ? { ...j, ...detalhe } : j;
    });
}

/* ---------- filtros ---------- */

function periodoSelecionado() {
    const dias = document.getElementById("filtro-periodo").value;
    if (!dias) return {};
    const inicio = new Date();
    inicio.setDate(inicio.getDate() - Number(dias) + 1);
    inicio.setHours(0, 0, 0, 0);
    return { start: inicio.toISOString(), end: new Date().toISOString() };
}

function parametrosEstatisticas() {
    const params = new URLSearchParams();
    const jogo = document.getElementById("filtro-jogo").value;
    const dispositivo = document.getElementById("filtro-dispositivo").value;
    const { start, end } = periodoSelecionado();

    if (jogo) params.set("game", jogo);
    if (dispositivo) params.set("device", dispositivo);
    if (start) params.set("start", start);
    if (end) params.set("end", end);

    const texto = params.toString();
    return texto ? "?" + texto : "";
}

/* ---------- roleta ---------- */

const VERMELHOS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

function corDaRoleta(n) {
    if (n === null || n === undefined || n === "") return "pendente";
    const num = Number(n);
    if (!Number.isFinite(num)) return "pendente";
    if (num === 0) return "verde";
    return VERMELHOS.has(num) ? "vermelho" : "preto";
}

async function renderizarRoleta(jogos) {
    const fita = document.getElementById("roleta-numeros");
    const barra = document.getElementById("roleta-cores");
    const lista = document.getElementById("roleta-lista");
    const nota = document.getElementById("roleta-nota");

    const ordenados = [...jogos].sort((a, b) => {
        const da = dataDe(a, ["game_start_time", "start_time", "created_at"]);
        const db = dataDe(b, ["game_start_time", "start_time", "created_at"]);
        return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
    });

    let recentes = ordenados.slice(0, LIMITE_RODADAS);
    nota.innerText = `${jogos.length} rodada(s) registradas`;

    if (!recentes.length) {
        fita.innerHTML = '<p class="vazio">Nenhuma rodada de roleta ainda.</p>';
        barra.innerHTML = "";
        lista.innerHTML = "";
        return;
    }

    // A listagem pode nao trazer o numero sorteado; nesse caso busca o detalhe.
    recentes = await completarRodadas(recentes, "/roulette/games", numeroSorteado);
    if (numeroSorteado(recentes[0]) === null) {
        console.debug("Campos da rodada de roleta:", Object.keys(recentes[0]), recentes[0]);
    }

    fita.innerHTML = recentes.map(jogo => {
        const n = numeroSorteado(jogo);
        const cor = corDaRoleta(n);
        return `<div class="bola ${cor}" title="Rodada ${escapar(idCurto(campo(jogo, ["id"])))}">${escapar(n === null ? "?" : n)}</div>`;
    }).join("");

    // proporcao de cores nas rodadas ja sorteadas
    const contagem = { vermelho: 0, preto: 0, verde: 0 };
    ordenados.forEach(jogo => {
        const cor = corDaRoleta(numeroSorteado(jogo));
        if (cor in contagem) contagem[cor]++;
    });
    const total = contagem.vermelho + contagem.preto + contagem.verde;
    barra.innerHTML = total
        ? `<div class="fatia-vermelho" style="width:${(contagem.vermelho / total) * 100}%" title="Vermelho: ${contagem.vermelho}"></div>
           <div class="fatia-preto" style="width:${(contagem.preto / total) * 100}%" title="Preto: ${contagem.preto}"></div>
           <div class="fatia-verde" style="width:${(contagem.verde / total) * 100}%" title="Zero: ${contagem.verde}"></div>`
        : "";

    lista.innerHTML = recentes.map(jogo => {
        const n = numeroSorteado(jogo);
        const status = String(campo(jogo, ["status"], "—")).toLowerCase();
        const data = dataDe(jogo, ["game_start_time", "start_time", "created_at"]);
        const cor = corDaRoleta(n);
        return `<li>
            <span class="rodada-id">${escapar(idCurto(campo(jogo, ["id"])))}
                <span class="rodada-hora">· ${escapar(horaCurta(data))}</span>
            </span>
            <span class="etiqueta ${escapar(status)}">${escapar(traduzStatus(status))}</span>
            <span class="bola ${cor}">${escapar(n === null ? "?" : n)}</span>
        </li>`;
    }).join("");
}

/* ---------- crash ---------- */

async function renderizarCrash(jogos) {
    const grafico = document.getElementById("crash-grafico");
    const lista = document.getElementById("crash-lista");
    const nota = document.getElementById("crash-nota");

    const ordenados = [...jogos].sort((a, b) => {
        const da = dataDe(a, ["game_start_time", "start_time", "created_at"]);
        const db = dataDe(b, ["game_start_time", "start_time", "created_at"]);
        return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
    });

    let recentes = ordenados.slice(0, LIMITE_RODADAS);

    if (!recentes.length) {
        grafico.innerHTML = '<p class="vazio">Nenhuma rodada de crash ainda.</p>';
        lista.innerHTML = "";
        nota.innerText = "0 rodada(s)";
        return;
    }

    recentes = await completarRodadas(recentes, "/crash/games", pontoCrash);
    if (pontoCrash(recentes[0]) === null) {
        console.debug("Campos da rodada de crash:", Object.keys(recentes[0]), recentes[0]);
    }

    const pontos = recentes.map(pontoCrash).filter(p => p !== null);
    const media = pontos.length ? pontos.reduce((a, b) => a + b, 0) / pontos.length : 0;
    nota.innerText = pontos.length
        ? `${jogos.length} rodada(s) · média ${media.toFixed(2)}x`
        : `${jogos.length} rodada(s)`;

    const maior = Math.max(1, ...pontos);
    grafico.innerHTML = [...recentes].reverse().map(jogo => {
        const p = pontoCrash(jogo);
        const altura = p !== null ? Math.max(4, (p / maior) * 100) : 4;
        const classe = p === null ? "" : p >= 5 ? "alta" : p >= 2 ? "media" : "";
        return `<div class="coluna-crash ${classe}" style="height:${altura}%" title="${p !== null ? p.toFixed(2) + "x" : "Em andamento"}">
                    <span>${p !== null ? p.toFixed(1) + "x" : "—"}</span>
                </div>`;
    }).join("");

    lista.innerHTML = recentes.map(jogo => {
        const p = pontoCrash(jogo);
        const status = String(campo(jogo, ["status"], "—")).toLowerCase();
        const data = dataDe(jogo, ["game_start_time", "start_time", "created_at"]);
        const classe = p === null ? "neutro" : p >= 2 ? "positivo" : "negativo";
        return `<li>
            <span class="rodada-id">${escapar(idCurto(campo(jogo, ["id"])))}
                <span class="rodada-hora">· ${escapar(horaCurta(data))}</span>
            </span>
            <span class="etiqueta ${escapar(status)}">${escapar(traduzStatus(status))}</span>
            <span class="rodada-valor ${classe}">${p !== null ? p.toFixed(2) + "x" : "—"}</span>
        </li>`;
    }).join("");
}

/* ---------- apostas ---------- */

function renderizarApostas(linhas) {
    const corpo = document.getElementById("tabela-apostas");
    const nota = document.getElementById("apostas-nota");

    const ordenadas = [...linhas].sort((a, b) => {
        const da = dataDe(a, ["created_at", "timestamp", "date", "time"]);
        const db = dataDe(b, ["created_at", "timestamp", "date", "time"]);
        return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
    }).slice(0, LIMITE_APOSTAS);

    nota.innerText = `${linhas.length} aposta(s) no período`;

    if (!ordenadas.length) {
        corpo.innerHTML = '<tr><td colspan="6" class="vazio">Nenhuma aposta no período escolhido.</td></tr>';
        return;
    }

    corpo.innerHTML = ordenadas.map(linha => {
        const aposta = numero(campo(linha, ["bet", "bet_amount", "amount"], 0));
        const ganho = numero(campo(linha, ["win", "win_amount", "payout"], 0));
        const resultado = ganho - aposta;
        const idJogador = campo(linha, ["player", "player_id"]);
        const nome = campo(linha, ["player_name"], null) || nomeDoJogador(idJogador);
        const jogo = campo(linha, ["game", "game_type"], "—");
        const data = dataDe(linha, ["created_at", "timestamp", "date", "time"]);

        return `<tr>
            <td class="hora">${escapar(horaCurta(data))}</td>
            <td class="jogador">${escapar(nome)}</td>
            <td><span class="pilula">${escapar(traduzJogo(jogo))}</span></td>
            <td class="num">${escapar(dinheiro(aposta))}</td>
            <td class="num">${escapar(dinheiro(ganho))}</td>
            <td class="num ${classeSinal(resultado)}">${escapar(dinheiroComSinal(resultado))}</td>
        </tr>`;
    }).join("");
}

/* ---------- ranking de jogadores ---------- */

function renderizarJogadores(linhas, jogadores) {
    const corpo = document.getElementById("tabela-jogadores");
    const agregado = {};

    linhas.forEach(linha => {
        const idJogador = String(campo(linha, ["player", "player_id"], "?"));
        if (!agregado[idJogador]) {
            agregado[idJogador] = { apostas: 0, apostado: 0, recebido: 0 };
        }
        agregado[idJogador].apostas += 1;
        agregado[idJogador].apostado += numero(campo(linha, ["bet", "bet_amount", "amount"], 0));
        agregado[idJogador].recebido += numero(campo(linha, ["win", "win_amount", "payout"], 0));
    });

    const itens = Object.entries(agregado).map(([id, dados]) => {
        const jogador = mapaJogadores[id];
        return {
            nome: nomeDoJogador(id),
            dispositivo: jogador ? campo(jogador, ["device"], "") : "",
            saldo: jogador ? numero(campo(jogador, ["current_currency", "balance"], 0)) : null,
            ...dados,
            resultado: dados.recebido - dados.apostado
        };
    }).sort((a, b) => b.resultado - a.resultado);

    if (!itens.length) {
        corpo.innerHTML = '<tr><td colspan="6" class="vazio">Nenhum jogador apostou no período escolhido.</td></tr>';
        return;
    }

    corpo.innerHTML = itens.map(item => `
        <tr>
            <td class="jogador">${escapar(item.nome)}
                ${item.dispositivo ? `<span class="pilula">${escapar(item.dispositivo)}</span>` : ""}
            </td>
            <td class="num">${item.apostas}</td>
            <td class="num">${escapar(dinheiro(item.apostado))}</td>
            <td class="num">${escapar(dinheiro(item.recebido))}</td>
            <td class="num ${classeSinal(item.resultado)}">${escapar(dinheiroComSinal(item.resultado))}</td>
            <td class="num">${item.saldo === null ? "—" : escapar(dinheiro(item.saldo))}</td>
        </tr>
    `).join("");
}

/* ---------- KPIs ---------- */

function renderizarKPIs(resumo, linhas, jogadores) {
    // Usa o /statistics/summary quando ele traz os totais; senao soma as linhas.
    let apostado = numero(campo(resumo, ["total_bet", "bet", "total_bets", "sum_bet"], NaN));
    let pago = numero(campo(resumo, ["total_win", "win", "total_wins", "sum_win"], NaN));
    let rodadas = numero(campo(resumo, ["count", "total", "rounds", "plays"], NaN));

    if (!campo(resumo, ["total_bet", "bet", "total_bets", "sum_bet"])) {
        apostado = linhas.reduce((soma, l) => soma + numero(campo(l, ["bet", "bet_amount", "amount"], 0)), 0);
    }
    if (!campo(resumo, ["total_win", "win", "total_wins", "sum_win"])) {
        pago = linhas.reduce((soma, l) => soma + numero(campo(l, ["win", "win_amount", "payout"], 0)), 0);
    }
    if (!Number.isFinite(rodadas) || !rodadas) rodadas = linhas.length;

    const lucro = apostado - pago;
    const retorno = apostado > 0 ? (pago / apostado) * 100 : 0;

    const cartaoLucro = document.querySelector(".kpi.destaque");
    cartaoLucro.classList.toggle("positivo", lucro >= 0);
    cartaoLucro.classList.toggle("negativo", lucro < 0);

    document.getElementById("kpi-lucro").innerText = dinheiroComSinal(lucro);
    document.getElementById("kpi-lucro").className = "kpi-valor " + classeSinal(lucro);
    document.getElementById("kpi-lucro-nota").innerText =
        lucro >= 0 ? "A casa está no lucro" : "Os jogadores estão à frente";

    document.getElementById("kpi-apostado").innerText = dinheiro(apostado);
    document.getElementById("kpi-rodadas").innerText = `${rodadas} aposta(s)`;

    document.getElementById("kpi-pago").innerText = dinheiro(pago);
    document.getElementById("kpi-retorno").innerText = `Retorno ao jogador: ${retorno.toFixed(1)}%`;

    const idsAtivos = new Set(linhas.map(l => String(campo(l, ["player", "player_id"], "?"))));
    document.getElementById("kpi-jogadores").innerText = jogadores.length;
    document.getElementById("kpi-jogadores-nota").innerText = `${idsAtivos.size} jogaram no período`;

    const saldoTotal = jogadores.reduce((soma, j) => soma + numero(campo(j, ["current_currency", "balance"], 0)), 0);
    document.getElementById("kpi-saldo").innerText = dinheiro(saldoTotal);
    const media = jogadores.length ? saldoTotal / jogadores.length : 0;
    document.getElementById("kpi-saldo-nota").innerText = `Média de ${dinheiro(media)} por conta`;
}

/* ---------- filtros dinamicos ---------- */

function preencherSelect(id, valores, rotulo = v => v) {
    const select = document.getElementById(id);
    const escolhido = select.value;
    const primeira = select.options[0] ? select.options[0].outerHTML : "";
    select.innerHTML = primeira + valores.map(v =>
        `<option value="${escapar(v)}">${escapar(rotulo(v))}</option>`
    ).join("");
    if (valores.includes(escolhido)) select.value = escolhido;
}

/* ---------- carga principal ---------- */

async function carregarEstatisticas() {
    if (carregando) return;
    if (!urlAPI()) {
        mostrarErro("Configure o IP da API no botão ⚙️ para ver as estatísticas.");
        return;
    }

    carregando = true;
    const botao = document.getElementById("btn-atualizar");
    botao.disabled = true;

    try {
        const filtros = parametrosEstatisticas();

        const [jogadores, linhas, resumo, roleta, crash, jogos] = await Promise.all([
            pegarOuVazio("/players", []),
            pegarOuVazio("/statistics" + filtros, []),
            pegarOuVazio("/statistics/summary" + filtros, {}),
            pegarOuVazio("/roulette/games", []),
            pegarOuVazio("/crash/games", []),
            pegarOuVazio("/games", [])
        ]);

        const listaJogadores = comoLista(jogadores);
        const listaLinhas = comoLista(linhas);

        mapaJogadores = {};
        listaJogadores.forEach(j => { mapaJogadores[String(campo(j, ["id"]))] = j; });

        preencherSelect("filtro-jogo", comoLista(jogos).map(g =>
            typeof g === "string" ? g : campo(g, ["name", "game", "id"], "")
        ).filter(Boolean), traduzJogo);

        preencherSelect("filtro-dispositivo", [...new Set(
            listaJogadores.map(j => campo(j, ["device"], "")).filter(Boolean)
        )].sort());

        renderizarKPIs(resumo, listaLinhas, listaJogadores);
        await Promise.all([
            renderizarRoleta(comoLista(roleta)),
            renderizarCrash(comoLista(crash))
        ]);
        renderizarApostas(listaLinhas);
        renderizarJogadores(listaLinhas, listaJogadores);

        document.getElementById("stats-atualizado").innerText =
            "Atualizado às " + new Date().toLocaleTimeString("pt-BR");
    } catch (erro) {
        console.error(erro);
        mostrarErro("Não foi possível carregar as estatísticas. Verifique a API.");
    } finally {
        carregando = false;
        botao.disabled = false;
    }
}

/* ---------- auto atualizacao ---------- */

function ajustarAutoAtualizacao() {
    const ligado = document.getElementById("auto-atualizar").checked;
    if (timerAtualizacao) { clearInterval(timerAtualizacao); timerAtualizacao = null; }
    if (ligado) timerAtualizacao = setInterval(carregarEstatisticas, INTERVALO_ATUALIZACAO);
}

document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        if (timerAtualizacao) { clearInterval(timerAtualizacao); timerAtualizacao = null; }
    } else {
        ajustarAutoAtualizacao();
        carregarEstatisticas();
    }
});

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("btn-atualizar").addEventListener("click", carregarEstatisticas);
    document.getElementById("filtro-jogo").addEventListener("change", carregarEstatisticas);
    document.getElementById("filtro-periodo").addEventListener("change", carregarEstatisticas);
    document.getElementById("filtro-dispositivo").addEventListener("change", carregarEstatisticas);
    document.getElementById("auto-atualizar").addEventListener("change", ajustarAutoAtualizacao);

    carregarEstatisticas();
    ajustarAutoAtualizacao();
});
