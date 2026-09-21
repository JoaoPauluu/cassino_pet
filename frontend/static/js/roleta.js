// roleta.js
// Depende de base.js (baseUrl, jogadorID, sessaoInciada, obterSaldo,
// modificarSaldoNaTela, formataDinheiro, mostrarErro) já carregado antes deste script.
//
// A rodada é inteiramente conduzida pelo backend (roulette.py): este frontend
// nunca abre rodada, fecha apostas ou sorteia número — apenas entra na rodada
// (join) e fica sincronizado via polling em GET /roulette/games/current e
// GET /roulette/games/{id}/players, que são a mesma fonte de verdade para
// todos os jogadores conectados. O backend também é quem decide vitórias e
// derrotas (settlement em /draw); o frontend só reflete isso na tela.
//
// Cada jogador pode fazer VÁRIAS apostas na mesma rodada (em números e/ou
// cores diferentes). Cada aposta é enviada como uma chamada separada a
// POST /roulette/games/{id}/join. Uma aposta é sempre em número OU em cor
// (nunca as duas ao mesmo tempo): o campo que não foi escolhido é enviado
// como placeholder (-1 para number_bet, "none" para color_bet) para manter
// o payload sempre com o mesmo formato.

const NOME_JOGO = "roleta";
const APOSTA_MIN = 10;
const APOSTA_PASSO = 10;
const APOSTA_MAX_PADRAO = 500;
const INTERVALO_POLL_MS = 1500;
const PAGAMENTO_NUMERO_MULT = 36;
const PAGAMENTO_COR_MULT = 2.0;


// Animação da bola: uma borda salta de número em número nesta ordem.
// (Para seguir a ordem real da roda europeia, troque por
// [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26])
const ORDEM_ROLETA = Array.from({ length: 37 }, (_, i) => i);
const SALTO_GIRO_MS = 85;        // intervalo entre saltos enquanto gira
const SALTO_INICIAL_POUSO_MS = 60;
const SALTO_FINAL_POUSO_MS = 320; // acréscimo no último salto (desaceleração)
const SALTOS_MIN_POUSO = 12;      // a bola sempre desacelera por pelo menos isto

const NUMEROS_VERMELHOS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

function corDoNumero(n) {
    if (n === 0) return "verde";
    return NUMEROS_VERMELHOS.has(n) ? "vermelho" : "preto";
}

let saldoAtual = 0;
let apostaAtual = APOSTA_MIN;
let numeroSelecionado = null;
let corSelecionada = null;

let rodadaAtualId = null;
let statusAtual = null;
let apostaProcessadaId = null; // id da rodada cujo resultado já foi exibido
let minhasApostas = []; // lista de {number_bet, color_bet, money_bet} nesta rodada, vindas do servidor
let historicoNumeros = [];
let pollEmAndamento = false;

let indiceCursor = 0;
let timerCursor = null;
let modoCursor = "parado";     // "parado" | "girando" | "pousando"
let revelacaoPendente = null;  // função que mostra o resultado quando a bola parar
let primeiraSincronizacao = true; // 1º poll só registra o estado: não toca sons "atrasados"
const somTocadoNaRodada = { abertura: null, giro: null };

function apostaMaxDisponivel() {
    return Math.max(APOSTA_MIN, Math.min(APOSTA_MAX_PADRAO, Math.floor(saldoAtual / APOSTA_PASSO) * APOSTA_PASSO));
}

function atualizarDisplayAposta() {
    document.getElementById("valor-aposta").innerText = formataDinheiro(apostaAtual);
}

function alterarAposta(delta) {
    const novo = apostaAtual + delta;
    const max = apostaMaxDisponivel();
    if (novo < APOSTA_MIN || novo > Math.max(max, APOSTA_MIN)) return;
    apostaAtual = novo;
    atualizarDisplayAposta();
    atualizarBotaoApostar();
}

function apostaMax() {
    apostaAtual = apostaMaxDisponivel();
    atualizarDisplayAposta();
    atualizarBotaoApostar();
}

/* ---------- TABULEIRO ---------- */

function gerarTabuleiro() {
    const tabuleiro = document.getElementById("tabuleiro");
    tabuleiro.innerHTML = "";

    const casaZero = document.createElement("div");
    casaZero.className = "casa verde";
    casaZero.dataset.numero = "0";
    casaZero.innerText = "0";
    casaZero.style.gridColumn = "1";
    casaZero.style.gridRow = "1 / 4";
    casaZero.addEventListener("click", () => selecionarNumero(0));
    tabuleiro.appendChild(casaZero);

    for (let n = 1; n <= 36; n++) {
        const casa = document.createElement("div");
        casa.className = `casa ${corDoNumero(n)}`;
        casa.dataset.numero = String(n);
        casa.innerText = String(n);
        const coluna = Math.ceil(n / 3) + 1;
        const linha = 3 - ((n - 1) % 3);
        casa.style.gridColumn = String(coluna);
        casa.style.gridRow = String(linha);
        casa.addEventListener("click", () => selecionarNumero(n));
        tabuleiro.appendChild(casa);
    }
}

function limparSelecaoVisual() {
    document.querySelectorAll(".casa").forEach((el) => el.classList.remove("selecionada"));
    document.querySelectorAll(".btn-cor").forEach((el) => el.classList.remove("selecionada"));
}

function selecionarNumero(n) {
    if (statusAtual !== "waiting_for_bets") return;
    numeroSelecionado = n;
    corSelecionada = null;
    limparSelecaoVisual();
    document.querySelectorAll(".casa").forEach((el) => {
        el.classList.toggle("selecionada", Number(el.dataset.numero) === n);
    });
    atualizarBotaoApostar();
}

function selecionarCor(cor) {
    if (statusAtual !== "waiting_for_bets") return;
    corSelecionada = cor;
    numeroSelecionado = null;
    limparSelecaoVisual();
    const btn = document.getElementById(cor === "vermelho" ? "btn-cor-vermelho" : "btn-cor-preto");
    btn.classList.add("selecionada");
    atualizarBotaoApostar();
}

function atualizarBotaoApostar() {
    const btn = document.getElementById("btn-apostar");
    const texto = document.getElementById("btn-apostar-texto");

    if (statusAtual !== "waiting_for_bets") {
        btn.disabled = true;
        texto.innerText = statusAtual === "running" ? "Apostas encerradas" : "Aguardando abertura das apostas...";
        return;
    }
    if (numeroSelecionado === null && corSelecionada === null) {
        btn.disabled = true;
        texto.innerText = "Selecione um número ou uma cor";
        return;
    }
    if (apostaAtual > saldoAtual) {
        btn.disabled = true;
        texto.innerText = "Saldo insuficiente";
        return;
    }
    btn.disabled = false;
    texto.innerText = numeroSelecionado !== null
        ? `Apostar no ${numeroSelecionado}`
        : `Apostar no ${corSelecionada}`;
}

function aplicarBloqueioTabuleiro() {
    const travado = statusAtual !== "waiting_for_bets";
    document.querySelectorAll(".casa").forEach((el) => {
        el.classList.toggle("desabilitada", travado);
    });
    document.querySelectorAll(".btn-cor").forEach((el) => {
        el.disabled = travado;
    });
}

function destacarVencedores(numero) {
    document.querySelectorAll(".casa").forEach((el) => {
        el.classList.toggle("vencedora", Number(el.dataset.numero) === numero);
    });
    const cor = corDoNumero(numero);
    document.getElementById("btn-cor-vermelho").classList.toggle("vencedora", numero !== 0 && cor === "vermelho");
    document.getElementById("btn-cor-preto").classList.toggle("vencedora", numero !== 0 && cor === "preto");
}

function limparSelecaoTabuleiro() {
    document.querySelectorAll(".casa").forEach((el) => {
        el.classList.remove("selecionada", "vencedora", "passando");
    });
    document.querySelectorAll(".btn-cor").forEach((el) => {
        el.classList.remove("selecionada", "vencedora");
    });
    numeroSelecionado = null;
    corSelecionada = null;
}

/* ---------- BOLA: BORDA SALTANDO DE NÚMERO EM NÚMERO ---------- */

function moverCursor(indice) {
    const tabuleiro = document.getElementById("tabuleiro");
    const anterior = tabuleiro.querySelector(".casa.passando");
    if (anterior) anterior.classList.remove("passando");
    indiceCursor = indice;
    const atual = tabuleiro.querySelector(`.casa[data-numero="${ORDEM_ROLETA[indice]}"]`);
    if (atual) atual.classList.add("passando");
}

function proximoIndice() {
    return (indiceCursor + 1) % ORDEM_ROLETA.length;
}

function limparCursor() {
    document.querySelectorAll(".casa.passando").forEach((el) => el.classList.remove("passando"));
}

// Enquanto a rodada está "running": gira em velocidade constante.
function iniciarGiroCursor() {
    if (modoCursor !== "parado") return;
    modoCursor = "girando";
    moverCursor(Math.floor(Math.random() * ORDEM_ROLETA.length));

    const passo = () => {
        if (modoCursor !== "girando") return;
        moverCursor(proximoIndice());
        somTique(false);
        timerCursor = setTimeout(passo, SALTO_GIRO_MS);
    };
    timerCursor = setTimeout(passo, SALTO_GIRO_MS);
}

function pararGiroCursor() {
    clearTimeout(timerCursor);
    timerCursor = null;
    modoCursor = "parado";
    limparCursor();
}

// Quando o servidor informa o número sorteado: desacelera e para nele.
function pousarCursor(numeroSorteado, aoTerminar) {
    clearTimeout(timerCursor);
    modoCursor = "pousando";

    const alvo = ORDEM_ROLETA.indexOf(numeroSorteado);
    let total = (alvo - indiceCursor + ORDEM_ROLETA.length) % ORDEM_ROLETA.length;
    while (total < SALTOS_MIN_POUSO) total += ORDEM_ROLETA.length;

    let dado = 0;
    const passo = () => {
        dado++;
        moverCursor(proximoIndice());
        somTique(true);
        if (dado >= total) {
            timerCursor = null;
            modoCursor = "parado";
            aoTerminar();
            return;
        }
        const atraso = SALTO_INICIAL_POUSO_MS + SALTO_FINAL_POUSO_MS * Math.pow(dado / total, 3);
        timerCursor = setTimeout(passo, atraso);
    };
    timerCursor = setTimeout(passo, SALTO_INICIAL_POUSO_MS);
}

/* ---------- EFEITOS SONOROS (Web Audio, sem arquivos) ---------- */

let audioCtx = null;
let somAtivo = true;
try { somAtivo = localStorage.getItem("roleta_som") !== "off"; } catch (e) { /* sem storage */ }

function contextoAudio() {
    if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        audioCtx = new Ctx();
    }
    return audioCtx;
}

// Navegadores só liberam áudio após um gesto do usuário (clique, toque, tecla).
function desbloquearAudio() {
    const ctx = contextoAudio();
    if (ctx && ctx.state === "suspended") ctx.resume();
}
["pointerdown", "keydown", "touchend"].forEach((ev) =>
    document.addEventListener(ev, desbloquearAudio, { passive: true })
);

function audioPronto() {
    if (!somAtivo) return null;
    const ctx = contextoAudio();
    if (!ctx) return null;
    if (ctx.state !== "running") { ctx.resume(); return null; } // ainda bloqueado
    return ctx;
}

function tom(ctx, { freq, freqFim = null, inicio = 0, duracao, tipo = "sine", volume = 0.2 }) {
    const t0 = ctx.currentTime + inicio;
    const osc = ctx.createOscillator();
    const ganho = ctx.createGain();
    osc.type = tipo;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqFim) osc.frequency.exponentialRampToValueAtTime(freqFim, t0 + duracao);
    ganho.gain.setValueAtTime(0.0001, t0);
    ganho.gain.exponentialRampToValueAtTime(volume, t0 + Math.min(0.015, duracao / 3));
    ganho.gain.exponentialRampToValueAtTime(0.0001, t0 + duracao);
    osc.connect(ganho).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duracao + 0.05);
}

function ruido(ctx, { inicio = 0, duracao, filtro = "lowpass", freq, freqFim, ataque = 0.01, volume = 0.3 }) {
    const t0 = ctx.currentTime + inicio;
    const total = Math.floor(ctx.sampleRate * duracao);
    const buffer = ctx.createBuffer(1, total, ctx.sampleRate);
    const dados = buffer.getChannelData(0);
    for (let i = 0; i < total; i++) dados[i] = Math.random() * 2 - 1;

    const fonte = ctx.createBufferSource();
    fonte.buffer = buffer;
    const f = ctx.createBiquadFilter();
    f.type = filtro;
    f.frequency.setValueAtTime(freq, t0);
    f.frequency.exponentialRampToValueAtTime(freqFim, t0 + duracao);
    const ganho = ctx.createGain();
    ganho.gain.setValueAtTime(0.0001, t0);
    ganho.gain.exponentialRampToValueAtTime(volume, t0 + ataque);
    ganho.gain.exponentialRampToValueAtTime(0.0001, t0 + duracao);
    fonte.connect(f).connect(ganho).connect(ctx.destination);
    fonte.start(t0);
}

// Três notas ascendentes: apostas abertas.
function somAbertura() {
    const ctx = audioPronto();
    if (!ctx) return;
    tom(ctx, { freq: 660, duracao: 0.35, tipo: "triangle", volume: 0.18 });
    tom(ctx, { freq: 880, inicio: 0.12, duracao: 0.35, tipo: "triangle", volume: 0.18 });
    tom(ctx, { freq: 1320, inicio: 0.24, duracao: 0.5, tipo: "triangle", volume: 0.16 });
}

// Sopro que sobe: a bola foi lançada.
function somGiro() {
    const ctx = audioPronto();
    if (!ctx) return;
    ruido(ctx, { duracao: 0.8, filtro: "bandpass", freq: 300, freqFim: 2200, ataque: 0.35, volume: 0.25 });
    tom(ctx, { freq: 180, freqFim: 520, duracao: 0.7, tipo: "triangle", volume: 0.07 });
}

// Clique a cada salto da borda (mais forte na desaceleração final).
function somTique(forte) {
    const ctx = audioPronto();
    if (!ctx) return;
    tom(ctx, { freq: forte ? 1250 : 1000, duracao: 0.04, tipo: "triangle", volume: forte ? 0.09 : 0.045 });
}

function somPouso(ctx, inicio) {
    tom(ctx, { freq: 330, freqFim: 110, inicio, duracao: 0.22, tipo: "sine", volume: 0.35 });
    ruido(ctx, { inicio, duracao: 0.05, filtro: "highpass", freq: 3000, freqFim: 5000, ataque: 0.003, volume: 0.2 });
}

function somVitoria(ctx, inicio) {
    [523, 659, 784, 1047].forEach((freq, i) => {
        tom(ctx, { freq, inicio: inicio + i * 0.09, duracao: i === 3 ? 0.6 : 0.25, tipo: "triangle", volume: 0.16 });
    });
}

function somDerrota(ctx, inicio) {
    tom(ctx, { freq: 392, inicio, duracao: 0.25, tipo: "triangle", volume: 0.14 });
    tom(ctx, { freq: 294, inicio: inicio + 0.18, duracao: 0.45, tipo: "triangle", volume: 0.14 });
}

// resultado: "ganhou" | "perdeu" | "sem-aposta"
function somResultado(resultado) {
    const ctx = audioPronto();
    if (!ctx) return;
    somPouso(ctx, 0);
    if (resultado === "ganhou") somVitoria(ctx, 0.25);
    else if (resultado === "perdeu") somDerrota(ctx, 0.25);
}

// Toca cada som no máximo uma vez por rodada — e nunca no 1º poll depois
// de abrir a página (o estado já estava em andamento, não é um evento novo).
function tocarUmaVez(tipo, rodadaId, funcao) {
    if (somTocadoNaRodada[tipo] === rodadaId) return;
    somTocadoNaRodada[tipo] = rodadaId;
    if (!primeiraSincronizacao) funcao();
}

function atualizarBotaoSom() {
    const btn = document.getElementById("btn-som");
    if (!btn) return;
    btn.innerText = somAtivo ? "🔊" : "🔇";
    btn.classList.toggle("mudo", !somAtivo);
    btn.title = somAtivo ? "Som ligado" : "Som desligado";
    btn.setAttribute("aria-label", somAtivo ? "Desativar som" : "Ativar som");
}

function alternarSom() {
    somAtivo = !somAtivo;
    try { localStorage.setItem("roleta_som", somAtivo ? "on" : "off"); } catch (e) { /* sem storage */ }
    atualizarBotaoSom();
    desbloquearAudio();
}

/* ---------- ESTADO DA RODADA ---------- */

function atualizarStatusBadge(status) {
    const badge = document.getElementById("status-badge");
    const roda = document.getElementById("roda-decorativa");
    badge.classList.remove("aberta", "rodando", "encerrada");
    roda.classList.remove("girando");

    if (status === "waiting_for_bets") {
        badge.innerText = "Apostas abertas";
        badge.classList.add("aberta");
    } else if (status === "running") {
        badge.innerText = "Rodada em andamento — bola girando";
        badge.classList.add("rodando");
        roda.classList.add("girando");
    } else if (status === "ended") {
        badge.innerText = "Rodada encerrada";
        badge.classList.add("encerrada");
    } else {
        badge.innerText = "Aguardando início da rodada...";
    }
}

function mostrarNumeroResultado(numero) {
    const el = document.getElementById("resultado-numero");
    el.classList.remove("oculto", "vermelho", "preto", "verde");
    el.classList.add(corDoNumero(numero));
    el.innerText = String(numero);
}

function ocultarNumeroResultado() {
    const el = document.getElementById("resultado-numero");
    el.classList.add("oculto");
}

function registrarHistorico(numero) {
    historicoNumeros.unshift(numero);
    if (historicoNumeros.length > 14) historicoNumeros.pop();

    const lista = document.getElementById("historico-lista");
    lista.innerHTML = "";
    historicoNumeros.forEach((n) => {
        const badge = document.createElement("div");
        badge.className = `historico-item ${corDoNumero(n)}`;
        badge.innerText = String(n);
        lista.appendChild(badge);
    });
}

function limparResultadoMsg() {
    const msg = document.getElementById("resultado-msg");
    msg.className = "resultado-msg";
    msg.innerText = "";
}

function apostaGanhou(aposta, numeroSorteado) {
    if (aposta.number_bet !== undefined && aposta.number_bet !== null && aposta.number_bet !== -1) {
        return aposta.number_bet === numeroSorteado;
    }
    if (aposta.color_bet && aposta.color_bet !== "none") {
        return numeroSorteado !== 0 && aposta.color_bet === corDoNumero(numeroSorteado);
    }
    return false;
}

function ganhoDaAposta(aposta, numeroSorteado) {
    if (!apostaGanhou(aposta, numeroSorteado)) return 0;
    if (aposta.number_bet !== undefined && aposta.number_bet !== null && aposta.number_bet !== -1) {
        return Math.round(aposta.money_bet * PAGAMENTO_NUMERO_MULT * 100) / 100;
    }
    return Math.round(aposta.money_bet * PAGAMENTO_COR_MULT * 100) / 100;
}

function mostrarResultadoPessoal(numeroSorteado) {
    const msg = document.getElementById("resultado-msg");
    msg.className = "resultado-msg";

    if (!minhasApostas || minhasApostas.length === 0) {
        msg.innerText = `Número sorteado: ${numeroSorteado}. Você não apostou nesta rodada.`;
        msg.classList.add("perdeu");
        return "sem-aposta";
    }

    let totalGanho = 0;
    let acertos = 0;
    minhasApostas.forEach((aposta) => {
        const ganho = ganhoDaAposta(aposta, numeroSorteado);
        if (ganho > 0) {
            totalGanho += ganho;
            acertos += 1;
        }
    });

    if (totalGanho > 0) {
        msg.innerText = `Saiu o ${numeroSorteado}! Você acertou ${acertos} de ${minhasApostas.length} aposta(s) e ganhou ${formataDinheiro(totalGanho)}.`;
        msg.classList.add("ganhou");
        return "ganhou";
    }
    msg.innerText = `Saiu o ${numeroSorteado}. Nenhuma das suas ${minhasApostas.length} aposta(s) venceu desta vez.`;
    msg.classList.add("perdeu");
    return "perdeu";
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

        const temNumero = aposta.number_bet !== undefined && aposta.number_bet !== null && aposta.number_bet !== -1;
        const temCor = aposta.color_bet && aposta.color_bet !== "none";

        const bolinha = document.createElement("span");
        if (temNumero) {
            bolinha.className = `jogador-numero ${corDoNumero(aposta.number_bet)}`;
            bolinha.innerText = String(aposta.number_bet);
        } else if (temCor) {
            bolinha.className = `jogador-numero ${aposta.color_bet}`;
            bolinha.innerText = aposta.color_bet === "vermelho" ? "V" : "P";
        } else {
            bolinha.className = "jogador-numero verde";
            bolinha.innerText = "?";
        }

        const nome = document.createElement("span");
        nome.className = "jogador-nome";
        const rotuloAposta = temNumero ? `nº ${aposta.number_bet}` : (temCor ? aposta.color_bet : "—");
        nome.innerText = ehVoce ? `Você (${rotuloAposta})` : `${aposta.player.name} (${rotuloAposta})`;

        const valor = document.createElement("span");
        valor.className = "jogador-valor";
        valor.innerText = formataDinheiro(aposta.money_bet);

        linha.appendChild(bolinha);
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

async function confirmarAposta() {
    if ((numeroSelecionado === null && corSelecionada === null) || statusAtual !== "waiting_for_bets") return;
    if (!jogadorID) { mostrarErro("Aguardando conexão com a API..."); return; }
    if (apostaAtual > saldoAtual) { mostrarErro("Saldo insuficiente para essa aposta."); return; }
    if (!rodadaAtualId) { mostrarErro("Nenhuma rodada aberta no momento."); return; }

    const btn = document.getElementById("btn-apostar");
    const textoBtn = document.getElementById("btn-apostar-texto");
    btn.disabled = true;
    textoBtn.innerText = "Enviando aposta...";

    const payload = {
        player: jogadorID,
        number_bet: numeroSelecionado !== null ? numeroSelecionado : -1,
        color_bet: corSelecionada !== null ? corSelecionada : "none",
        money_bet: apostaAtual,
    };

    try {
        const resp = await fetch(`${baseUrl}/roulette/games/${rodadaAtualId}/join`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!resp.ok) {
            let detalhe = "Não foi possível registrar a aposta.";
            try {
                const corpo = await resp.json();
                if (corpo && corpo.detail) detalhe = corpo.detail;
            } catch (e) { /* sem corpo JSON */ }
            mostrarErro(detalhe);
            atualizarBotaoApostar();
            return;
        }

        // Dedução otimista; o saldo oficial é sincronizado no próximo poll.
        saldoAtual = Math.round((saldoAtual - apostaAtual) * 100) / 100;
        modificarSaldoNaTela(saldoAtual);
        minhasApostas.push(payload);

        // Limpa a seleção para permitir uma nova aposta (em outro número/cor)
        // ainda dentro da mesma rodada.
        numeroSelecionado = null;
        corSelecionada = null;
        limparSelecaoVisual();
        atualizarBotaoApostar();
    } catch (error) {
        mostrarErro("Erro de conexão ao apostar.");
        atualizarBotaoApostar();
    }
}

// Mostra o número sorteado, destaca vencedores, atualiza histórico/saldo.
// Só é chamada depois que a bola "pousou" (ou direto, se a página abriu com
// a rodada já encerrada).
async function revelarResultado(idRodada, numero, semSom) {
    pararGiroCursor();
    mostrarNumeroResultado(numero);
    destacarVencedores(numero);
    registrarHistorico(numero);
    const resultado = mostrarResultadoPessoal(numero);
    if (!semSom) somResultado(resultado);
    atualizarStatusBadge(statusAtual);

    const saldo = await obterSaldo();
    if (saldo !== null && saldo !== undefined) {
        saldoAtual = saldo;
        modificarSaldoNaTela(saldoAtual);
    }
}

async function processarRodada(rodada) {
    const novoId = rodada ? rodada.id : null;

    if (novoId !== rodadaAtualId) {
        // Se a bola ainda estava pousando, conclui o resultado da rodada
        // anterior (histórico/saldo) antes de limpar a tela.
        if (revelacaoPendente) {
            const pendente = revelacaoPendente;
            revelacaoPendente = null;
            pendente(true);
        }
        pararGiroCursor();
        rodadaAtualId = novoId;
        minhasApostas = [];
        limparSelecaoTabuleiro();
        limparResultadoMsg();
        ocultarNumeroResultado();
        apostaProcessadaId = null;
    }

    statusAtual = rodada ? rodada.status : null;
    // Enquanto a bola desacelera, o selo continua mostrando "bola girando".
    atualizarStatusBadge(modoCursor === "pousando" ? "running" : statusAtual);

    if (rodada && statusAtual === "waiting_for_bets") tocarUmaVez("abertura", rodada.id, somAbertura);
    if (rodada && statusAtual === "running") {
        tocarUmaVez("giro", rodada.id, somGiro);
        iniciarGiroCursor();
    } else if (modoCursor === "girando") {
        // Rodada saiu de "running" sem número sorteado ainda (ou sem rodada): pausa a borda.
        if (!(rodada && statusAtual === "ended")) pararGiroCursor();
    }

    if (!rodada) {
        aplicarBloqueioTabuleiro();
        atualizarBotaoApostar();
        return;
    }

    // Sincroniza apostas desta rodada (inclui todas as nossas, se já feitas
    // antes de um reload de página, e as de todos os outros jogadores
    // conectados). Um mesmo jogador pode aparecer várias vezes na lista,
    // uma linha por aposta feita.
    try {
        const apostas = await apiGet(`/roulette/games/${rodada.id}/players`);
        renderizarJogadores(apostas);
        const minhas = apostas.filter((a) => a.player.id === jogadorID);
        if (minhas.length > 0) minhasApostas = minhas;
    } catch (error) {
        // painel de jogadores é informativo; falha aqui não trava o jogo
    }

    aplicarBloqueioTabuleiro();
    atualizarBotaoApostar();

    if (rodada.status === "ended" && rodada.number_draw !== null && rodada.number_draw !== undefined) {
        if (apostaProcessadaId !== rodada.id) {
            apostaProcessadaId = rodada.id;
            const idRodada = rodada.id;
            const numero = rodada.number_draw;

            if (primeiraSincronizacao) {
                // Página aberta com a rodada já encerrada: mostra direto, sem animação nem som.
                await revelarResultado(idRodada, numero, true);
            } else {
                revelacaoPendente = (semSom) => revelarResultado(idRodada, numero, semSom);
                pousarCursor(numero, () => {
                    const pendente = revelacaoPendente;
                    revelacaoPendente = null;
                    if (pendente) pendente(false);
                });
            }
        }
    } else {
        ocultarNumeroResultado();
    }
}

async function tick() {
    if (pollEmAndamento) return;
    pollEmAndamento = true;
    try {
        const rodada = await apiGet("/roulette/games/current");
        await processarRodada(rodada);
        primeiraSincronizacao = false;
    } catch (error) {
        atualizarStatusBadge(null);
    } finally {
        pollEmAndamento = false;
    }
}

async function inicializar() {
    gerarTabuleiro();
    atualizarBotaoSom();
    atualizarDisplayAposta();
    atualizarBotaoApostar();

    await sessaoInciada;

    const saldo = await obterSaldo();
    if (saldo !== null && saldo !== undefined) {
        saldoAtual = saldo;
        modificarSaldoNaTela(saldoAtual);
    }

    tick();
    setInterval(tick, INTERVALO_POLL_MS);
}

inicializar();
