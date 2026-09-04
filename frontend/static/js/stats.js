// Puxa o IP salvo no cache. Se não tiver, usa localhost.
let ipSalvo = localStorage.getItem("pet_api_ip") || "localhost:8000";
const API_URL = `http://${ipSalvo}/statistics/summary`;

const BANCA_INICIAL = 1000000.00;

function formatarMoeda(valor) {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function atualizarDashboard() {
    try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error("Erro na API");
        const data = await response.json();

        const handle = data.total_bet; 
        const ggr = data.total_bet - data.total_win; 
        const bancaAtual = BANCA_INICIAL + ggr;

        const holdPct = handle > 0 ? (ggr / handle) * 100 : 0;
        const payoutPct = handle > 0 ? (data.total_win / handle) * 100 : 0;
        const tiqueteMedio = data.rounds_played > 0 ? (handle / data.rounds_played) : 0;

        document.getElementById('saldo-banca').innerText = formatarMoeda(bancaAtual);
        document.getElementById('handle').innerText = formatarMoeda(handle);
        document.getElementById('ggr').innerText = formatarMoeda(ggr);
        
        const elGgr = document.getElementById('ggr');
        elGgr.className = ggr >= 0 ? "card-value text-green" : "card-value text-red";

        document.getElementById('hold-pct').innerText = holdPct.toFixed(2) + "%";
        document.getElementById('payout-pct').innerText = payoutPct.toFixed(2) + "%";
        document.getElementById('tiquete').innerText = formatarMoeda(tiqueteMedio);
        document.getElementById('total-apostas').innerText = data.rounds_played;

    } catch (error) {
        console.error("Tentando reconectar...", error);
    }
}

atualizarDashboard();
setInterval(atualizarDashboard, 2000); // Atualiza a cada 2 segundos
