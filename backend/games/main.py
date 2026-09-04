import asyncio
import httpx

from logger import get_logger
import random_drawer


async def roulette_routine(client: httpx.AsyncClient, URL: str):
    logger = get_logger("Roullete")

    logger.info("Iniciando rotina de roleta...")

    while True:
        current_game_id = None

        # Começa o Jogo
        try:
            request = await client.post(f"{URL}/roulette/games")
            current_game_id = request.json().get("id")
            logger.info(f"Jogo iniciado com ID: {current_game_id}")

        except Exception as e:
            logger.error(f"Erro ao iniciar o jogo: {e}")
            await asyncio.sleep(5)
            continue

        # Espera as apostas serem feitas
        await asyncio.sleep(30)

        # Sorteia o resultado do jogo
        try:
            draw = random_drawer.roletaeuropeia()
            request_body = {"number_draw": draw}
            request = await client.post(f"{URL}/roulette/games/{current_game_id}/draw", json=request_body)

            request_body = {"status": "running"}
            request = await client.post(f"{URL}/roulette/games/{current_game_id}/status", json=request_body)

            logger.info(f"Resultado do jogo {current_game_id}: {draw}")

        except Exception as e:
            logger.error(f"Erro ao sortear o jogo: {e}")
            await asyncio.sleep(5)
            continue

        # Espera os jogadores verem o resultado
        await asyncio.sleep(30)

        # Finaliza o jogo
        try:
            request_body = {"status": "finished"}
            request = await client.post(f"{URL}/roulette/games/{current_game_id}/status", json=request_body)

            logger.info(f"Jogo {current_game_id} finalizado.")

        except Exception as e:
            logger.error(f"Erro ao finalizar o jogo: {e}")
            await asyncio.sleep(5)
            continue

    return


async def crash_routine(client: httpx.AsyncClient, URL: str):
    logger = get_logger("Crash")

    logger.info("Iniciando rotina de crash...")

    while True:
        current_game_id = None

        # Começa o Jogo
        try:
            request = await client.post(f"{URL}/crash/games")
            current_game_id = request.json().get("id")
            logger.info(f"Jogo iniciado com ID: {current_game_id}")

        except Exception as e:
            logger.error(f"Erro ao iniciar o jogo: {e}")
            await asyncio.sleep(5)
            continue

        # Espera as apostas serem feitas
        await asyncio.sleep(30)

        # Sorteia o resultado do jogo
        try:
            draw = random_drawer.crashout()
            request_body = {"number_draw": draw}
            request = await client.post(f"{URL}/crash/games/{current_game_id}/crash", json=request_body)

            request_body = {"status": "running"}
            request = await client.post(f"{URL}/crash/games/{current_game_id}/status", json=request_body)

            logger.info(f"Resultado do jogo {current_game_id}: {draw}")

        except Exception as e:
            logger.error(f"Erro ao sortear o jogo: {e}")
            await asyncio.sleep(5)
            continue

        # Espera os jogadores verem o resultado
        await asyncio.sleep(30)

        # Finaliza o jogo
        try:
            request_body = {"status": "finished"}
            request = await client.post(f"{URL}/crash/games/{current_game_id}/status", json=request_body)

            logger.info(f"Jogo {current_game_id} finalizado.")

        except Exception as e:
            logger.error(f"Erro ao finalizar o jogo: {e}")
            await asyncio.sleep(5)
            continue

    return

async def main():
    URL = input("Digite a url da API (deixe vazio para localhost:8000)")
    if URL == "":
        URL = "http://localhost:8000"

    async with httpx.AsyncClient() as client:

        try:
            request = await client.get(f"{URL}/")
            if request.status_code == 200:
                print("Conexão com a API estabelecida com sucesso!")
            else:
                print("Falha ao conectar com a API. Verifique a URL e tente novamente.")
                return
        except Exception as e:
            print(f"Erro ao conectar com a API: {e}")
            return

        async with asyncio.TaskGroup() as tg:
            tg.create_task(roulette_routine(client, URL))
            tg.create_task(crash_routine(client, URL))



if __name__ == "__main__":
    asyncio.run(main())