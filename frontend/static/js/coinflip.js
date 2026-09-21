// coinflip.js
// Depende de base.js (baseUrl, jogadorID, sessaoInciada, obterSaldo,
// modificarSaldoNaTela, formataDinheiro, mostrarErro) já carregado antes deste script.

const NOME_JOGO = "coinflip";
const APOSTA_MIN = 10;
const APOSTA_PASSO = 10;
const APOSTA_MAX_PADRAO = 500;
const PAGAMENTO_MULT = 1.98; 
const HISTORICO_MAX = 12;

let saldoAtual = 0;
let apostaAtual = APOSTA_MIN;
let ladoEscolhido = "cara";
let girando = false;
let rotacaoAtual = 0;
let historico = [];

const moedaEl = document.getElementById("moeda");

// ---------------------------------------------------------------
// EFEITOS SONOROS (Web Audio API, sintetizados, sem arquivos externos)
// ---------------------------------------------------------------
const Som = (() => {
    let ctx = null;
    let mudo = false;
    try { mudo = localStorage.getItem("coinflip_mudo") === "1"; } catch (e) {}

    // O AudioContext só pode iniciar após um gesto do usuário; girarMoeda()
    // é chamada por um clique, então criamos o contexto de forma preguiçosa.
    function contexto() {
        if (!ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            ctx = new AC();
        }
        if (ctx.state === "suspended") ctx.resume();
        return ctx;
    }

    function tom({ freq, inicio = 0, dur = 0.15, tipo = "sine", vol = 0.2, freqFim = null }) {
        if (mudo) return;
        const c = contexto();
        if (!c) return;
        const t0 = c.currentTime + inicio;
        const osc = c.createOscillator();
        const ganho = c.createGain();
        osc.type = tipo;
        osc.frequency.setValueAtTime(freq, t0);
        if (freqFim) osc.frequency.exponentialRampToValueAtTime(freqFim, t0 + dur);
        ganho.gain.setValueAtTime(0.0001, t0);
        ganho.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
        ganho.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(ganho).connect(c.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    }

    // Moeda sendo lançada: "flick" + tilintar que vai desacelerando + pouso
    function girar() {
        tom({ freq: 300, freqFim: 900, dur: 0.18, tipo: "triangle", vol: 0.12 });
        const N = 14, T = 1.4;
        for (let i = 1; i <= N; i++) {
            const u = i / N;
            tom({
                freq: 2300 + Math.random() * 400,
                inicio: 0.1 + T * u * u, // intervalos crescem = desacelera
                dur: 0.05,
                tipo: "triangle",
                vol: 0.07,
            });
        }
        tom({ freq: 1800, inicio: 1.5, dur: 0.25, vol: 0.14 });
        tom({ freq: 3600, inicio: 1.5, dur: 0.12, vol: 0.05 });
    }

    function ganhar() {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
            tom({ freq: f, inicio: i * 0.09, dur: 0.22, tipo: "triangle", vol: 0.2 })
        );
        tom({ freq: 2093, inicio: 0.4, dur: 0.5, vol: 0.08 });
        tom({ freq: 2637, inicio: 0.48, dur: 0.5, vol: 0.06 });
    }

    function perder() {
        [392, 349.23, 293.66, 220].forEach((f, i) =>
            tom({ freq: f, freqFim: f * 0.94, inicio: i * 0.16, dur: 0.28, tipo: "sawtooth", vol: 0.08 })
        );
    }

    function alternar() {
        mudo = !mudo;
        try { localStorage.setItem("coinflip_mudo", mudo ? "1" : "0"); } catch (e) {}
        if (!mudo) tom({ freq: 880, dur: 0.1, vol: 0.12 }); // feedback ao ligar
        return mudo;
    }

    return { girar, ganhar, perder, alternar, estaMudo: () => mudo };
})();

function atualizarBotaoSom() {
    const btn = document.getElementById("btn-som");
    if (!btn) return;
    const mudo = Som.estaMudo();
    btn.innerText = mudo ? "🔇" : "🔊";
    btn.title = mudo ? "Ativar som" : "Silenciar";
    btn.setAttribute("aria-pressed", String(mudo));
}

function alternarSom() {
    Som.alternar();
    atualizarBotaoSom();
}


function apostaMaxDisponivel() {
    return Math.max(APOSTA_MIN, Math.min(APOSTA_MAX_PADRAO, Math.floor(saldoAtual / APOSTA_PASSO) * APOSTA_PASSO));
}

function atualizarDisplayAposta() {
    document.getElementById("valor-aposta").innerText = formataDinheiro(apostaAtual);
}

function alterarAposta(delta) {
    if (girando) return;
    const novo = apostaAtual + delta;
    const max = apostaMaxDisponivel();
    if (novo < APOSTA_MIN || novo > Math.max(max, APOSTA_MIN)) return;
    apostaAtual = novo;
    atualizarDisplayAposta();
}

function apostaMax() {
    if (girando) return;
    apostaAtual = apostaMaxDisponivel();
    atualizarDisplayAposta();
}

function escolherLado(lado) {
    if (girando) return;
    ladoEscolhido = lado;
    document.getElementById("btn-cara").classList.toggle("ativo", lado === "cara");
    document.getElementById("btn-coroa").classList.toggle("ativo", lado === "coroa");
}

function limparResultadoVisual() {
    const msg = document.getElementById("resultado-msg");
    msg.className = "resultado-msg";
    msg.innerText = "";
}

function setControlesAtivos(ativo) {
    document.getElementById("btn-girar").disabled = !ativo;
    document.getElementById("btn-menos").disabled = !ativo;
    document.getElementById("btn-mais").disabled = !ativo;
    document.getElementById("btn-cara").disabled = !ativo;
    document.getElementById("btn-coroa").disabled = !ativo;
    document.getElementById("btn-girar-texto").innerText = ativo ? "JOGAR" : "GIRANDO...";
}

function animarMoeda(resultadoFinal) {
    return new Promise((resolve) => {
        const voltas = 5 + Math.floor(Math.random() * 3); // 5 a 7 voltas completas
        const alvoMod = resultadoFinal === "coroa" ? 180 : 0;
        const faltaAtual = ((alvoMod - (rotacaoAtual % 360)) + 360) % 360;
        rotacaoAtual += voltas * 360 + faltaAtual;

        moedaEl.style.transform = `rotateY(${rotacaoAtual}deg)`;

        setTimeout(resolve, 1550);
    });
}

function mostrarResultado(resultadoFinal, venceu, valorGanho) {
    const msg = document.getElementById("resultado-msg");
    const nomeLado = resultadoFinal === "cara" ? "Cara" : "Coroa";
    if (venceu) {
        msg.innerText = `Deu ${nomeLado}! Você ganhou ${formataDinheiro(valorGanho)}!`;
        msg.classList.add("ganhou");
    } else {
        msg.innerText = `Deu ${nomeLado}. Você perdeu ${formataDinheiro(apostaAtual)}.`;
        msg.classList.add("perdeu");
    }
}

function registrarHistorico(resultadoFinal, venceu) {
    historico.unshift({ resultado: resultadoFinal, venceu });
    if (historico.length > HISTORICO_MAX) historico.pop();

    const lista = document.getElementById("historico-lista");
    lista.innerHTML = "";
    historico.forEach((item) => {
        const badge = document.createElement("div");
        badge.className = `historico-item ${item.venceu ? "venceu" : "perdeu"}`;
        badge.innerText = item.resultado === "cara" ? "C" : "K";
        lista.appendChild(badge);
    });
}

async function enviarEstatistica(bet, win) {
    try {
        await fetch(`${baseUrl}/statistics`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ player: jogadorID, game: NOME_JOGO, bet: bet, win: win }),
        });
    } catch (error) {
        mostrarErro("Erro ao registrar estatística.", "#f23645");
    }
}

async function sincronizarSaldoServidor() {
    try {
        await fetch(`${baseUrl}/players/${jogadorID}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ current_currency: saldoAtual }),
        });
    } catch (error) {
        mostrarErro("Erro ao sincronizar saldo.", "#f23645");
    }
}

async function girarMoeda() {
    if (girando) return;
    if (!jogadorID) { mostrarErro("Aguardando conexão com a API..."); return; }
    if (apostaAtual > saldoAtual) { mostrarErro("Saldo insuficiente para essa aposta."); return; }

    girando = true;
    setControlesAtivos(false);
    limparResultadoVisual();

    const resultadoFinal = Math.random() < 0.5 ? "cara" : "coroa";

    Som.girar();
    await animarMoeda(resultadoFinal);

    const venceu = resultadoFinal === ladoEscolhido;
    const valorGanho = venceu ? Math.round(apostaAtual * PAGAMENTO_MULT * 100) / 100 : 0;

    saldoAtual = Math.round((saldoAtual - apostaAtual + valorGanho) * 100) / 100;
    modificarSaldoNaTela(saldoAtual);
    mostrarResultado(resultadoFinal, venceu, valorGanho);
    registrarHistorico(resultadoFinal, venceu);
    if (venceu) Som.ganhar(); else Som.perder();

    await enviarEstatistica(apostaAtual, valorGanho);
    await sincronizarSaldoServidor();

    if (apostaAtual > apostaMaxDisponivel() && apostaMaxDisponivel() >= APOSTA_MIN) {
        apostaAtual = apostaMaxDisponivel();
        atualizarDisplayAposta();
    }

    girando = false;
    setControlesAtivos(true);
}

async function inicializar() {
    atualizarBotaoSom();
    atualizarDisplayAposta();
    setControlesAtivos(false);
    document.getElementById("btn-girar-texto").innerText = "CONECTANDO...";

    await sessaoInciada;

    const saldo = await obterSaldo();
    if (saldo !== null && saldo !== undefined) {
        saldoAtual = saldo;
        modificarSaldoNaTela(saldoAtual);
    }
    setControlesAtivos(true);
}

inicializar();
