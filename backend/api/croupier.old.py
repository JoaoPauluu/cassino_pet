import time
import random
import requests




#======================
# SCRIPT DESNECESSÁRIO!! MAL IMPLEMENTADO!
#======================

# Endereço da sua API (se rodar em outro PC no dia, mude aqui)
BASE_URL = "http://localhost:8000"

def rodar_cassino():
    print("🎰 O Croupier chegou na mesa! Iniciando os jogos...\n")
    
    while True:
        try:
            # 1. CRIA UM NOVO JOGO
            res = requests.post(f"{BASE_URL}/roulette/games")
            if res.status_code != 201:
                print("Aguardando a API ligar...")
                time.sleep(5)
                continue
                
            game_id = res.json()["id"]
            print(f"🟢 NOVO JOGO INICIADO! (Esperando apostas por 15 segundos)")

            # 2. ESPERA 15 SEGUNDOS
            time.sleep(15)

            # 3. GIRA A ROLETA (Muda o status para 'running')
            print("🟡 APOSTAS ENCERRADAS! Girando a roleta (5 segundos)...")
            requests.patch(f"{BASE_URL}/roulette/games/{game_id}/status", json={"status": "running"})

            # 4. TEMPO DA ANIMAÇÃO DE GIRO NO TABLET
            time.sleep(5)

            # 5. SORTEIA O NÚMERO E FINALIZA O JOGO
            numero_sorteado = random.randint(0, 14)
            print(f"🔴 RESULTADO: O número sorteado foi {numero_sorteado}!")
            requests.post(f"{BASE_URL}/roulette/games/{game_id}/draw", json={"number_draw": numero_sorteado})

            # 6. PAUSA ANTES DO PRÓXIMO JOGO
            print("Pausa de 5 segundos para a galera ver o resultado...\n")
            time.sleep(5)

        except Exception as e:
            print(f"Erro de conexão com a API: {e}")
            time.sleep(5)

if __name__ == "__main__":
    rodar_cassino()