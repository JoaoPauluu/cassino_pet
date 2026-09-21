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

// Gráfico: a trilha "cresce" até esta fração da área útil e depois os eixos
// passam a se expandir, mantendo o foguete sempre visível.
const PROPORCAO_ALVO = 0.88;
const MARGEM_GRAFICO = { esq: 46, dir: 16, topo: 16, base: 26 };
const REDUZIR_MOVIMENTO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
let ultimoMultiplicadorExibido = null; // evita reescrever o botão a cada frame
let primeiraSincronizacao = true;      // 1º poll só registra o estado: não toca sons "atrasados"
const somTocadoNaRodada = { abertura: null, decolagem: null, explosao: null };

/* ---------- FÓRMULA DE MULTIPLICADOR (espelho do backend) ---------- */

// Converte segundos decorridos no multiplicador correspondente.
// Espelha fielmente time_to_crash_multiplier() do backend.
function tempoParaMultiplicador(segundos, taxaCrescimento = TAXA_CRESCIMENTO, subUm = true) {
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
function tempoDeCrescimento() {
    if (!inicioRodada) return null;
    // Compensa pelos 15 segundos de diferença.
    const decorrido = (Date.now() - (inicioRodada.getTime() + 15000)) / 1000;
    if (decorrido < DURACAO_SUB_UM) return null;
    return decorrido - DURACAO_SUB_UM;
}

function multiplicadorAgora() {
    const t = tempoDeCrescimento();
    if (t === null) return null;
    return tempoParaMultiplicador(t, TAXA_CRESCIMENTO, false);
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

/* ---------- PALCO / GRÁFICO DO FOGUETE ---------- */

// O foguete sobe ao longo da curva m(t) = e^(k·t), desenhada num <canvas>.
// Os eixos se expandem conforme o multiplicador cresce. Quanto maior o
// multiplicador ("altitude"), mais o foguete chacoalha.

let grafico = null;                       // {ctx, largura, altura}
let ultimoDesenho = { t: null, caiu: false };
const coresGrafico = {};

function lerCoresDoTema() {
    const css = getComputedStyle(document.documentElement);
    const pegar = (nome, padrao) => css.getPropertyValue(nome).trim() || padrao;
    coresGrafico.grade = pegar("--border-color", "#2a3441");
    coresGrafico.texto = pegar("--text-muted", "#8a94a6");
    coresGrafico.linha = pegar("--gold-bright", "#f5d872");
    coresGrafico.caiu = pegar("--crash-baixo", "#c0392b");
}

function redimensionarGrafico() {
    const canvas = document.getElementById("canvas-crash");
    const caixa = document.getElementById("grafico-crash");
    const largura = caixa.clientWidth;
    const altura = caixa.clientHeight;
    if (!largura || !altura) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(largura * dpr);
    canvas.height = Math.round(altura * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    grafico = { ctx, largura, altura };
    desenharGrafico(ultimoDesenho.t, ultimoDesenho.caiu);
}

// Passo "redondo" (1, 2, 5 × 10^n) para as linhas de grade.
function passoBonito(faixa, alvo) {
    const bruto = faixa / alvo;
    const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
    const norm = bruto / pot;
    const fator = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    return fator * pot;
}

// Intensidade do chacoalhar (0 a 1): cresce com o multiplicador; 20x = máximo.
function intensidadeDoTremor(m) {
    return Math.min(1, Math.log(Math.max(m, 1)) / Math.log(20));
}

// t = segundos de crescimento (null = ainda preparando a decolagem).
function desenharGrafico(t, caiu) {
    ultimoDesenho = { t, caiu };
    if (!grafico) return;
    const { ctx, largura, altura } = grafico;
    const foguete = document.getElementById("foguete");

    const area = {
        x0: MARGEM_GRAFICO.esq,
        y0: MARGEM_GRAFICO.topo,
        x1: largura - MARGEM_GRAFICO.dir,
        y1: altura - MARGEM_GRAFICO.base,
    };
    area.w = area.x1 - area.x0;
    area.h = area.y1 - area.y0;

    const tAtual = t === null ? 0 : t;
    const m = Math.exp(TAXA_CRESCIMENTO * tAtual);
    const xMax = Math.max(10, tAtual / PROPORCAO_ALVO);
    const yMax = Math.max(2, 1 + (m - 1) / PROPORCAO_ALVO);
    const px = (seg) => area.x0 + (seg / xMax) * area.w;
    const py = (mult) => area.y1 - ((mult - 1) / (yMax - 1)) * area.h;

    ctx.clearRect(0, 0, largura, altura);

    // Grade e rótulos dos eixos
    ctx.lineWidth = 1;
    ctx.font = "11px sans-serif";
    ctx.fillStyle = coresGrafico.texto;
    ctx.strokeStyle = coresGrafico.grade;

    const passoY = passoBonito(yMax - 1, 4);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let v = 1; v <= yMax + 1e-9; v += passoY) {
        const y = Math.round(py(v)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(area.x0, y);
        ctx.lineTo(area.x1, y);
        ctx.stroke();
        ctx.fillText(`${v.toFixed(passoY < 1 ? 1 : 0)}x`, area.x0 - 6, y);
    }

    const passoX = passoBonito(xMax, 5);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let v = 0; v <= xMax + 1e-9; v += passoX) {
        const x = Math.round(px(v)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, area.y1);
        ctx.lineTo(x, area.y1 + 4);
        ctx.stroke();
        ctx.fillText(`${Math.round(v)}s`, x, area.y1 + 7);
    }

    // Curva percorrida até agora
    const cor = caiu ? coresGrafico.caiu : coresGrafico.linha;
    if (tAtual > 0) {
        const amostras = 120;
        ctx.beginPath();
        for (let i = 0; i <= amostras; i++) {
            const seg = (tAtual * i) / amostras;
            const x = px(seg);
            const y = py(Math.exp(TAXA_CRESCIMENTO * seg));
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }

        ctx.save();
        ctx.lineJoin = "round";
        ctx.lineWidth = 3;
        ctx.strokeStyle = cor;
        ctx.shadowColor = cor;
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.restore();

        ctx.lineTo(px(tAtual), area.y1);
        ctx.lineTo(px(0), area.y1);
        ctx.closePath();
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = cor;
        ctx.fill();
        ctx.restore();
    }

    // Foguete na ponta da curva, inclinado conforme a tangente
    const x = px(tAtual);
    const y = py(m);
    const inclinacaoX = area.w / xMax;
    const inclinacaoY = -(TAXA_CRESCIMENTO * m / (yMax - 1)) * area.h;
    const tangente = tAtual > 0 ? Math.atan2(inclinacaoY, inclinacaoX) : 0;
    let rotacao = tAtual > 0 ? (tangente * 180) / Math.PI + 45 : 0; // 🚀 aponta a 45° por padrão
    let dx = 0, dy = 0;

    if (!caiu && t !== null && !REDUZIR_MOVIMENTO) {
        const intensidade = Math.sqrt(intensidadeDoTremor(m));
        const amplitude = 0.4 + 7 * intensidade; // px
        dx = (Math.random() * 2 - 1) * amplitude;
        dy = (Math.random() * 2 - 1) * amplitude;
        rotacao += (Math.random() * 2 - 1) * (2 + 8 * intensidade);
    }

    foguete.style.transform =
        `translate(${(x + dx).toFixed(1)}px, ${(y + dy).toFixed(1)}px) translate(-50%, -50%) rotate(${rotacao.toFixed(1)}deg)`;
}

// m = multiplicador exibido (null durante a preparação).
function atualizarPalco(m, caiu = false) {
    const caixa = document.getElementById("grafico-crash");
    const foguete = document.getElementById("foguete");
    const numero = document.getElementById("multiplicador-numero");

    caixa.classList.toggle("caiu", caiu);
    foguete.classList.toggle("caiu", caiu);
    foguete.firstElementChild.innerText = caiu ? "💥" : "🚀";

    // A cor do número é sempre a mesma; só fica vermelha ao explodir.
    numero.classList.remove("caiu", "pulsando");

    if (caiu) {
        numero.innerText = m !== null ? `${m.toFixed(2)}x` : "—";
        numero.classList.add("caiu");
        desenharGrafico(m !== null ? Math.log(Math.max(m, 1)) / TAXA_CRESCIMENTO : 0, true);
        return;
    }

    if (m === null) {
        numero.innerText = "Preparando decolagem...";
        desenharGrafico(null, false);
        return;
    }

    numero.innerText = `${m.toFixed(2)}x`;
    if (statusAtual === "running") numero.classList.add("pulsando");
    desenharGrafico(tempoDeCrescimento(), false);
}

function resetarPalco() {
    ultimoMultiplicadorExibido = null;
    document.getElementById("grafico-crash").classList.remove("caiu");
    const foguete = document.getElementById("foguete");
    foguete.classList.remove("caiu");
    foguete.firstElementChild.innerText = "🚀";
    const numero = document.getElementById("multiplicador-numero");
    numero.className = "multiplicador-numero";
    numero.innerText = "Aguardando...";
    document.getElementById("crash-final").classList.add("oculto");
    desenharGrafico(null, false);
}

/* ---------- ANIMAÇÃO LOCAL (a cada frame, entre um poll e outro) ---------- */

function loopAnimacao() {
    animacaoId = null;
    if (statusAtual !== "running" || !inicioRodada) return;

    const m = multiplicadorAgora();
    atualizarPalco(m);
    if (m !== ultimoMultiplicadorExibido) {
        ultimoMultiplicadorExibido = m;
        atualizarBotaoAcao();
    }
    animacaoId = requestAnimationFrame(loopAnimacao);
}

function iniciarAnimacaoLocal() {
    if (animacaoId) return;
    animacaoId = requestAnimationFrame(loopAnimacao);
}

function pararAnimacaoLocal() {
    if (!animacaoId) return;
    cancelAnimationFrame(animacaoId);
    animacaoId = null;
}

/* ---------- EFEITOS SONOROS (Web Audio, sem arquivos) ---------- */

let audioCtx = null;
let somAtivo = true;
try { somAtivo = localStorage.getItem("crash_som") !== "off"; } catch (e) { /* sem storage */ }

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
    ganho.gain.exponentialRampToValueAtTime(volume, t0 + 0.015);
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

// Ronco de motor que acelera: decolagem.
function somDecolagem() {
    const ctx = audioPronto();
    if (!ctx) return;
    ruido(ctx, { duracao: 1.6, filtro: "lowpass", freq: 250, freqFim: 3000, ataque: 0.6, volume: 0.35 });
    tom(ctx, { freq: 70, freqFim: 320, duracao: 1.6, tipo: "sawtooth", volume: 0.08 });
}

// Estouro grave com chiado: explosão.
function somExplosao() {
    const ctx = audioPronto();
    if (!ctx) return;
    ruido(ctx, { duracao: 0.09, filtro: "highpass", freq: 2500, freqFim: 4000, ataque: 0.003, volume: 0.4 });
    ruido(ctx, { duracao: 1.1, filtro: "lowpass", freq: 3200, freqFim: 80, ataque: 0.01, volume: 0.6 });
    tom(ctx, { freq: 150, freqFim: 35, duracao: 0.7, tipo: "sine", volume: 0.55 });
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
    try { localStorage.setItem("crash_som", somAtivo ? "on" : "off"); } catch (e) { /* sem storage */ }
    atualizarBotaoSom();
    desbloquearAudio();
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

    if (rodada && statusAtual === "waiting_for_bets") tocarUmaVez("abertura", rodada.id, somAbertura);
    if (rodada && statusAtual === "running") tocarUmaVez("decolagem", rodada.id, somDecolagem);

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
        tocarUmaVez("explosao", rodada.id, somExplosao);

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
        primeiraSincronizacao = false;
    } catch (error) {
        atualizarStatusBadge(null);
    } finally {
        pollEmAndamento = false;
    }
}

async function inicializar() {
    atualizarDisplayAposta();
    atualizarBotaoAcao();
    atualizarBotaoSom();
    lerCoresDoTema();
    redimensionarGrafico();
    if (window.ResizeObserver) {
        new ResizeObserver(redimensionarGrafico).observe(document.getElementById("grafico-crash"));
    } else {
        window.addEventListener("resize", redimensionarGrafico);
    }
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
