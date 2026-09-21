// crash.js
// Depende de base.js (baseUrl, jogadorID, sessaoInciada, obterSaldo,
// modificarSaldoNaTela, formataDinheiro, mostrarErro) já carregado antes deste script.
//
// Assim como em roleta.js, a rodada é inteiramente conduzida pelo backend
// (crash.py): este frontend nunca abre rodada, decide o ponto de explosão
// ou encerra a rodada — apenas entra na rodada (join), sai quando o jogador
// pede (cashout) e fica sincronizado via polling em GET /crash/games/current
// e GET /crash/games/{id}/players, que são a mesma fonte de verdade para
// todos os jogadores conectados.
//
// O multiplicador exibido NÃO vem do servidor a cada frame: ele é calculado
// no cliente a partir do tempo decorrido desde `game_start_time` (o mesmo
// valor que o backend usa), usando a fórmula abaixo — espelho em JS de
// time_to_crash_multiplier() do backend. Isso mantém todos os jogadores
// olhando para (aproximadamente) o mesmo número em tempo real sem precisar
// de um poll a cada 100ms. O poll continua rodando por cima, mais devagar,
// só para pegar status/resultado oficiais e corrigir qualquer desvio de
// relógio. A aposta em si (join/cashout) é sempre validada pelo backend
// usando o tempo dele, não o multiplicador mostrado na tela.

const NOME_JOGO = "crash";
const APOSTA_MIN = 10;
const APOSTA_PASSO = 10;
const APOSTA_MAX_PADRAO = 500;
const INTERVALO_POLL_MS = 1500;   // sincronização com o servidor (status, apostas, resultado)
const INTERVALO_ANIMACAO_MS = 80; // atualização local do multiplicador na tela

const TAXA_CRESCIMENTO = 0.06;    // igual ao growth_rate do backend
const DURACAO_SUB_UM = 0.5;       // segundos de "preparação" antes do 1.00x

let saldoAtual = 0;
let apostaAtual = APOSTA_MIN;

let rodadaAtualId = null;
let statusAtual = null;
let inicioRodada = null;       // Date, a partir de game_start_time
let apostaProcessadaId = null; // id da rodada cujo resultado já foi exibido
let minhaAposta = null;        // {money_bet, left, multiplier} vinda do servidor, ou null
let enviandoAcao = false;      // trava o botão enquanto uma chamada de rede está em voo
let historicoMultiplicadores = [];
let pollEmAndamento = false;
let animacaoId = null;

/* ---------- FÓRMULA DE MULTIPLICADOR (espelho do backend) ---------- */

// Converte segundos decorridos no multiplicador correspondente.
// Espelha fielmente time_to_crash_multiplier() do backend.
function tempoParaMultiplicador(segundos, taxaCrescimento = TAXA_CRESCIMENTO, subUm = True) {
    if (segundos <= 0.0) return subUm ? 0.0 : 1.0;
    if (subUm) {
        const m = segundos / 0.5;
        return Math.round(Math.min(m, 0.99) * 100) / 100;
    }
    const m = Math.exp(taxaCrescimento * segundos);
    return Math.round(m * 100) / 100;
}

// Multiplicador "de exibição" no instante atual, considerando a fase de
// preparação (sub-1.00x) antes do cronômetro de crescimento propriamente dito.
// Retorna null durante a fase de preparação (ainda não é um multiplicador real).
function multiplicadorAgora() {
    if (!inicioRodada) return null;
    // Compensa pelos 15 segundos de diferença.
    const decorrido = (Date.now() - (inicioRodada.getTime() + 15000)) / 1000;
    if (decorrido < DURACAO_SUB_UM) return null;
    return tempoParaMultiplicador(decorrido - DURACAO_SUB_UM, TAXA_CRESCIMENTO, false);
}

function corDoMultiplicador(m) {
    if (m === null) return "neutro";
    if (m < 2) return "baixo";
    if (m < 5) return "medio";
    return "alto";
}

/* ---------- APOSTA (VALOR) ---------- */

function apostaMaxDisponivel() {
    return Math.max(APOSTA_MIN, Math.min(APOSTA_MAX_PADRAO, Math.floor(saldoAtual / APOSTA_PASSO) * APOSTA_PASSO));
}

function atualizarDisplayAposta() {
    document.getElementById("valor-aposta").innerText = formataDinheiro(apostaAtual);
}

function alterarAposta(delta) {
    if (statusAtual !== "waiting_for_bets" || minhaAposta) return;
    const novo = apostaAtual + delta;
    const max = apostaMaxDisponivel();
    if (novo < APOSTA_MIN || novo > Math.max(max, APOSTA_MIN)) return;
    apostaAtual = novo;
    atualizarDisplayAposta();
    atualizarBotaoAcao();
}

function apostaMax() {
    if (statusAtual !== "waiting_for_bets" || minhaAposta) return;
    apostaAtual = apostaMaxDisponivel();
    atualizarDisplayAposta();
    atualizarBotaoAcao();
}

/* ---------- PALCO / TRILHA DO FOGUETE ---------- */

// Escala visual não-linear: satura perto do topo da trilha para que o
// foguete tenha para onde "crescer" mesmo em rodadas com multiplicador alto.
function progressoVisual(m) {
    if (m === null) return 2; // fase de preparação: foguete quase no início
    const proporcao = Math.log(Math.max(m, 1)) / Math.log(20); // 20x preenche a trilha
    return Math.min(96, 4 + proporcao * 92);
}

function atualizarPalco(m, caiu = false) {
    const preenchimento = document.getElementById("preenchimento-crash");
    const foguete = document.getElementById("foguete");
    const numero = document.getElementById("multiplicador-numero");

    const progresso = progressoVisual(m);
    preenchimento.style.width = `${progresso}%`;
    foguete.style.left = `${progresso}%`;

    preenchimento.classList.toggle("caiu", caiu);
    foguete.classList.toggle("caiu", caiu);

    numero.classList.remove("baixo", "medio", "alto", "neutro", "caiu", "pulsando");

    if (caiu) {
        numero.innerText = m !== null ? `${m.toFixed(2)}x` : "—";
        numero.classList.add("caiu");
        return;
    }

    if (m === null) {
        numero.innerText = "Preparando decolagem...";
        numero.classList.add("neutro");
        return;
    }

    numero.innerText = `${m.toFixed(2)}x`;
    numero.classList.add(corDoMultiplicador(m));
    if (statusAtual === "running") numero.classList.add("pulsando");
}

function resetarPalco() {
    document.getElementById("preenchimento-crash").style.width = "0%";
    document.getElementById("preenchimento-crash").classList.remove("caiu");
    document.getElementById("foguete").style.left = "0%";
    document.getElementById("foguete").classList.remove("caiu");
    const numero = document.getElementById("multiplicador-numero");
    numero.className = "multiplicador-numero";
    numero.innerText = "Aguardando...";
    document.getElementById("crash-final").classList.add("oculto");
}

/* ---------- ANIMAÇÃO LOCAL (roda entre um poll e outro) ---------- */

function loopAnimacao() {
    if (statusAtual === "running" && inicioRodada) {
        atualizarPalco(multiplicadorAgora());
        atualizarBotaoAcao();
    }
}

function iniciarAnimacaoLocal() {
    if (animacaoId) return;
    animacaoId = setInterval(loopAnimacao, INTERVALO_ANIMACAO_MS);
}   

function pararAnimacaoLocal() {
    if (!animacaoId) return;
    clearInterval(animacaoId);
    animacaoId = null;
}

/* ---------- STATUS / RESULTADO ---------- */

function atualizarStatusBadge(status) {
    const badge = document.getElementById("status-badge");
    badge.classList.remove("aberta", "rodando", "encerrada");

    if (status === "waiting_for_bets") {
        badge.innerText = "Apostas abertas";
        badge.classList.add("aberta");
    } else if (status === "running") {
        badge.innerText = "Foguete decolou — voando";
        badge.classList.add("rodando");
    } else if (status === "ended") {
        badge.innerText = "Rodada encerrada";
        badge.classList.add("encerrada");
    } else {
        badge.innerText = "Aguardando início da rodada...";
    }
}

function mostrarResultadoFinal(multiplicadorFinal) {
    atualizarPalco(multiplicadorFinal, true);
    const info = document.getElementById("crash-final");
    info.innerText = `💥 Explodiu em ${multiplicadorFinal.toFixed(2)}x`;
    info.classList.remove("oculto");
}

function limparResultadoMsg() {
    const msg = document.getElementById("resultado-msg");
    msg.className = "resultado-msg";
    msg.innerText = "";
}

function mostrarResultadoPessoal(multiplicadorFinal) {
    const msg = document.getElementById("resultado-msg");
    msg.className = "resultado-msg";

    if (!minhaAposta) {
        msg.innerText = `O foguete explodiu em ${multiplicadorFinal.toFixed(2)}x. Você não apostou nesta rodada.`;
        msg.classList.add("perdeu");
        return;
    }

    if (minhaAposta.left && minhaAposta.multiplier) {
        const ganho = Math.round(minhaAposta.money_bet * minhaAposta.multiplier * 100) / 100;
        msg.innerText = `Você retirou em ${minhaAposta.multiplier.toFixed(2)}x e ganhou ${formataDinheiro(ganho)}!`;
        msg.classList.add("ganhou");
    } else {
        msg.innerText = `Você não retirou a tempo. O foguete explodiu em ${multiplicadorFinal.toFixed(2)}x e você perdeu ${formataDinheiro(minhaAposta.money_bet)}.`;
        msg.classList.add("perdeu");
    }
}

function registrarHistorico(multiplicador) {
    historicoMultiplicadores.unshift(multiplicador);
    if (historicoMultiplicadores.length > 14) historicoMultiplicadores.pop();
    renderizarHistorico();
}

function renderizarHistorico() {
    const lista = document.getElementById("historico-lista");
    lista.innerHTML = "";
    historicoMultiplicadores.forEach((m) => {
        const badge = document.createElement("div");
        badge.className = `historico-item ${corDoMultiplicador(m)}`;
        badge.innerText = `${m.toFixed(2)}x`;
        lista.appendChild(badge);
    });
}

/* ---------- BOTÃO PRINCIPAL (apostar / retirar) ---------- */

function atualizarBotaoAcao() {
    const btn = document.getElementById("btn-acao");
    const texto = document.getElementById("btn-acao-texto");
    btn.classList.remove("modo-saque");

    if (enviandoAcao) {
        btn.disabled = true;
        return;
    }

    if (statusAtual === "waiting_for_bets") {
        if (minhaAposta) {
            btn.disabled = true;
            texto.innerText = `Aposta registrada (${formataDinheiro(minhaAposta.money_bet)}) — aguardando decolagem...`;
            return;
        }
        if (apostaAtual > saldoAtual) {
            btn.disabled = true;
            texto.innerText = "Saldo insuficiente";
            return;
        }
        btn.disabled = false;
        texto.innerText = `Apostar ${formataDinheiro(apostaAtual)}`;
        return;
    }

    if (statusAtual === "running") {
        if (minhaAposta && !minhaAposta.left) {
            const m = multiplicadorAgora();
            btn.classList.add("modo-saque");
            if (m === null) {
                btn.disabled = true;
                texto.innerText = "Preparando decolagem...";
            } else {
                btn.disabled = false;
                const estimativa = Math.round(minhaAposta.money_bet * m * 100) / 100;
                texto.innerText = `Retirar agora — ${m.toFixed(2)}x (${formataDinheiro(estimativa)})`;
            }
            return;
        }
        if (minhaAposta && minhaAposta.left) {
            btn.disabled = true;
            texto.innerText = minhaAposta.multiplier
                ? `Você já retirou em ${minhaAposta.multiplier.toFixed(2)}x`
                : "Você já retirou desta rodada";
            return;
        }
        btn.disabled = true;
        texto.innerText = "Apostas encerradas — aguarde a próxima rodada";
        return;
    }

    if (statusAtual === "ended") {
        btn.disabled = true;
        texto.innerText = "Rodada encerrada — aguardando a próxima...";
        return;
    }

    btn.disabled = true;
    texto.innerText = "Aguardando abertura das apostas...";
}

/* ---------- PAINEL DE JOGADORES ---------- */

function renderizarJogadores(apostas) {
    const lista = document.getElementById("jogadores-lista");
    lista.innerHTML = "";

    if (!apostas || apostas.length === 0) {
        const vazio = document.createElement("p");
        vazio.className = "jogadores-vazio";
        vazio.innerText = "Nenhuma aposta ainda nesta rodada.";
        lista.appendChild(vazio);
        return;
    }

    apostas.forEach((aposta) => {
        const ehVoce = aposta.player.id === jogadorID;
        const linha = document.createElement("div");
        linha.className = `jogador-linha ${ehVoce ? "voce" : ""}`;

        const icone = document.createElement("span");
        const valor = document.createElement("span");
        valor.className = "jogador-valor";

        if (aposta.left && aposta.multiplier) {
            icone.className = "jogador-icone cashado";
            icone.innerText = "💰";
            valor.classList.add("positivo");
            valor.innerText = `${aposta.multiplier.toFixed(2)}x`;
        } else if (statusAtual === "ended" && !aposta.left) {
            icone.className = "jogador-icone perdeu";
            icone.innerText = "💥";
            valor.classList.add("negativo");
            valor.innerText = "perdeu";
        } else {
            icone.className = "jogador-icone voando";
            icone.innerText = "🚀";
            valor.innerText = "voando";
        }

        const nome = document.createElement("span");
        nome.className = "jogador-nome";
        nome.innerText = ehVoce
            ? `Você (${formataDinheiro(aposta.money_bet)})`
            : `${aposta.player.name} (${formataDinheiro(aposta.money_bet)})`;

        linha.appendChild(icone);
        linha.appendChild(nome);
        linha.appendChild(valor);
        lista.appendChild(linha);
    });
}

/* ---------- REDE ---------- */

async function apiGet(caminho) {
    const resp = await fetch(`${baseUrl}${caminho}`);
    if (!resp.ok) throw new Error(`GET ${caminho} falhou (${resp.status})`);
    return resp.json();
}

async function extrairDetalheErro(resp, padrao) {
    try {
        const corpo = await resp.json();
        if (corpo && corpo.detail) return corpo.detail;
    } catch (e) { /* sem corpo JSON */ }
    return padrao;
}

async function confirmarAposta() {
    if (statusAtual !== "waiting_for_bets" || minhaAposta || enviandoAcao) return;
    if (!jogadorID) { mostrarErro("Aguardando conexão com a API..."); return; }
    if (apostaAtual > saldoAtual) { mostrarErro("Saldo insuficiente para essa aposta."); return; }
    if (!rodadaAtualId) { mostrarErro("Nenhuma rodada aberta no momento."); return; }

    enviandoAcao = true;
    atualizarBotaoAcao();
    document.getElementById("btn-acao-texto").innerText = "Enviando aposta...";

    const payload = { player: jogadorID, money_bet: apostaAtual };

    try {
        const resp = await fetch(`${baseUrl}/crash/games/${rodadaAtualId}/join`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!resp.ok) {
            mostrarErro(await extrairDetalheErro(resp, "Não foi possível registrar a aposta."));
            return;
        }

        // Dedução otimista; o saldo oficial é sincronizado no próximo poll.
        saldoAtual = Math.round((saldoAtual - apostaAtual) * 100) / 100;
        modificarSaldoNaTela(saldoAtual);
        minhaAposta = { money_bet: apostaAtual, left: false, multiplier: null };
    } catch (error) {
        mostrarErro("Erro de conexão ao apostar.");
    } finally {
        enviandoAcao = false;
        atualizarBotaoAcao();
    }
}

async function sacar() {
    if (statusAtual !== "running" || !minhaAposta || minhaAposta.left || enviandoAcao) return;
    if (!rodadaAtualId) return;

    enviandoAcao = true;
    atualizarBotaoAcao();
    document.getElementById("btn-acao-texto").innerText = "Retirando...";

    try {
        const resp = await fetch(`${baseUrl}/crash/games/${rodadaAtualId}/cashout`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ player: jogadorID, multiplier: multiplicadorAgora() }),
        });

        if (!resp.ok) {
            mostrarErro(await extrairDetalheErro(resp, "Não foi possível retirar agora."));
            return;
        }

        // Marca como retirado de forma otimista; o multiplicador oficial de
        // saque (definido pelo relógio do servidor) chega no próximo poll,
        // via GET /crash/games/{id}/players.
        minhaAposta.left = true;
        const saldo = await obterSaldo();
        if (saldo !== null && saldo !== undefined) {
            saldoAtual = saldo;
            modificarSaldoNaTela(saldoAtual);
        }
    } catch (error) {
        mostrarErro("Erro de conexão ao tentar retirar.");
    } finally {
        enviandoAcao = false;
        atualizarBotaoAcao();
    }
}

// Um único botão troca de função conforme o estado da rodada.
function acaoPrincipal() {
    if (statusAtual === "waiting_for_bets") { confirmarAposta(); return; }
    if (statusAtual === "running") { sacar(); return; }
}

/* ---------- CARGA INICIAL DO HISTÓRICO ---------- */

async function carregarHistoricoInicial() {
    try {
        const jogos = await apiGet("/crash/games?status=ended");
        const ordenados = [...jogos]
            .filter((j) => j.crash_multiplier !== null && j.crash_multiplier !== undefined)
            .sort((a, b) => new Date(b.game_start_time) - new Date(a.game_start_time))
            .slice(0, 14);
        historicoMultiplicadores = ordenados.map((j) => j.crash_multiplier);
        renderizarHistorico();
    } catch (error) {
        // histórico é só informativo; falha aqui não trava o jogo
    }
}

/* ---------- CICLO DA RODADA ---------- */

async function processarRodada(rodada) {
    const novoId = rodada ? rodada.id : null;

    if (novoId !== rodadaAtualId) {
        rodadaAtualId = novoId;
        minhaAposta = null;
        apostaProcessadaId = null;
        limparResultadoMsg();
        resetarPalco();
    }

    statusAtual = rodada ? rodada.status : null;
    inicioRodada = rodada && rodada.game_start_time ? new Date(rodada.game_start_time) : null;
    atualizarStatusBadge(statusAtual);

    if (statusAtual === "running") {
        iniciarAnimacaoLocal();
    } else {
        pararAnimacaoLocal();
    }

    if (!rodada) {
        atualizarBotaoAcao();
        return;
    }

    // Sincroniza apostas desta rodada (todos os jogadores conectados,
    // incluindo a sua própria, caso já tenha sido feita antes de um reload).
    try {
        const apostas = await apiGet(`/crash/games/${rodada.id}/players`);
        renderizarJogadores(apostas);
        const minha = apostas.find((a) => a.player.id === jogadorID);
        if (minha) minhaAposta = minha;
    } catch (error) {
        // painel de jogadores é informativo; falha aqui não trava o jogo
    }

    if (statusAtual === "ended" && rodada.crash_multiplier !== null && rodada.crash_multiplier !== undefined) {
        pararAnimacaoLocal();
        mostrarResultadoFinal(rodada.crash_multiplier);

        if (apostaProcessadaId !== rodada.id) {
            apostaProcessadaId = rodada.id;
            registrarHistorico(rodada.crash_multiplier);
            mostrarResultadoPessoal(rodada.crash_multiplier);
            const saldo = await obterSaldo();
            if (saldo !== null && saldo !== undefined) {
                saldoAtual = saldo;
                modificarSaldoNaTela(saldoAtual);
            }
        }
    } else if (statusAtual === "running") {
        atualizarPalco(multiplicadorAgora());
    }

    atualizarBotaoAcao();
}

async function tick() {
    if (pollEmAndamento) return;
    pollEmAndamento = true;
    try {
        const rodada = await apiGet("/crash/games/current");
        await processarRodada(rodada);
    } catch (error) {
        atualizarStatusBadge(null);
    } finally {
        pollEmAndamento = false;
    }
}

async function inicializar() {
    atualizarDisplayAposta();
    atualizarBotaoAcao();
    resetarPalco();

    await sessaoInciada;

    const saldo = await obterSaldo();
    if (saldo !== null && saldo !== undefined) {
        saldoAtual = saldo;
        modificarSaldoNaTela(saldoAtual);
    }

    carregarHistoricoInicial();
    tick();
    setInterval(tick, INTERVALO_POLL_MS);
}

inicializar();
