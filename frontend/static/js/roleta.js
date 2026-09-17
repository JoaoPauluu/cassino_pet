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

const NOME_JOGO = "roleta";
const APOSTA_MIN = 10;
const APOSTA_PASSO = 10;
const APOSTA_MAX_PADRAO = 500;
const INTERVALO_POLL_MS = 1500;
const PAGAMENTO_NUMERO_MULT = 36;

const NUMEROS_VERMELHOS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

function corDoNumero(n) {
    if (n === 0) return "verde";
    return NUMEROS_VERMELHOS.has(n) ? "vermelho" : "preto";
}

let saldoAtual = 0;
let apostaAtual = APOSTA_MIN;
let numeroSelecionado = null;

let rodadaAtualId = null;
let statusAtual = null;
let apostaProcessadaId = null; // id da rodada cujo resultado já foi exibido
let minhaAposta = null; // {number_bet, money_bet} nesta rodada, vindo do servidor
let historicoNumeros = [];
let pollEmAndamento = false;

function apostaMaxDisponivel() {
    return Math.max(APOSTA_MIN, Math.min(APOSTA_MAX_PADRAO, Math.floor(saldoAtual / APOSTA_PASSO) * APOSTA_PASSO));
}

function atualizarDisplayAposta() {
    document.getElementById("valor-aposta").innerText = formataDinheiro(apostaAtual);
}

function alterarAposta(delta) {
    if (minhaAposta) return;
    const novo = apostaAtual + delta;
    const max = apostaMaxDisponivel();
    if (novo < APOSTA_MIN || novo > Math.max(max, APOSTA_MIN)) return;
    apostaAtual = novo;
    atualizarDisplayAposta();
}

function apostaMax() {
    if (minhaAposta) return;
    apostaAtual = apostaMaxDisponivel();
    atualizarDisplayAposta();
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

function selecionarNumero(n) {
    if (minhaAposta || statusAtual !== "waiting_for_bets") return;
    numeroSelecionado = n;
    document.querySelectorAll(".casa").forEach((el) => {
        el.classList.toggle("selecionada", Number(el.dataset.numero) === n);
    });
    atualizarBotaoApostar();
}

function atualizarBotaoApostar() {
    const btn = document.getElementById("btn-apostar");
    const texto = document.getElementById("btn-apostar-texto");

    if (minhaAposta) {
        btn.disabled = true;
        texto.innerText = `Aposta feita: nº ${minhaAposta.number_bet}`;
        return;
    }
    if (statusAtual !== "waiting_for_bets") {
        btn.disabled = true;
        texto.innerText = statusAtual === "running" ? "Apostas encerradas" : "Aguardando abertura das apostas...";
        return;
    }
    if (numeroSelecionado === null) {
        btn.disabled = true;
        texto.innerText = "Selecione um número";
        return;
    }
    btn.disabled = false;
    texto.innerText = `Apostar no ${numeroSelecionado}`;
}

function aplicarBloqueioTabuleiro() {
    const travado = !!minhaAposta || statusAtual !== "waiting_for_bets";
    document.querySelectorAll(".casa").forEach((el) => {
        el.classList.toggle("desabilitada", travado);
    });
}

function destacarNumeroVencedor(numero) {
    document.querySelectorAll(".casa").forEach((el) => {
        el.classList.toggle("vencedora", Number(el.dataset.numero) === numero);
    });
}

function limparSelecaoTabuleiro() {
    document.querySelectorAll(".casa").forEach((el) => {
        el.classList.remove("selecionada", "vencedora");
    });
    numeroSelecionado = null;
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

function mostrarResultadoPessoal(numeroSorteado) {
    const msg = document.getElementById("resultado-msg");
    if (!minhaAposta) {
        msg.innerText = `Número sorteado: ${numeroSorteado}. Você não apostou nesta rodada.`;
        msg.classList.add("perdeu");
        return;
    }
    const venceu = minhaAposta.number_bet === numeroSorteado;
    if (venceu) {
        const ganhoEstimado = Math.round(minhaAposta.money_bet * PAGAMENTO_NUMERO_MULT * 100) / 100;
        msg.innerText = `Você acertou o ${numeroSorteado}! Ganhou ${formataDinheiro(ganhoEstimado)}.`;
        msg.classList.add("ganhou");
    } else {
        msg.innerText = `Saiu o ${numeroSorteado}. Você apostou no ${minhaAposta.number_bet} e não foi dessa vez.`;
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
        const ehVoce = aposta.player === jogadorID;
        const linha = document.createElement("div");
        linha.className = `jogador-linha ${ehVoce ? "voce" : ""}`;

        const bolinha = document.createElement("span");
        bolinha.className = `jogador-numero ${corDoNumero(aposta.number_bet)}`;
        bolinha.innerText = String(aposta.number_bet);

        const nome = document.createElement("span");
        nome.className = "jogador-nome";
        nome.innerText = ehVoce ? "Você" : `Jogador #${String(aposta.player).slice(-4)}`;

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
    if (minhaAposta || numeroSelecionado === null || statusAtual !== "waiting_for_bets") return;
    if (!jogadorID) { mostrarErro("Aguardando conexão com a API..."); return; }
    if (apostaAtual > saldoAtual) { mostrarErro("Saldo insuficiente para essa aposta."); return; }
    if (!rodadaAtualId) { mostrarErro("Nenhuma rodada aberta no momento."); return; }

    const btn = document.getElementById("btn-apostar");
    btn.disabled = true;
    document.getElementById("btn-apostar-texto").innerText = "Enviando aposta...";

    try {
        const resp = await fetch(`${baseUrl}/roulette/games/${rodadaAtualId}/join`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ player: jogadorID, number_bet: numeroSelecionado, money_bet: apostaAtual }),
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
        minhaAposta = { number_bet: numeroSelecionado, money_bet: apostaAtual };
        aplicarBloqueioTabuleiro();
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
        minhaAposta = null;
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

    // Sincroniza apostas desta rodada (inclui a nossa, se já feita antes de
    // um reload de página, e as de todos os outros jogadores conectados).
    try {
        const apostas = await apiGet(`/roulette/games/${rodada.id}/players`);
        renderizarJogadores(apostas);
        const minha = apostas.find((a) => a.player === jogadorID);
        minhaAposta = minha ? { number_bet: minha.number_bet, money_bet: minha.money_bet } : minhaAposta;
    } catch (error) {
        // painel de jogadores é informativo; falha aqui não trava o jogo
    }

    aplicarBloqueioTabuleiro();
    atualizarBotaoApostar();

    if (rodada.status === "ended" && rodada.number_draw !== null && rodada.number_draw !== undefined) {
        mostrarNumeroResultado(rodada.number_draw);

        if (apostaProcessadaId !== rodada.id) {
            apostaProcessadaId = rodada.id;
            destacarNumeroVencedor(rodada.number_draw);
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
