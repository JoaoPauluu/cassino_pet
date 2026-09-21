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

    await animarMoeda(resultadoFinal);

    const venceu = resultadoFinal === ladoEscolhido;
    const valorGanho = venceu ? Math.round(apostaAtual * PAGAMENTO_MULT * 100) / 100 : 0;

    saldoAtual = Math.round((saldoAtual - apostaAtual + valorGanho) * 100) / 100;
    modificarSaldoNaTela(saldoAtual);
    mostrarResultado(resultadoFinal, venceu, valorGanho);
    registrarHistorico(resultadoFinal, venceu);

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
