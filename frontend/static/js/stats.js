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

// Busca TODAS as linhas de /statistics, pagina por pagina.
// A API devolve no maximo 1000 linhas por chamada (padrao: 100),
// entao sem isso o painel so enxergava as 100 apostas mais recentes.
async function pegarTodasEstatisticas(filtros) {
    const TAM_PAGINA = 1000;
    const separador = filtros ? "&" : "?";
    let todas = [];
    let offset = 0;
    try {
        while (true) {
            const pagina = await pegar(`/statistics${filtros}${separador}limit=${TAM_PAGINA}&offset=${offset}`);
            const linhas = comoLista(pagina);
            todas = todas.concat(linhas);
            const total = Number(pagina?.total);
            offset += linhas.length;
            if (linhas.length < TAM_PAGINA || (Number.isFinite(total) && offset >= total)) break;
        }
    } catch (erro) {
        console.warn(erro);
    }
    return todas;
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
        ? `${jogos.length} rodada(s)`
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
    let rodadas = numero(campo(resumo, ["rounds_played", "count", "total", "rounds", "plays"], NaN));

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

/* ---------- navbar do base.html ---------- */

// Seletores prováveis da navbar herdada de base.html. Ajuste aqui se a sua for diferente.
const SELETORES_NAVBAR = ["#navbar", ".navbar", "nav", ".topbar", ".top-bar", "body > header"];

function ocultarNavbar() {
    document.querySelectorAll(SELETORES_NAVBAR.join(",")).forEach(el => {
        if (el.closest(".stats-page")) return;
        el.classList.add("navbar-oculta");
    });
}

/* ---------- caixa da casa (grafico de velas) ---------- */

const INTERVALOS_AUTO = [60e3, 300e3, 900e3, 1800e3, 3600e3, 14400e3, 86400e3];
const VELAS_ALVO = 70;

let linhasCaixa = [];
let tipoGrafico = "velas";
let geo = null;   // geometria do ultimo desenho, usada pela mira e pela dica

const fmtCompacto = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

function formatoEixo(valor, casas) {
    if (Math.abs(valor) >= 100000) return fmtCompacto.format(valor);
    return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(valor);
}

function rotuloIntervalo(ms) {
    if (ms >= 86400e3) return `${Math.round(ms / 86400e3)} dia(s)`;
    if (ms >= 3600e3) return `${Math.round(ms / 3600e3)} h`;
    return `${Math.round(ms / 60e3)} min`;
}

function escolherIntervalo(pontos) {
    const escolhido = document.getElementById("caixa-intervalo").value;
    if (escolhido !== "auto") return Number(escolhido);
    if (pontos.length < 2) return INTERVALOS_AUTO[0];
    const duracao = pontos[pontos.length - 1].t - pontos[0].t;
    return INTERVALOS_AUTO.find(iv => duracao / iv <= VELAS_ALVO) || INTERVALOS_AUTO[INTERVALOS_AUTO.length - 1];
}

// Cada vela guarda o caixa acumulado: abertura, maxima, minima e fechamento.
function construirVelas(pontos, intervalo) {
    const desvio = new Date().getTimezoneOffset() * 60000;   // agrupa pelo horario local
    const velas = [];
    let acumulado = 0;
    let atual = null;

    pontos.forEach(p => {
        const inicio = Math.floor((p.t.getTime() - desvio) / intervalo) * intervalo + desvio;
        if (!atual || atual.inicio !== inicio) {
            atual = { inicio, abertura: acumulado, maxima: acumulado, minima: acumulado, fechamento: acumulado, apostas: 0 };
            velas.push(atual);
        }
        acumulado += p.v;
        atual.fechamento = acumulado;
        atual.maxima = Math.max(atual.maxima, acumulado);
        atual.minima = Math.min(atual.minima, acumulado);
        atual.apostas += 1;
    });
    return velas;
}

function escalaBonita(min, max, alvo = 6) {
    if (max - min <= 0) { min -= 1; max += 1; }
    const folga = (max - min) * 0.08;
    min -= folga; max += folga;

    const bruto = (max - min) / alvo;
    const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
    const norm = bruto / mag;
    const passo = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;

    const ini = Math.floor(min / passo) * passo;
    const fim = Math.ceil(max / passo) * passo;
    const marcas = [];
    for (let v = ini; v <= fim + passo / 2; v += passo) marcas.push(Number(v.toFixed(10)));

    const casas = passo >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(passo)));
    return { min: ini, max: fim, marcas, casas };
}

function rotuloTempo(ms, intervalo, comData) {
    const d = new Date(ms);
    if (intervalo >= 86400e3) {
        return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    }
    const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return comData
        ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + hora
        : hora;
}

function renderizarCaixa(linhas) {
    linhasCaixa = linhas;
    desenharCaixa();
}

function desenharCaixa() {
    const caixa = document.getElementById("caixa-grafico");
    const svg = document.getElementById("caixa-svg");
    const vazio = document.getElementById("caixa-vazio");
    const dica = document.getElementById("caixa-dica");
    const valorEl = document.getElementById("caixa-valor");
    const extremosEl = document.getElementById("caixa-extremos");
    const notaEl = document.getElementById("caixa-nota");

    dica.style.display = "none";

    const pontos = linhasCaixa.map(l => ({
        t: dataDe(l, ["created_at", "timestamp", "date", "time"]),
        v: numero(campo(l, ["bet", "bet_amount", "amount"], 0)) - numero(campo(l, ["win", "win_amount", "payout"], 0))
    })).filter(p => p.t).sort((a, b) => a.t - b.t);

    if (!pontos.length) {
        geo = null;
        svg.innerHTML = "";
        vazio.style.display = "flex";
        vazio.innerText = "Nenhuma aposta no período escolhido.";
        valorEl.innerText = "—";
        valorEl.className = "caixa-valor";
        extremosEl.innerText = "";
        notaEl.innerText = "";
        return;
    }

    const W = caixa.clientWidth;
    const H = caixa.clientHeight;
    if (W < 50 || H < 50) return;

    vazio.style.display = "none";

    const intervalo = escolherIntervalo(pontos);
    const velas = construirVelas(pontos, intervalo);
    const n = velas.length;

    const ultimo = velas[n - 1].fechamento;
    const maximo = Math.max(...velas.map(v => v.maxima));
    const minimo = Math.min(...velas.map(v => v.minima));
    const lado = ultimo >= 0 ? "alta" : "baixa";

    valorEl.innerText = dinheiroComSinal(ultimo);
    valorEl.className = "caixa-valor " + classeSinal(ultimo);
    extremosEl.innerText = `Máx ${dinheiroComSinal(maximo)} · Mín ${dinheiroComSinal(minimo)}`;
    notaEl.innerText = `${pontos.length} aposta(s) · velas de ${rotuloIntervalo(intervalo)}`;

    // geometria
    const ML = 10, MR = 66, MT = 12, MB = 26;
    const pw = W - ML - MR;
    const ph = H - MT - MB;
    const escala = escalaBonita(minimo, maximo);
    const passo = pw / n;
    const px = i => ML + passo * (i + 0.5);
    const py = v => MT + ph * (1 - (v - escala.min) / (escala.max - escala.min));

    let html = "";

    // grade horizontal + eixo de valores (direita, como nas bolsas)
    escala.marcas.forEach(m => {
        const y = py(m);
        html += `<line class="grade-linha" x1="${ML}" x2="${ML + pw}" y1="${y}" y2="${y}"/>`;
        html += `<text class="eixo-texto" x="${ML + pw + 8}" y="${y + 4}">${escapar(formatoEixo(m, escala.casas))}</text>`;
    });

    // linha do zero = ponto de equilibrio da casa
    if (escala.min < 0 && escala.max > 0) {
        html += `<line class="zero-linha" x1="${ML}" x2="${ML + pw}" y1="${py(0)}" y2="${py(0)}"/>`;
    }

    // eixo do tempo
    const espaco = Math.max(1, Math.ceil(90 / passo));
    let diaAnterior = null;
    velas.forEach((v, i) => {
        if (i % espaco !== 0) return;
        const dia = new Date(v.inicio).toDateString();
        const comData = diaAnterior === null || dia !== diaAnterior;
        diaAnterior = dia;
        html += `<text class="eixo-texto" text-anchor="middle" x="${px(i)}" y="${H - 8}">${escapar(rotuloTempo(v.inicio, intervalo, comData))}</text>`;
    });

    // serie
    if (tipoGrafico === "velas") {
        const larguraCorpo = Math.max(1, Math.min(22, passo * 0.7));
        velas.forEach((v, i) => {
            const x = px(i);
            const classe = v.fechamento >= v.abertura ? "vela-alta" : "vela-baixa";
            const yAbertura = py(v.abertura);
            const yFechamento = py(v.fechamento);
            const topo = Math.min(yAbertura, yFechamento);
            const altura = Math.max(1, Math.abs(yAbertura - yFechamento));
            html += `<line class="${classe} vela-pavio" x1="${x}" x2="${x}" y1="${py(v.maxima)}" y2="${py(v.minima)}"/>`;
            html += `<rect class="${classe} vela-corpo" x="${x - larguraCorpo / 2}" y="${topo}" width="${larguraCorpo}" height="${altura}"/>`;
        });
    } else {
        const coords = velas.map((v, i) => `${px(i)},${py(v.fechamento)}`);
        if (n > 1) {
            const base = MT + ph;
            html += `<path class="area-caixa ${lado}" d="M${px(0)},${base} L${coords.join(" L")} L${px(n - 1)},${base} Z"/>`;
            html += `<path class="linha-caixa ${lado}" d="M${coords.join(" L")}"/>`;
        }
        html += `<circle class="preco-tag ${lado}" cx="${px(n - 1)}" cy="${py(ultimo)}" r="3.5"/>`;
    }

    // preco atual (ultimo fechamento)
    const yUltimo = py(ultimo);
    html += `<line class="preco-linha ${lado}" x1="${ML}" x2="${ML + pw}" y1="${yUltimo}" y2="${yUltimo}"/>`;
    html += `<rect class="preco-tag ${lado}" x="${ML + pw + 1}" y="${yUltimo - 9}" width="${MR - 2}" height="18" rx="3"/>`;
    html += `<text class="preco-tag-texto" x="${ML + pw + 8}" y="${yUltimo + 4}">${escapar(formatoEixo(ultimo, escala.casas))}</text>`;

    // mira (segue o mouse)
    html += `<g id="caixa-mira" style="display:none">
        <line id="mira-v" class="mira-linha" y1="${MT}" y2="${MT + ph}"/>
        <line id="mira-h" class="mira-linha" x1="${ML}" x2="${ML + pw}"/>
        <rect id="mira-tag" class="mira-tag" x="${ML + pw + 1}" width="${MR - 2}" height="18" rx="3"/>
        <text id="mira-tag-texto" class="mira-tag-texto" x="${ML + pw + 8}"></text>
    </g>`;

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = html;

    geo = { velas, intervalo, n, passo, px, py, ML, MT, pw, ph, W, H, escala };
}

function moverMira(evento) {
    if (!geo) return;
    const caixa = document.getElementById("caixa-grafico");
    const dica = document.getElementById("caixa-dica");
    const mira = document.getElementById("caixa-mira");
    if (!mira) return;

    const r = caixa.getBoundingClientRect();
    const mx = evento.clientX - r.left;
    const my = evento.clientY - r.top;

    const dentro = mx >= geo.ML && mx <= geo.ML + geo.pw && my >= geo.MT && my <= geo.MT + geo.ph;
    if (!dentro) { esconderMira(); return; }

    const i = Math.min(geo.n - 1, Math.max(0, Math.floor((mx - geo.ML) / geo.passo)));
    const v = geo.velas[i];
    const x = geo.px(i);
    const valorNoCursor = geo.escala.min + (1 - (my - geo.MT) / geo.ph) * (geo.escala.max - geo.escala.min);

    mira.style.display = "";
    document.getElementById("mira-v").setAttribute("x1", x);
    document.getElementById("mira-v").setAttribute("x2", x);
    document.getElementById("mira-h").setAttribute("y1", my);
    document.getElementById("mira-h").setAttribute("y2", my);
    document.getElementById("mira-tag").setAttribute("y", my - 9);
    const texto = document.getElementById("mira-tag-texto");
    texto.setAttribute("y", my + 4);
    texto.textContent = formatoEixo(valorNoCursor, geo.escala.casas);

    const variacao = v.fechamento - v.abertura;
    dica.innerHTML = `
        <div class="dica-topo">${escapar(rotuloTempo(v.inicio, geo.intervalo, true))}</div>
        <div class="dica-linha"><span>Abertura</span><span>${escapar(dinheiroComSinal(v.abertura))}</span></div>
        <div class="dica-linha"><span>Máxima</span><span>${escapar(dinheiroComSinal(v.maxima))}</span></div>
        <div class="dica-linha"><span>Mínima</span><span>${escapar(dinheiroComSinal(v.minima))}</span></div>
        <div class="dica-linha"><span>Fechamento</span><span class="${classeSinal(v.fechamento)}">${escapar(dinheiroComSinal(v.fechamento))}</span></div>
        <div class="dica-linha"><span>Variação</span><span class="${classeSinal(variacao)}">${escapar(dinheiroComSinal(variacao))}</span></div>
        <div class="dica-linha"><span>Apostas</span><span>${v.apostas}</span></div>`;
    dica.style.display = "block";

    const largura = dica.offsetWidth;
    const altura = dica.offsetHeight;
    let esquerda = x + 16;
    if (esquerda + largura > geo.ML + geo.pw) esquerda = x - 16 - largura;
    dica.style.left = Math.max(4, esquerda) + "px";
    dica.style.top = Math.min(Math.max(my - altura / 2, 4), geo.H - altura - 4) + "px";
}

function esconderMira() {
    const mira = document.getElementById("caixa-mira");
    if (mira) mira.style.display = "none";
    document.getElementById("caixa-dica").style.display = "none";
}

function iniciarGraficoCaixa() {
    const caixa = document.getElementById("caixa-grafico");

    caixa.addEventListener("mousemove", moverMira);
    caixa.addEventListener("mouseleave", esconderMira);

    document.querySelectorAll(".seg-btn").forEach(botao => {
        botao.addEventListener("click", () => {
            tipoGrafico = botao.dataset.tipo;
            document.querySelectorAll(".seg-btn").forEach(b => {
                const ativo = b === botao;
                b.classList.toggle("ativo", ativo);
                b.setAttribute("aria-pressed", String(ativo));
            });
            desenharCaixa();
        });
    });

    document.getElementById("caixa-intervalo").addEventListener("change", desenharCaixa);

    // redesenha quando o painel muda de tamanho
    let quadro = null;
    const redesenhar = () => {
        if (quadro) cancelAnimationFrame(quadro);
        quadro = requestAnimationFrame(desenharCaixa);
    };
    if (typeof ResizeObserver !== "undefined") {
        new ResizeObserver(redesenhar).observe(caixa);
    } else {
        window.addEventListener("resize", redesenhar);
    }
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
            pegarTodasEstatisticas(filtros),
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
        renderizarCaixa(listaLinhas);
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
    ocultarNavbar();
    iniciarGraficoCaixa();
    document.getElementById("btn-atualizar").addEventListener("click", carregarEstatisticas);
    document.getElementById("filtro-jogo").addEventListener("change", carregarEstatisticas);
    document.getElementById("filtro-periodo").addEventListener("change", carregarEstatisticas);
    document.getElementById("filtro-dispositivo").addEventListener("change", carregarEstatisticas);
    document.getElementById("auto-atualizar").addEventListener("change", ajustarAutoAtualizacao);

    carregarEstatisticas();
    ajustarAutoAtualizacao();
});

window.addEventListener("load", ocultarNavbar);
