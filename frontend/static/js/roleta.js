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
        el.classList.remove("selecionada", "vencedora");
    });
    document.querySelectorAll(".btn-cor").forEach((el) => {
        el.classList.remove("selecionada", "vencedora");
    });
    numeroSelecionado = null;
    corSelecionada = null;
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
        return;
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
    } else {
        msg.innerText = `Saiu o ${numeroSorteado}. Nenhuma das suas ${minhasApostas.length} aposta(s) venceu desta vez.`;
        msg.classList.add("perdeu");
    }
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

async function processarRodada(rodada) {
    const novoId = rodada ? rodada.id : null;

    if (novoId !== rodadaAtualId) {
        rodadaAtualId = novoId;
        minhasApostas = [];
        limparSelecaoTabuleiro();
        limparResultadoMsg();
        ocultarNumeroResultado();
        apostaProcessadaId = null;
    }

    statusAtual = rodada ? rodada.status : null;
    atualizarStatusBadge(statusAtual);

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
        mostrarNumeroResultado(rodada.number_draw);

        if (apostaProcessadaId !== rodada.id) {
            apostaProcessadaId = rodada.id;
            destacarVencedores(rodada.number_draw);
            registrarHistorico(rodada.number_draw);
            mostrarResultadoPessoal(rodada.number_draw);
            const saldo = await obterSaldo();
            if (saldo !== null && saldo !== undefined) {
                saldoAtual = saldo;
                modificarSaldoNaTela(saldoAtual);
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
    } catch (error) {
        atualizarStatusBadge(null);
    } finally {
        pollEmAndamento = false;
    }
}

async function inicializar() {
    gerarTabuleiro();
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
