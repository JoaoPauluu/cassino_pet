let jogoAtualID = "";
let statusUltimoJogo = "";
let corSelecionada = ""; // Guarda qual cor o jogador clicou

const numerosVermelhos = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];



// LÓGICA DE SELECIONAR COR NOS BOTÕES
function selecionarCor(cor, botaoClicado) {
    corSelecionada = cor;
    // Tira a borda dourada de todos
    document.querySelectorAll('.btn-color').forEach(b => b.classList.remove('selected'));
    // Coloca a borda dourada no clicado
    botaoClicado.classList.add('selected');
}

async function monitorarJogo() {
    if(!jogadorID) return;
    try {
        const res = await fetch(`${baseUrl}/roulette/games/current`);
        if (!res.ok) return; 
        
        const game = await res.json();
        jogoAtualID = game.id;

        if (game.status !== statusUltimoJogo) {
            statusUltimoJogo = game.status;
            atualizarInterface(game);
        }

        const playerRes = await fetch(`${baseUrl}/players/${jogadorID}`);
        if(playerRes.ok) modificarSaldoNaTela((await playerRes.json()).current_currency);

    } catch (error) {}
}

// --- ANIMAÇÃO EXTREMAMENTE FLUIDA ---
function criarBox(numero) {
    const box = document.createElement("div");
    box.classList.add("roleta-box");
    
    // Na blaze, a caixa Branca tem o símbolo dela. Aqui vamos por um ícone visual ou o zero
    box.innerText = numero === 0 ? "B" : numero; 
    
    if (numero === 0) box.classList.add("green"); // 'green' agora carrega css branco
    else if (numerosVermelhos.includes(numero)) box.classList.add("red");
    else box.classList.add("black");
    return box;
}

function prepararRoletaEstatica() {
    const track = document.getElementById("roleta-track");
    track.style.transition = "none";
    track.style.transform = "translate3d(0, 0, 0)";
    track.classList.remove("spin-infinite");
    track.innerHTML = "";
    
    for(let i = 0; i < 30; i++) track.appendChild(criarBox(Math.floor(Math.random() * 37)));
}

function girarRoletaInfinito() {
    const track = document.getElementById("roleta-track");
    track.style.transition = "none";
    track.classList.add("spin-infinite");
    track.innerHTML = "";
    
    // Repete um padrão para o CSS conseguir fazer loop liso sem solavancos
    for(let i = 0; i < 60; i++) track.appendChild(criarBox(Math.floor(Math.random() * 37)));
}

function pararRoletaNoResultado(numeroSorteado) {
    const track = document.getElementById("roleta-track");
    track.classList.remove("spin-infinite");
    track.style.transition = "none";
    track.style.transform = "translate3d(0, 0, 0)";
    track.innerHTML = "";

    const TAMANHO_BLOCO = 80; 

    for(let i = 0; i < 40; i++) track.appendChild(criarBox(Math.floor(Math.random() * 37)));
    track.appendChild(criarBox(numeroSorteado));
    for(let i = 0; i < 15; i++) track.appendChild(criarBox(Math.floor(Math.random() * 37)));

    // TRUQUE PROFISSIONAL: 
    // Double requestAnimationFrame força o navegador a limpar o cache visual 
    // antes de ativar a transição (Mata o travamento)
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            track.style.transition = "transform 4s cubic-bezier(0.1, 0.7, 0.1, 1)";
            track.style.transform = `translate3d(-${40 * TAMANHO_BLOCO}px, 0, 0)`;
        });
    });
}

function atualizarInterface(game) {
    const painel = document.getElementById("painel-apostas");
    const statusBar = document.getElementById("game-status");
    const btnApostar = document.getElementById("btn-apostar");

    if (game.status === "waiting_for_bets") {
        statusBar.innerText = "FAÇAM SUAS APOSTAS! O relógio está correndo...";
        statusBar.style.color = "#089981"; 
        painel.style.opacity = "1";
        btnApostar.disabled = false;
        prepararRoletaEstatica();

    } else if (game.status === "running") {
        statusBar.innerText = "APOSTAS ENCERRADAS - GIRANDO...";
        statusBar.style.color = "#ffd700"; 
        painel.style.opacity = "0.4";
        btnApostar.disabled = true;
        girarRoletaInfinito();

    } else if (game.status === "ended") {
        statusBar.innerText = `RESULTADO: ${game.number_draw === 0 ? 'BRANCO' : game.number_draw}`;
        statusBar.style.color = game.number_draw === 0 ? "#ffffff" : (numerosVermelhos.includes(game.number_draw) ? "#f23645" : "#777"); 
        painel.style.opacity = "0.4";
        btnApostar.disabled = true;
        
        pararRoletaNoResultado(game.number_draw);
        setTimeout(() => { adicionarAoHistorico(game.number_draw); }, 4000);
    }
}

async function fazerAposta() {
    const valor = parseFloat(document.getElementById("input-valor").value);

    // Validações antes de chamar a API
    if (!corSelecionada) return mostrarErro("⚠️ Selecione uma cor primeiro!");
    if (isNaN(valor) || valor <= 0) return mostrarErro("⚠️ Digite um valor válido.");

    document.getElementById("btn-apostar").disabled = true; 

    try {
        const response = await fetch(`${baseUrl}/roulette/games/${jogoAtualID}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // AVISO: Quando o João arrumar a API, mude 'number_bet' para 'color_bet' aqui se ele pedir
            body: JSON.stringify({ player: jogadorID, color_bet: corSelecionada, money_bet: valor })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Erro ao apostar.");
        }

        document.getElementById("input-valor").value = "";
        mostrarErro("✅ Aposta Confirmada!", "#089981");

        const pRes = await fetch(`${baseUrl}/players/${jogadorID}`);
        modificarSaldoNaTela((await pRes.json()).current_currency);

    } catch (error) {
        mostrarErro(error.message);
        document.getElementById("btn-apostar").disabled = false;
    }
}

function adicionarAoHistorico(numero) {
    const lista = document.getElementById("lista-historico");
    const li = document.createElement("li");
    li.innerText = numero === 0 ? "B" : numero;

    if (numero === 0) li.className = "green";
    else if (numerosVermelhos.includes(numero)) li.className = "red";
    else li.className = "black";

    lista.insertBefore(li, lista.firstChild);
    if(lista.children.length > 10) lista.removeChild(lista.lastChild);
}

async function carregarHistorico() {
    try {
        const res = await fetch(`${baseUrl}/roulette/games?status=ended&limit=10`);
        const games = await res.json();
        games.reverse().forEach(g => {
            if(g.number_draw !== null) adicionarAoHistorico(g.number_draw);
        });
    } catch(e) {}
}

async function iniciarSessaoRoleta() {
    carregarHistorico();
    prepararRoletaEstatica();
    setInterval(monitorarJogo, 1000);
}

iniciarSessaoRoleta();
