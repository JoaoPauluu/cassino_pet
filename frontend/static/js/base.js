let baseUrl = "";
let jogadorID = ""; 

function configurarSistema() {
    let ipSalvo = localStorage.getItem("pet_api_ip") || "localhost:8000"; 
    let dispSalvo = localStorage.getItem("pet_dispositivo") || "Tablet 01"; 
    
    let novoIP = prompt("⚙️ 1/2 - IP da API (ex: 192.168.0.15:8080):", ipSalvo);
    if (novoIP) {
        localStorage.setItem("pet_api_ip", novoIP);
        let novoDisp = prompt("⚙️ 2/2 - Nome deste Tablet:", dispSalvo);
        if (novoDisp) {
            localStorage.setItem("pet_dispositivo", novoDisp);
            window.location.reload(); 
        }
    }
}

function formataDinheiro(dinheiro) {
    return dinheiro.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); 
    }

function modificarSaldoNaTela(v) {
    document.getElementById("saldo-jogador").innerText = formataDinheiro(v);
}

async function buscarJogador(nome, dispositivo) {
    try {
        const response = await fetch(`${baseUrl}/players?name=${nome}&device=${dispositivo}`);
        const players = await response.json();
        return players.length > 0 ? players[0] : null;
    } catch (error) {
        throw new Error("Erro ao buscar jogador.");
    }
}

async function criarJogador(nome, dispositivo) {
    try {
        const response = await fetch(`${baseUrl}/players`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: nome, device: dispositivo})
        });
        return await response.json();
    } catch (error) {
        throw new Error("Erro ao criar jogador.");
    }
}

async function obterSaldo() {
    if (!jogadorID) return;
    try {
        const response = await fetch(`${baseUrl}/players/${jogadorID}`);
        const jogador = await response.json();
        return jogador.current_currency;
    } catch (error) {
        mostrarErro("Erro ao obter saldo.", "#f23645");
        return null;
    }
}

async function atualizarSaldo() {
    if (!jogadorID) return;
    modificarSaldoNaTela(await obterSaldo());
}

function mostrarErro(msg, cor = "#f23645") {
    const el = document.getElementById("mensagem-erro");
    el.innerText = msg; el.style.color = cor;
    setTimeout(() => { el.innerText = ""; }, 4000);
}

async function iniciarSessao() {
    let ipAPI = localStorage.getItem("pet_api_ip");
    let nomeDispositivo = localStorage.getItem("pet_dispositivo");
    
    if (!ipAPI || !nomeDispositivo) {
        configurarSistema();
        return;
    }
    baseUrl = `http://${ipAPI}`;

    // O nome do jogador agora vem da sessao do Flask (definido na tela
    // /entrar), em vez de perguntar aqui com prompt().
    if (jogadorNome === null) jogadorNome = "Jogador Anônimo";
    
    document.getElementById("nome-jogador").innerText = `${jogadorNome} (${nomeDispositivo})`;

    try {
        jogador = await buscarJogador(jogadorNome, nomeDispositivo);
        if (jogador) {
            jogadorID = jogador.id;
            modificarSaldoNaTela(jogador.current_currency);
        } 
        if (!jogador) {
            novoJogador = await criarJogador(jogadorNome, nomeDispositivo);
            jogadorID = novoJogador.id;
            modificarSaldoNaTela(novoJogador.current_currency);
        }

    } catch (error) { mostrarErro("Erro de Conexão com a API", "#f23645"); }
}




const sessaoInciada = iniciarSessao();