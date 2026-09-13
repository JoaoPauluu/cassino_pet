// caca_niquel.js
// Depende de base.js (baseUrl, jogadorID, sessaoInciada, obterSaldo,
// modificarSaldoNaTela, formataDinheiro, mostrarErro) já carregado antes deste script.

const NOME_JOGO = "caca-niquel";

const SIMBOLOS = [
    { id: "cherry", emoji: "🍒", img: "1f352", peso: 30, mult4: 4, mult3: 1.5 },
    { id: "lemon", emoji: "🍋", img: "1f34b", peso: 25, mult4: 6, mult3: 2 },
    { id: "bell", emoji: "🔔", img: "1f514", peso: 20, mult4: 10, mult3: 3 },
    { id: "diamond", emoji: "💎", img: "1f48e", peso: 15, mult4: 15, mult3: 5 },
    { id: "star", emoji: "⭐", img: "2b50", peso: 7, mult4: 25, mult3: 8 },
    { id: "clover", emoji: "🍀", img: "1f340", peso: 3, mult4: 50, mult3: 15 },
];
const PESO_TOTAL = SIMBOLOS.reduce((soma, s) => soma + s.peso, 0);
const PAR_CEREJA_MULT = 1;
const APOSTA_MIN = 10;
const APOSTA_PASSO = 10;
const APOSTA_MAX_PADRAO = 500;

function imgUrl(codigo) {
    return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${codigo}.png`;
}

let saldoAtual = 0;
let apostaAtual = APOSTA_MIN;
let girando = false;

const reels = Array.from(document.querySelectorAll(".reel"));

function sortearSimbolo() {
    let r = Math.random() * PESO_TOTAL;
    for (const s of SIMBOLOS) {
        if (r < s.peso) return s;
        r -= s.peso;
    }
    return SIMBOLOS[0];
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

function togglePaytable() {
    document.getElementById("paytable").classList.toggle("oculto");
}

function montarPaytable() {
    const grid = document.getElementById("paytable-grid");
    grid.innerHTML = "";
    [...SIMBOLOS].reverse().forEach((s) => {
        const row = document.createElement("div");
        row.className = "paytable-row";
        row.innerHTML = `
            <img src="${imgUrl(s.img)}" alt="${s.emoji}" onerror="this.outerHTML='<span style=\\'font-size:1.3rem\\'>${s.emoji}</span>'">
            <span class="simbolos">4 iguais · 3 iguais</span>
            <span class="mult">${s.mult4}x · ${s.mult3}x</span>
        `;
        grid.appendChild(row);
    });
}

function limparDestaques() {
    reels.forEach((r) => r.classList.remove("destaque"));
    const msg = document.getElementById("resultado-msg");
    msg.className = "resultado-msg";
}

function setControlesAtivos(ativo) {
    document.getElementById("btn-girar").disabled = !ativo;
    document.getElementById("btn-menos").disabled = !ativo;
    document.getElementById("btn-mais").disabled = !ativo;
    document.getElementById("btn-girar-texto").innerText = ativo ? "GIRAR" : "GIRANDO...";
}

function animarReel(reelEl, simboloFinal, index) {
    return new Promise((resolve) => {
        const imgEl = reelEl.querySelector(".reel-img");
        const fallbackEl = reelEl.querySelector(".reel-emoji-fallback");
        reelEl.classList.remove("parou");
        reelEl.classList.add("girando");

        const intervalo = setInterval(() => {
            const s = sortearSimbolo();
            definirSimboloVisual(imgEl, fallbackEl, s);
        }, 70);

        const duracao = 650 + index * 280;
        setTimeout(() => {
            clearInterval(intervalo);
            definirSimboloVisual(imgEl, fallbackEl, simboloFinal);
            reelEl.classList.remove("girando");
            reelEl.classList.add("parou");
            resolve();
        }, duracao);
    });
}

function definirSimboloVisual(imgEl, fallbackEl, simbolo) {
    imgEl.style.display = "block";
    fallbackEl.style.display = "none";
    imgEl.dataset.simbolo = simbolo.id;
    imgEl.alt = simbolo.emoji;
    imgEl.onerror = () => {
        imgEl.style.display = "none";
        fallbackEl.style.display = "block";
        fallbackEl.innerText = simbolo.emoji;
    };
    imgEl.src = imgUrl(simbolo.img);
}

function calcularResultado(resultadoFinal) {
    const contagem = {};
    resultadoFinal.forEach((s) => { contagem[s.id] = (contagem[s.id] || 0) + 1; });

    let melhorId = null;
    let melhorQtd = 0;
    for (const id in contagem) {
        if (contagem[id] > melhorQtd) { melhorQtd = contagem[id]; melhorId = id; }
    }
    const simboloVencedor = SIMBOLOS.find((s) => s.id === melhorId);

    if (melhorQtd === 4) {
        return { multiplicador: simboloVencedor.mult4, tipo: "jackpot", indices: [0, 1, 2, 3], simbolo: simboloVencedor };
    }
    if (melhorQtd === 3) {
        const indices = resultadoFinal.map((s, i) => (s.id === melhorId ? i : -1)).filter((i) => i >= 0);
        return { multiplicador: simboloVencedor.mult3, tipo: "grande", indices, simbolo: simboloVencedor };
    }
    if ((contagem["cherry"] || 0) >= 2) {
        const indices = resultadoFinal.map((s, i) => (s.id === "cherry" ? i : -1)).filter((i) => i >= 0);
        return { multiplicador: PAR_CEREJA_MULT, tipo: "consolo", indices, simbolo: SIMBOLOS[0] };
    }
    return { multiplicador: 0, tipo: "perdeu", indices: [], simbolo: null };
}

function mostrarResultado(valorGanho, tipo) {
    const msg = document.getElementById("resultado-msg");
    if (tipo === "jackpot") {
        msg.innerText = `🍀 COMBINAÇÃO PERFEITA! +${formataDinheiro(valorGanho)}`;
        msg.classList.add("jackpot");
    } else if (tipo === "grande" || tipo === "consolo") {
        msg.innerText = `Você ganhou ${formataDinheiro(valorGanho)}!`;
        msg.classList.add("ganhou");
    } else {
        msg.innerText = "Não foi dessa vez.";
        msg.classList.add("perdeu");
    }
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

async function girar() {
    if (girando) return;
    if (!jogadorID) { mostrarErro("Aguardando conexão com a API..."); return; }
    if (apostaAtual > saldoAtual) { mostrarErro("Saldo insuficiente para essa aposta."); return; }

    girando = true;
    setControlesAtivos(false);
    limparDestaques();

    const resultadoFinal = [sortearSimbolo(), sortearSimbolo(), sortearSimbolo(), sortearSimbolo()];

    await Promise.all(reels.map((reelEl, i) => animarReel(reelEl, resultadoFinal[i], i)));

    const { multiplicador, tipo, indices } = calcularResultado(resultadoFinal);
    const valorGanho = Math.round(apostaAtual * multiplicador * 100) / 100;

    indices.forEach((i) => reels[i].classList.add("destaque"));

    saldoAtual = Math.round((saldoAtual - apostaAtual + valorGanho) * 100) / 100;
    modificarSaldoNaTela(saldoAtual);
    mostrarResultado(valorGanho, tipo);

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
    montarPaytable();
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
