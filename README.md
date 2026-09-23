# 🎰 PET Cassino — Como o projeto funciona

> Simulação de cassino para eventos presenciais: vários tablets na mesma rede local, cada pessoa joga com uma carteira virtual e a "casa" é comandada por um servidor central.
> Este documento foi escrito a partir da leitura do código do `cassino.zip` (pastas `backend/api`, `backend/games` e `frontend`).

**Como ler este documento**

| Se você quer… | Vá para |
|---|---|
| Entender a ideia geral e ver o mapa do projeto | [1. Visão geral](#1-visão-geral) |
| Uma explicação simples, sem jargão | [2. Bloco didático](#2-bloco-1--explicação-didática-para-quem-é-leigo) |
| Detalhes de código, banco, tempos e integração | [3. Bloco técnico](#3-bloco-2--explicação-técnica) |
| A lista de rotas da API, com entradas e saídas | [4. Referência dos endpoints](#4-referência-dos-endpoints-da-api) |
| Riscos e inconsistências encontrados na leitura | [5. Pontos de atenção](#5-pontos-de-atenção) |

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Bloco 1 — Explicação didática](#2-bloco-1--explicação-didática-para-quem-é-leigo)
3. [Bloco 2 — Explicação técnica](#3-bloco-2--explicação-técnica)
   - [3.1 Stack e como executar](#31-stack-e-como-executar)
   - [3.2 API (FastAPI)](#32-api-fastapi)
   - [3.3 Games Backend](#33-games-backend)
   - [3.4 Frontend (Flask)](#34-frontend-flask)
   - [3.5 Como as três partes se conectam](#35-como-as-três-partes-se-conectam)
4. [Referência dos endpoints da API](#4-referência-dos-endpoints-da-api)
5. [Pontos de atenção](#5-pontos-de-atenção)

---

## 1. Visão geral

O projeto é formado por **três programas independentes**, que rodam ao mesmo tempo e se comunicam por HTTP:

| # | Parte | Pasta | Tecnologia | Papel | Porta |
|---|---|---|---|---|---|
| 1 | **API** | `backend/api` | Python · FastAPI · SQLAlchemy · SQLite | Guarda todos os dados (jogadores, saldos, rodadas, apostas, estatísticas) e aplica as regras do dinheiro | 8000 |
| 2 | **Games Backend** | `backend/games` | Python · asyncio · httpx | "Crupiê" automático: abre, roda e encerra as rodadas de **Roleta** e **Crash** num ciclo infinito | — (não recebe conexões, só faz chamadas) |
| 3 | **Frontend** | `frontend` | Python · Flask · Jinja2 · HTML/CSS/JavaScript | Entrega as telas dos jogos e o painel de estatísticas; o JavaScript da tela conversa com a API | 5000 |

```
 ┌──────────────────┐  páginas HTML/CSS/JS   ┌─────────────────────────┐
 │ FRONTEND (Flask) │ ─────────────────────► │ NAVEGADOR DO TABLET     │
 │ porta 5000       │                        │ (JavaScript dos jogos)  │
 └──────────────────┘                        └───────────┬─────────────┘
                                                         │ fetch() HTTP+JSON
                                                         ▼
 ┌──────────────────┐   HTTP + JSON          ┌─────────────────────────┐    ┌──────────┐
 │ GAMES BACKEND    │ ─────────────────────► │ API (FastAPI)           │◄──►│casino.db │
 │ script asyncio   │  abre / roda /         │ porta 8000              │SQL │ (SQLite) │
 │ roleta + crash   │  encerra rodadas       └─────────────────────────┘    └──────────┘
 └──────────────────┘
```

**Três regras que explicam quase tudo:**

1. **A API é o centro.** Só ela lê e escreve no banco de dados. Todo o resto pergunta ou avisa a ela.
2. **O Flask não chama a API.** Ele só entrega as páginas. Quem chama a API é o **JavaScript rodando dentro do navegador do tablet** — por isso a API libera CORS para qualquer origem e cada tablet precisa saber o IP dela.
3. **Games Backend e Frontend nunca se falam.** Eles se "encontram" na API: o Games Backend escreve o estado da rodada, os tablets leem.

### Estrutura de pastas

```
cassino/
├── backend/
│   ├── api/
│   │   ├── main.py            # rotas (endpoints) do FastAPI
│   │   ├── crud.py            # regras de negócio + acesso ao banco
│   │   ├── models.py          # tabelas (SQLAlchemy)
│   │   ├── schemas.py         # formato/validação de entrada e saída (Pydantic)
│   │   ├── database.py        # conexão com o SQLite (casino.db) e sessões
│   │   ├── casino.db          # banco de dados (+ casino.db-wal / -shm do modo WAL)
│   │   └── .old/              # versões antigas dos arquivos (inclui o croupier.py antigo)
│   └── games/
│       ├── main.py            # rotinas de Roleta e Crash (loop infinito)
│       ├── random_drawer.py   # sorteios: número da roleta, ponto do crash, tempo do crash
│       └── logger.py          # logs no console
├── frontend/
│   ├── app.py                 # aplicação Flask (rotas das páginas + sessão)
│   ├── templates/             # HTML (Jinja2): base, index, entrar, roleta, crash, coinflip, caca_niquel, stats
│   └── static/
│       ├── js/                # base.js + um JS por jogo + stats.js
│       ├── css/               # base.css + um CSS por página
│       ├── img/               # logo e imagem do alerta de saldo baixo
│       └── manifest.json      # permite abrir em tela cheia no Android
└── venv/                      # ambiente virtual Python 3.12 (só dependências)
```

> A pasta `backend/api/.old/` guarda versões anteriores dos arquivos. O `croupier.py.old` fazia um papel parecido com o do atual Games Backend, mas como um script separado que usava `requests`.

---

## 2. Bloco 1 — Explicação didática (para quem é leigo)

### 2.1 Pense num cassino de verdade

| No cassino de verdade | No projeto | Nome técnico |
|---|---|---|
| As **mesas** onde as pessoas sentam, veem o jogo e apostam | As telas dos tablets | **Frontend** |
| O **caixa e o livro de registros**: quanto cada pessoa tem, quem apostou o quê, quem ganhou | Um programa que guarda tudo e confere as regras | **API** |
| O **crupiê**, que diz "façam suas apostas", gira a roleta e anuncia o número | Um programa que abre e fecha as rodadas sozinho, no tempo certo | **Games Backend** |

### 2.2 As três partes, em palavras simples

**Frontend — as mesas.**
É tudo o que a pessoa vê e toca: a tela de entrar com o nome, o menu de jogos, a roleta girando, o foguete subindo, a moeda, o caça-níquel e o painel com as estatísticas da casa. Ele **não guarda nada importante por conta própria**: sempre que precisa saber o saldo ou registrar uma aposta, "pergunta ao caixa".

**API — o caixa e o livro de registros.**
Não tem tela. Fica esperando pedidos e respondendo: "quanto a Maria tem?", "registre esta aposta de R$ 50", "a rodada acabou, pague quem ganhou". Tudo fica anotado num **banco de dados** (pense num caderno digital muito organizado). Além de anotar, ela **confere as regras**: você só aposta se tiver saldo, só enquanto as apostas estão abertas, e o prêmio é calculado por ela.

**Games Backend — o crupiê.**
Também não tem tela. Ele segue um relógio: abre a rodada, espera as apostas, gira, sorteia, manda pagar quem ganhou, descansa alguns segundos e recomeça. Faz isso sozinho, sem parar, para a **Roleta** e o **Crash** ao mesmo tempo.

### 2.3 Como elas conversam entre si

Imagine um **quadro de avisos no meio do salão** — esse quadro é a API.

- O **crupiê** escreve nele: *"rodada aberta"*, *"girando"*, *"deu 17"*.
- Os **tablets** ficam olhando o quadro várias vezes por segundo e atualizam a tela conforme o que está escrito.
- Quando uma pessoa aposta, o tablet entrega o pedido ao **caixa** (a API), que confere, desconta o saldo e anota.

O crupiê e os tablets **nunca conversam diretamente**; é sempre pelo quadro. Por isso todos os tablets veem a mesma rodada, ao mesmo tempo.

E o Flask? Ele é o **porteiro**: recebe a pessoa, pergunta o nome e entrega a tela. Depois que a tela está no tablet, quem conversa com o caixa é a própria tela.

### 2.4 Uma rodada de roleta, do começo ao fim

1. O **crupiê** pede ao caixa: *"abra uma nova rodada"*. As apostas ficam abertas por **30 segundos**.
2. Os **tablets**, olhando o quadro, percebem a rodada nova e liberam o tabuleiro.
3. **Maria** escolhe o número 17, define R$ 20 e toca em *Apostar*. O tablet pede ao caixa, que confere (a rodada está aberta? ela tem saldo?), tira os R$ 20 do saldo dela e anota. **Pedro** aposta no vermelho, e assim por diante. Cada pessoa pode fazer várias apostas.
4. Passados os 30 segundos, o crupiê avisa *"girando"*. As apostas fecham e os tablets animam a bola.
5. **10 segundos depois**, o crupiê sorteia o número (por exemplo, 17 preto) e entrega o resultado ao caixa.
6. O caixa faz as contas: acertou o número exato, recebe **36 vezes** o valor apostado; acertou só a cor, recebe **2 vezes**; senão, perde. Ele paga os vencedores, anota tudo nas estatísticas e encerra a rodada.
7. Os tablets veem *"encerrada"*, a bola pousa no 17, aparece a mensagem de vitória ou derrota e o saldo é atualizado.
8. Após **10 segundos** de pausa, o ciclo recomeça.

O **Crash** é parecido, mas com uma diferença: durante a rodada um foguete vai subindo e multiplicando o valor apostado, e **cada pessoa decide quando "sacar"**. Quem sacou a tempo leva o valor multiplicado; quem não sacou antes de o foguete explodir perde a aposta.

### 2.5 E o Coin Flip e o Caça-Níquel?

Esses dois **não têm crupiê**: cada pessoa joga sozinha, quando quiser. Aqui o **tablet faz tudo**: sorteia o resultado, calcula o prêmio e atualiza o saldo na tela. Só **depois** ele avisa o caixa: *"Maria apostou 50, ganhou 99 e agora tem tanto"*. É mais simples, mas o caixa apenas anota o que o tablet contou, sem conferir.

### 2.6 O que a pessoa vê

- **Entrar:** pede o nome (vale só enquanto o navegador estiver aberto ou até clicar em *Sair*).
- **Menu de jogos:** Slots, Coin Flip, Roleta e Crash, com o saldo no topo de todas as telas.
- **Carteira:** quem entra pela primeira vez ganha um saldo inicial aleatório, perto de R$ 1.000.
- **Aviso de saldo baixo:** se o saldo cair abaixo de R$ 10, aparece um alerta lembrando que o cassino é uma simulação e que apostar de verdade pode causar prejuízo e dependência.
- **Painel da TV (`/stats`):** tela pública com as estatísticas da casa (resultado da casa, últimas rodadas, desempenho dos jogadores), pensada para ficar numa televisão.

### 2.7 Mini-glossário

| Termo | Significa, em português claro |
|---|---|
| **API** | Um "balcão de atendimento" para programas: um programa faz um pedido e recebe uma resposta |
| **Endpoint** | Cada "guichê" desse balcão; um endereço para um tipo de pedido (ex.: *ver saldo*, *fazer aposta*) |
| **Backend** | A parte que fica "por trás das cortinas": guarda dados e aplica regras |
| **Frontend** | A parte que aparece na tela e com a qual a pessoa interage |
| **Banco de dados** | O caderno digital onde tudo fica anotado, mesmo se o programa for desligado |
| **Requisição** | Um pedido feito a um endpoint |
| **JSON** | O formato de "mensagem" usado nos pedidos e respostas, fácil de ler por programas |
| **Polling** | Perguntar de novo, de tempos em tempos ("já mudou?"), como olhar o quadro de avisos a cada instante |
| **Sessão** | A "memória curta" do navegador: lembra seu nome enquanto você não sai |
| **Rodada** | Uma partida de Roleta ou Crash, com começo, meio e fim |
| **Saldo / carteira** | O dinheiro de mentira de cada jogador |

---

## 3. Bloco 2 — Explicação técnica

### 3.1 Stack e como executar

| Componente | Bibliotecas (versões vistas no `venv`) |
|---|---|
| API | FastAPI 0.115.0 (Starlette 0.38.6), SQLAlchemy 2.0.35, Pydantic v2, Uvicorn, SQLite |
| Games Backend | httpx, `asyncio` (`TaskGroup` exige Python ≥ 3.11) |
| Frontend | Flask 3.1.3 (Werkzeug 3.1.8), Jinja2; JavaScript puro no navegador (sem framework) |
| Python | 3.12 (ambiente virtual incluído no zip) |

Comandos (extraídos das docstrings e do código; **não há `requirements.txt`** no projeto):

```bash
# 1) API — documentação automática em http://localhost:8000/docs
cd backend/api
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 2) Games Backend — pergunta a URL da API (vazio = http://localhost:8000)
cd backend/games
python main.py

# 3) Frontend — sobe em 0.0.0.0:5000
cd frontend
python app.py        # defina SECRET_KEY para não perder as sessões a cada reinício
```

**Ordem de subida:** API → Games Backend (ele testa `GET /` e aborta se a API não responder) → Frontend.

**Configuração de cada tablet:** abrir `http://<IP-do-Flask>:5000`, tocar em ⚙️, informar o **IP:porta da API** (ex.: `192.168.0.15:8000`) e o **nome do tablet**; depois digitar o nome do jogador em `/entrar`.

---

### 3.2 API (FastAPI)

#### 3.2.1 Organização em camadas

| Arquivo | Responsabilidade |
|---|---|
| `database.py` | Cria o *engine* SQLite (`casino.db` ao lado do módulo) e a `SessionLocal`. A dependência `get_db()` faz `commit` ao fim da requisição e `rollback` se houver exceção |
| `models.py` | Tabelas (SQLAlchemy ORM) e constantes de pagamento |
| `schemas.py` | Validação e formato de entrada/saída (Pydantic v2), com limites (`ge`, `gt`, `le`) |
| `crud.py` | **Toda a lógica de negócio.** Não importa FastAPI: levanta exceções de domínio próprias |
| `main.py` | Cria o app, liga o CORS, traduz as exceções de domínio em códigos HTTP e declara as rotas (finas: validam, chamam o `crud` e formatam a resposta) |

Caminho de uma requisição: **rota (`main.py`) → validação (`schemas.py`) → regra (`crud.py`) → tabelas (`models.py`) → SQLite**.

Tradução de erros de domínio em HTTP (`@app.exception_handler` em `main.py`):

| Exceção (`crud.py`) | HTTP | Quando acontece |
|---|---|---|
| `NotFoundError` | 404 | Jogador, rodada ou aposta inexistente; nenhuma rodada existente em `/…/games/current` |
| `InvalidStateError` | 409 | Apostar fora de `waiting_for_bets`; sacar fora de `running`; sacar duas vezes; encerrar rodada já encerrada |
| `ConflictError` | 409 | Segunda aposta do mesmo jogador na mesma rodada de Crash |
| `InsufficientFundsError` | 402 | Saldo menor que a aposta |
| Validação do Pydantic | 422 | Corpo ou parâmetro fora do formato (ex.: `money_bet` ≤ 0) |

#### 3.2.2 Banco de dados (SQLite)

| Tabela | Colunas principais | Observações |
|---|---|---|
| `players` | `id` (UUID), `name`, `device`, `starting_currency`, `current_currency`, `created_at` | A carteira. Índice em (`name`, `device`) |
| `statistics` | `id`, `player_id` → `players.id`, `game`, `bet`, `win`, `created_at` | **Livro-razão genérico**: uma linha por aposta resolvida, de qualquer jogo. `net = win − bet` é propriedade calculada, não coluna |
| `roulette_games` | `id`, `number_draw` (nulo até sortear), `game_start_time`, `status` | Uma linha por rodada |
| `roulette_players` | `id`, `roulette_game_id` → `roulette_games.id`, `player_id` → `players.id`, `number_bet` (−1 = sem número), `color_bet` (`red`/`black`/`none`), `money_bet` | Uma linha por **aposta** (um jogador pode ter várias na rodada) |
| `crash_games` | `id`, `crash_multiplier` (nulo até explodir), `game_start_time`, `status` | Uma linha por rodada |
| `crash_players` | `id`, `crash_game_id`, `player_id`, `money_bet`, `left` (já sacou?), `multiplier` (no saque) | Uma aposta por jogador por rodada |

Detalhes de implementação:

- **IDs** são UUIDs em texto (36 caracteres). **Dinheiro** é `Float`.
- Na conexão o SQLite recebe `PRAGMA journal_mode=WAL` (leituras e escritas convivem melhor — várias telas consultando enquanto o crupiê escreve) e `PRAGMA foreign_keys=ON`. Por isso existem os arquivos `casino.db-wal` e `casino.db-shm`.
- `check_same_thread=False` é necessário porque o FastAPI pode atender a mesma requisição em threads diferentes.
- `models.Base.metadata.create_all()` roda a cada inicialização: cria as tabelas que faltam, mas **não há migrações**.
- As apostas de rodadas antigas **não são apagadas**: "as apostas da rodada atual" significa filtrar por `roulette_game_id` / `crash_game_id`.
- Datas são gravadas por `_brasil_now()` (UTC−3). Veja [3.5.4](#354-fuso-horário-e-relógio).

#### 3.2.3 Regras do dinheiro

- **Criar jogador:** se `starting_currency` não vier, é sorteado por uma gaussiana (média 1000, desvio 250) arredondada à centena. `current_currency` começa igual ao inicial.
- **Apostar** (`place_roulette_bet` / `place_crash_bet`): valida o estado da rodada → busca o jogador → (Crash) verifica aposta duplicada → confere o saldo. Em seguida **debita `money_bet` na hora** e grava a aposta. O valor já sai do saldo antes do resultado.
- **Liquidação da Roleta** (`resolve_roulette_game`): para cada aposta, `número acertado → win = aposta × 36`; senão `cor acertada → win = aposta × 2`; senão `0`. O `win` já inclui o valor apostado (que tinha sido debitado), então é somado inteiro ao saldo. Só um prêmio por aposta: o número tem prioridade sobre a cor. Grava uma linha em `statistics` (`game="roulette"`) por aposta, salva `number_draw` e marca `ended`.
- **Saque no Crash** (`cashout_crash_bet`): exige rodada `running`, aposta existente e ainda não sacada. `win = aposta × multiplier`, sendo `multiplier` o **valor enviado pelo cliente**. Credita, marca `left=true`, guarda o multiplicador e grava em `statistics` (`game="crash"`).
- **Explosão do Crash** (`resolve_crash_game`): quem não sacou ganha uma linha em `statistics` com `win=0` (o valor já tinha sido debitado, então não há mudança de saldo). Salva `crash_multiplier` e marca `ended`.
- **Coin Flip e Caça-Níquel** não têm lógica na API: só usam `POST /statistics` e `PATCH /players/{id}`.

| Jogo | Quem decide o resultado | Pagamento (total devolvido, aposta incluída) | `statistics.game` |
|---|---|---|---|
| Roleta | Games Backend (`roletaeuropeia()`) | Número: 36× · Cor: 2× | `roulette` |
| Crash | Games Backend (`crashout()`) | Aposta × multiplicador do saque | `crash` |
| Coin Flip | Navegador (`Math.random()`) | 1,98× | `coinflip` |
| Caça-Níquel | Navegador (sorteio ponderado) | Ver [3.4.3](#343-os-jogos-no-navegador) | `caca-niquel` |

#### 3.2.4 Ciclo de estados de uma rodada

```
waiting_for_bets  ──►  running  ──►  ended
   (apostas abertas)    (girando /     (resultado definido,
                         foguete no ar)  apostas pagas)
```

O estado muda por `PATCH …/status` e também pelos endpoints `/draw` e `/crash`, que já encerram a rodada. **A API não valida transições nem tempo**: quem dá o "relógio" da rodada é o Games Backend. "Rodada atual" significa a de `game_start_time` mais recente.

#### 3.2.5 Outros detalhes

- **CORS aberto** (`allow_origins=["*"]`, todos os métodos e cabeçalhos): necessário porque a página vem do Flask (porta 5000) e o JavaScript chama a API em outra porta/IP.
- **Documentação automática** em `/docs` (Swagger) e `/redoc`.
- `GET /statistics` é paginado (`limit` até 1000, `offset`) e devolve também o `total` já considerando os filtros.
- As listas de apostas usam `joinedload(player)` para trazer o jogador junto, evitando uma consulta por aposta.
- Em `main.py`, a rota `/statistics/{stat_id}` é declarada **depois** das rotas literais (`/summary`, `/player-names`); a ordem importa, senão `player-names` seria interpretado como um id.

---

### 3.3 Games Backend

Um script assíncrono (`backend/games/main.py`) que funciona como **cliente da API**. Não expõe porta nenhuma.

- **Inicialização:** pergunta a URL da API (vazio = `http://localhost:8000`), faz `GET /` para confirmar a conexão e, se falhar, encerra.
- **Execução:** dentro de `asyncio.TaskGroup`, roda **duas corrotinas ao mesmo tempo** — `roulette_routine` e `crash_routine` — compartilhando um único `httpx.AsyncClient`. Ambas são loops infinitos (`while True`).
- **Logs:** `logger.py` cria um logger por jogo (`[Roulette] - [INFO] - …`) e evita duplicar *handlers*.

**Ciclo da Roleta (≈ 50 s por rodada)**

| Tempo | Ação do Games Backend | Chamada à API |
|---|---|---|
| 0 s | Abre a rodada | `POST /roulette/games` (guarda o `id`) |
| 0–30 s | Espera as apostas dos tablets | — |
| 30 s | Fecha as apostas | `PATCH /roulette/games/{id}/status` `{"status":"running"}` |
| 30–40 s | Deixa a bola "rodar" | — |
| 40 s | Sorteia com `roletaeuropeia()` e liquida | `POST /roulette/games/{id}/draw` `{"number_draw":…, "color_draw":…}` |
| 40 s | Confirma o encerramento (redundante, o `/draw` já encerra) | `PATCH …/status` `{"status":"ended"}` |
| 40–50 s | Pausa para os jogadores verem o resultado | — |

**Ciclo do Crash (tempo variável)**

| Tempo | Ação do Games Backend | Chamada à API |
|---|---|---|
| 0 s | Abre a rodada | `POST /crash/games` |
| 0–15 s | Espera as apostas | — |
| 15 s | Sorteia o ponto de explosão com `crashout()` e coloca a rodada no ar | `PATCH /crash/games/{id}/status` `{"status":"running"}` |
| 15 s → 15 s + *t* | Dorme *t* segundos enquanto os tablets animam o foguete e os jogadores sacam | (tablets: `POST …/cashout`) |
| 15 s + *t* | Reporta a explosão e encerra | `POST /crash/games/{id}/crash` `{"crash_multiplier":…}` e `PATCH …/status` `{"status":"ended"}` |
| + 10 s | Pausa e recomeça | — |

O tempo *t* vem de `crash_multiplier_to_time()`: `t = ln(m) / 0,06` segundos para `m ≥ 1` (ex.: 2× → 11,5 s; 10× → 38,4 s) e `t = m × 0,5` segundos para `m < 1`.

**Sorteios (`random_drawer.py`)**

- `roletaeuropeia()`: `randint(0, 36)`; devolve `(número, cor)`, com listas de vermelhos e pretos e o 0 como `green`.
- `crashout()`: com 20% de chance (`houseedge = 0.2`) explode antes de 1,00× (`uniform(0, 1)`). Nos outros casos usa `r = round(random(), 2)` e `m = 1 / (1 − r)`; acima de 10× o valor é comprimido (`10 + m × 0,2`). Na prática o máximo é ≈ 30×; o teto de 1000 nunca é atingido.
- `crash_multiplier_to_time()`: converte o multiplicador em duração, com `growth_rate = 0.06`.

**Tolerância a falhas:** cada etapa está num `try/except`. Ao falhar, registra o erro, espera 5 s e **reinicia o ciclo abrindo uma nova rodada**; a rodada que ficou pela metade não é limpa nem estornada (ver [5](#5-pontos-de-atenção)).

---

### 3.4 Frontend (Flask)

#### 3.4.1 Lado servidor (`app.py`)

| Rota | Métodos | Exige nome na sessão? | Template | Função |
|---|---|---|---|---|
| `/` | GET | Sim | `index.html` | Boas-vindas com saldo e cartões dos 4 jogos |
| `/entrar` | GET, POST | Não | `entrar.html` | Pede o nome (até 40 caracteres), grava em `session["username"]` e redireciona para `next` |
| `/sair` | GET | Não | — | Remove o nome da sessão e volta para `/entrar` (o dispositivo continua salvo) |
| `/stats` | GET | **Não** (público) | `stats.html` | Painel da TV |
| `/roleta` | GET | Sim | `roleta.html` | Mesa da Roleta |
| `/crash` | GET | Sim | `crash.html` | Mesa do Crash |
| `/coinflip` | GET | Sim | `coinflip.html` | Mesa do Coin Flip |
| `/slots` | GET | Sim | `caca_niquel.html` | Mesa do Caça-Níquel |

Sem nome na sessão, as páginas protegidas redirecionam para `/entrar?next=<página>`.

- **Sessão:** cookie assinado com `SECRET_KEY` (variável de ambiente; se ausente, é gerada aleatoriamente a cada inicialização, o que derruba todas as sessões ao reiniciar). `SESSION_PERMANENT=False`: o cookie some ao fechar o navegador. A sessão guarda **apenas o nome**; a carteira fica na API.
- **`context_processor`:** injeta `username` em todos os templates.
- **Templates:** todos herdam de `base.html` (cabeçalho, menu, saldo, botão ⚙️, botão *Sair*, popup de alerta), que expõe blocos `title`, `stylesheet`, `header_right`, `content` e `scripts`. O `base.html` também repassa o nome da sessão ao JavaScript (`usuarioSessao`, via `tojson`) e carrega `base.js`. O item "Painel TV" está comentado no menu; a página continua acessível em `/stats`.
- **`manifest.json` e meta tags:** permitem abrir em tela cheia, orientação retrato (uso em tablets Android/iOS).
- O Flask **não conversa com a API** nem faz proxy dela.

#### 3.4.2 Lado cliente: `base.js`

Carregado em todas as páginas. Ao abrir, executa `iniciarSessao()` e guarda a promessa em `sessaoInciada`, que o JavaScript de cada jogo aguarda.

1. Lê do `localStorage` o IP da API (`pet_api_ip`, padrão `localhost:8000`) e o nome do tablet (`pet_dispositivo`, padrão `Tablet 01`). Se faltar algum, abre o ⚙️ (`configurarSistema()`, dois `prompt()`).
2. Define `baseUrl = http://<ip>` (sempre HTTP).
3. Busca a carteira com `GET /players?name=<jogador>&device=<tablet>`. Se existir, usa; senão, cria com `POST /players`. Guarda `jogadorID` e mostra o saldo.

Outras funções: `obterSaldo()` (`GET /players/{id}`), `modificarSaldoNaTela()`, `formataDinheiro()` (BRL, pt-BR), `mostrarErro()` e o **popup de saldo baixo** (< R$ 10, exibido uma vez a cada queda abaixo do limite).

**Identidade do jogador = par (nome, dispositivo).** Sair e voltar com o mesmo nome no mesmo tablet reencontra a mesma carteira; o mesmo nome em outro tablet cria uma carteira nova.

#### 3.4.3 Os jogos no navegador

| Jogo | Quem decide | Chamadas à API |
|---|---|---|
| **Roleta** | Games Backend | `GET /roulette/games/current` e `GET /roulette/games/{id}/players` a cada 300 ms; `POST …/join` ao apostar; `GET /players/{id}` para o saldo ao fim da rodada |
| **Crash** | Games Backend | `GET /crash/games/current` e `GET …/players` a cada 300 ms; `GET /crash/games?status=ended` (histórico inicial); `POST …/join`; `POST …/cashout` |
| **Coin Flip** | Navegador | `POST /statistics` e `PATCH /players/{id}` após cada jogada |
| **Caça-Níquel** | Navegador | `POST /statistics` e `PATCH /players/{id}` após cada giro |

**Roleta (`roleta.js`)**
- O navegador nunca abre rodada, fecha apostas nem sorteia: só entra na rodada e acompanha o estado por *polling*.
- Aposta mínima R$ 10, de 10 em 10, máximo R$ 500 (limitado pelo saldo).
- Cada aposta é **em número OU em cor**. O campo não escolhido vai como valor neutro (`number_bet = -1`, `color_bet = "none"`) para o corpo ter sempre o mesmo formato. Um jogador pode fazer várias apostas por rodada, cada uma em um `POST …/join`. O backend aceitaria número e cor na mesma aposta; o frontend não usa isso.
- Animação: uma "borda" salta de número em número enquanto está `running` e desacelera até pousar no número sorteado; sons sintetizados com Web Audio (sem arquivos). Na 1ª sincronização de uma página aberta no meio da rodada, o resultado aparece direto, sem animação nem som "atrasado".

**Crash (`crash.js`)**
- Um único botão muda de função: **Apostar** (em `waiting_for_bets`) → **Sacar** (em `running`).
- O multiplicador da tela **não vem do servidor a cada quadro**: é calculado localmente a partir de `game_start_time` com a mesma curva do backend, `m(t) = e^(0,06·t)`, com uma rampa linear nos primeiros 0,5 s para as explosões abaixo de 1×. O *polling* corrige desvios e traz o resultado oficial.
- A exibição anda **propositalmente ~0,5 s atrás** do servidor (intervalo do *polling* + 0,2 s) para o número nunca ultrapassar o ponto de explosão e "voltar" (*roll back*) quando o `ended` chega.
- O gráfico é um `<canvas>` com eixos que se expandem; o foguete chacoalha mais quanto maior o multiplicador.

**Coin Flip (`coinflip.js`)**
- Sorteio 50/50 com `Math.random()`, pagamento **1,98×** (2% de vantagem da casa), animação de 5 a 7 voltas, histórico das últimas 12 jogadas.
- Fluxo: sorteia → anima → atualiza o saldo local → `POST /statistics` → `PATCH /players/{id}` com o saldo **inteiro**.

**Caça-Níquel (`caca_niquel.js`)**
- 4 rolos, sorteio ponderado por peso. Vale a maior quantidade de símbolos iguais; se não houver 3 ou mais iguais, 2 ou mais cerejas devolvem a aposta (1×).

| Símbolo | Peso | 3 iguais | 4 iguais |
|---|---|---|---|
| 🍒 | 30 | 1,9× | 5× |
| 🍋 | 25 | 2,5× | 7,5× |
| 🔔 | 20 | 3,8× | 12,5× |
| 💎 | 15 | 6,3× | 19× |
| ⭐ | 7 | 10,1× | 31× |
| 🍀 | 3 | 18,9× | 63× |

- Mesmo fluxo de rede do Coin Flip. As imagens dos símbolos vêm de uma CDN (Twemoji), com emoji de texto como plano B.

#### 3.4.4 Painel da TV (`stats.html` + `stats.js`)

- A cada **15 s** (e ao voltar para a aba), busca em paralelo `GET /players`, `GET /statistics` (paginado de 1000 em 1000 até acabar), `GET /statistics/summary`, `GET /roulette/games`, `GET /crash/games` e `GET /games`.
- Filtros por **jogo**, **período** e **dispositivo** viram os parâmetros `game`, `start`/`end` e `device`.
- Exibe indicadores da casa, "Caixa da casa" (velas ou linha), últimas rodadas de Roleta e Crash, últimas apostas (até 40) e jogadores no período.
- Foi escrito de forma tolerante: se um endpoint falhar, a seção fica vazia sem derrubar a tela, e os campos das respostas são lidos por nomes alternativos.

---

### 3.5 Como as três partes se conectam

#### 3.5.1 Quem fala com quem

| Origem | Destino | Como | Para quê |
|---|---|---|---|
| Games Backend | API | HTTP + JSON (`httpx`) | Abrir, mudar o estado e liquidar rodadas |
| Navegador | Flask | HTTP (HTML, CSS, JS) | Carregar as páginas, arquivos estáticos e informar o nome |
| Navegador | API | HTTP + JSON (`fetch`) **direto**, no IP salvo no ⚙️ | Saldo, apostas, saques, *polling* de rodadas, estatísticas |
| API | SQLite | SQL (SQLAlchemy) | Persistência |
| Flask ↔ API · Games Backend ↔ Flask · Games Backend ↔ Navegador | — | **Sem comunicação direta** | — |

Consequência prática: o Flask pode rodar numa máquina e a API em outra, desde que o tablet alcance as duas.

#### 3.5.2 Sincronização entre tablets e crupiê

- **Polling de 300 ms** em Roleta e Crash: `tick()` chama `GET …/games/current` e depois `GET …/players`. Um flag (`pollEmAndamento`) impede *polls* sobrepostos.
- **Roleta:** o status (`waiting_for_bets` → `running` → `ended`) e o `number_draw` da API comandam a interface; a bola só pousa quando o resultado chega.
- **Crash:** o relógio é local e espelha o do backend. Existe um **acoplamento escondido**: o frontend soma **15 s fixos** (`inicioRodada + 15000` em `crash.js`) porque `game_start_time` marca a *abertura* da rodada, e o Games Backend espera 15 s (`asyncio.sleep(15)`) antes de colocá-la em `running`. **Se um desses valores mudar, o outro precisa mudar junto.**
- **Erros da API chegam à tela:** o `detail` do JSON de erro (ex.: "Player … has insufficient balance") é mostrado no campo de mensagens.

#### 3.5.3 Dois modelos de autoridade

| | Roleta e Crash | Coin Flip e Caça-Níquel |
|---|---|---|
| Quem sorteia | Games Backend (servidor) | Navegador |
| Quem calcula o prêmio | API (`resolve_*`) | Navegador |
| Como o saldo é atualizado | A API debita/credita | O navegador manda o saldo final por `PATCH /players/{id}` |
| Multijogador | Sim (todos veem a mesma rodada) | Não (cada um joga sozinho) |

#### 3.5.4 Fuso horário e relógio

`_brasil_now()` grava horários de Brasília (UTC−3), mas o SQLite **não guarda fuso**; no banco fica, por exemplo, `2026-09-21 18:17:20.260424`, e o JSON sai **sem deslocamento**. No navegador, `new Date("…")` interpreta esse texto no fuso do próprio aparelho. Como o `crash.js` calcula o multiplicador a partir de `game_start_time`, os tablets precisam estar **no fuso de Brasília e com o relógio correto**. O `crash.js` tem um gancho para `server_time` (correção de relógio), mas a API atual não envia esse campo.

---

## 4. Referência dos endpoints da API

**Convenções**

- URL base: `http://<IP-da-API>:8000` · corpo e respostas em **JSON** · documentação interativa em `/docs`.
- IDs são UUIDs em texto. Datas seguem ISO 8601, **sem fuso** (ver [3.5.4](#354-fuso-horário-e-relógio)).
- Códigos de erro: **402** saldo insuficiente · **404** não encontrado · **409** estado inválido ou conflito · **422** dados fora do formato.
- Total: **29 endpoints** (1 de saúde, 6 de estatísticas, 5 de jogadores, 17 de Roleta e Crash).
- Status possíveis de uma rodada: `waiting_for_bets`, `running`, `ended`.

### 4.1 Saúde

| Método | Rota | Recebe | O que faz e devolve |
|---|---|---|---|
| GET | `/` | — | Confirma que a API está no ar: `{"status":"ok","service":"casino-backend"}`. O Games Backend usa ao iniciar |

### 4.2 Estatísticas

| Método | Rota | Recebe | O que faz e devolve |
|---|---|---|---|
| POST | `/statistics` | **Corpo:** `player` (id do jogador), `game` (texto), `bet` (≥ 0), `win` (≥ 0) | Grava uma linha no livro de estatísticas (uma aposta resolvida). **Não altera o saldo.** Devolve `201` com a linha (`id`, `player`, `player_name`, `device`, `game`, `bet`, `win`, `net`, `created_at`). `404` se o jogador não existe. Usado por Coin Flip e Caça-Níquel |
| GET | `/statistics` | **Query (todas opcionais):** `player_id`, `device`, `game`, `start`, `end` (datas ISO), `limit` (1–1000, padrão 100), `offset` (≥ 0) | Lista as linhas, das mais recentes para as mais antigas. Devolve `{ "total": n, "results": [...] }`; `total` respeita os filtros e ignora a paginação |
| GET | `/statistics/summary` | **Query (opcionais):** `player_id`, `device`, `game`, `start`, `end` | Totais do filtro: `rounds_played`, `total_bet`, `total_win`, `net` (= `total_win − total_bet`), mais `player_name` quando há `player_id` |
| GET | `/statistics/player-names` | — | Lista ordenada dos nomes distintos de jogadores que têm ao menos uma linha de estatística |
| GET | `/statistics/{stat_id}` | **Caminho:** `stat_id` | Uma linha de estatística. `404` se não existir |
| GET | `/games` | — | Lista ordenada dos nomes de jogos que já têm estatística (ex.: `coinflip`, `crash`, `roulette`, `caca-niquel`) |

### 4.3 Jogadores (carteiras)

| Método | Rota | Recebe | O que faz e devolve |
|---|---|---|---|
| POST | `/players` | **Corpo:** `name`, `device` (obrigatórios); `starting_currency`, `current_currency` (opcionais, ≥ 0) | Cria a carteira. Sem `starting_currency`, sorteia um valor (média R$ 1.000, arredondado à centena); sem `current_currency`, usa o inicial. Devolve `201` com `id`, `name`, `device`, `starting_currency`, `current_currency`, `created_at` |
| GET | `/players` | **Query (opcionais):** `device`, `name` (igualdade exata) | Lista as carteiras, das mais novas para as mais antigas. É como o frontend descobre se o par (nome, tablet) já existe |
| GET | `/players/{player_id}` | **Caminho:** `player_id` | Devolve a carteira (inclui `current_currency`). `404` se não existir |
| PATCH | `/players/{player_id}` | **Corpo parcial:** `device` e/ou `current_currency` (≥ 0) | Atualiza só os campos enviados. Usado por Coin Flip e Caça-Níquel para gravar o saldo |
| GET | `/players/{player_id}/summary` | **Caminho:** `player_id` · **Query:** `game` (opcional) | Mesmo formato de `/statistics/summary`, restrito ao jogador (e ao jogo, se informado) |

### 4.4 Rodadas — endpoints comuns à Roleta e ao Crash

Cada rota existe duas vezes, com o prefixo `/roulette/games` e `/crash/games`. O objeto da rodada tem `id`, `game_start_time`, `status` e o resultado (`number_draw` na Roleta, `crash_multiplier` no Crash), nulo até a rodada terminar.

| Método | Rota (`roulette` ou `crash`) | Recebe | O que faz e devolve |
|---|---|---|---|
| POST | `/{jogo}/games` | Nada | Abre uma nova rodada com status `waiting_for_bets`. Rodadas e apostas anteriores permanecem. Devolve `201` com a rodada. **Chamado pelo Games Backend** |
| GET | `/{jogo}/games` | **Query (opcionais):** `status`, `limit` (1–500, padrão 50), `offset` | Lista as rodadas, mais recentes primeiro |
| GET | `/{jogo}/games/current` | **Query:** `status` (opcional) | Devolve a rodada mais recente por `game_start_time`. `404` se nunca houve rodada. **É o endpoint do *polling* dos tablets** |
| GET | `/{jogo}/games/{game_id}` | **Caminho:** `game_id` | Devolve uma rodada. `404` se não existir |
| PATCH | `/{jogo}/games/{game_id}/status` | **Corpo:** `status` (um dos três valores) | Define o status da rodada, **sem validar a transição**. O Games Backend usa para passar a `running` e `ended` |
| GET | `/{jogo}/games/{game_id}/players` | **Caminho:** `game_id` | Lista todas as apostas da rodada, cada uma com o jogador aninhado. Roleta: `number_bet`, `color_bet`, `money_bet`. Crash: `money_bet`, `left`, `multiplier`. `404` se a rodada não existir |

### 4.5 Roleta — endpoints específicos

| Método | Rota | Recebe | O que faz e devolve |
|---|---|---|---|
| POST | `/roulette/games/{game_id}/join` | **Corpo:** `player` (id), `number_bet` (−1 a 36; −1 = sem número), `color_bet` (`red`, `black` ou `none`), `money_bet` (> 0) | Registra a aposta e **debita o valor do saldo na hora**. Só vale com a rodada em `waiting_for_bets` (`409` caso contrário); `404` se jogador ou rodada não existem; `402` se o saldo não cobre. O mesmo jogador pode apostar várias vezes na rodada. Devolve `201` com a aposta |
| POST | `/roulette/games/{game_id}/draw` | **Corpo:** `number_draw` (0–36), `color_draw` (`red`, `black` ou `green`) | **Liquida a rodada.** Para cada aposta: número certo paga 36×; senão, cor certa paga 2×; senão, 0. Credita os prêmios, grava uma linha em `statistics` por aposta, salva `number_draw` e muda o status para `ended`. `409` se já estava encerrada. Devolve `{ "game": {...}, "results": [{player_id, player_name, money_bet, win, net}] }`. **Chamado pelo Games Backend** |

### 4.6 Crash — endpoints específicos

| Método | Rota | Recebe | O que faz e devolve |
|---|---|---|---|
| POST | `/crash/games/{game_id}/join` | **Corpo:** `player` (id), `money_bet` (> 0) | Registra a aposta e debita o valor na hora. Exige `waiting_for_bets` (`409`); **uma aposta por jogador por rodada** (`409` na segunda); `404` se jogador ou rodada não existem; `402` se o saldo não cobre. Devolve `201` com a aposta (`left=false`) |
| POST | `/crash/games/{game_id}/cashout` | **Corpo:** `player` (id), `multiplier` (> 0) | Saque do jogador. Exige a rodada em `running` (`409`), aposta existente (`404`) e ainda não sacada (`409`). Calcula `win = aposta × multiplier`, credita o saldo, marca `left=true`, guarda o multiplicador e grava em `statistics`. Devolve a aposta atualizada |
| POST | `/crash/games/{game_id}/crash` | **Corpo:** `crash_multiplier` (> 0) | **Liquida a rodada.** Quem não sacou recebe uma linha em `statistics` com `win=0` (o valor já havia sido debitado). Salva `crash_multiplier` e muda o status para `ended`. `409` se já estava encerrada. Devolve `{ "game": {...}, "results": [...] }`. **Chamado pelo Games Backend** |

### 4.7 Exemplos

**Apostar no 17 (R$ 20) na Roleta**

```http
POST /roulette/games/3f1c…/join
Content-Type: application/json

{ "player": "b6f3…", "number_bet": 17, "color_bet": "none", "money_bet": 20 }
```

```json
{
  "id": "9a7e…",
  "roulette_game": "3f1c…",
  "player": { "id": "b6f3…", "name": "Maria", "device": "Tablet 01",
              "starting_currency": 1000.0, "current_currency": 980.0,
              "created_at": "2026-09-21T18:17:20.260424" },
  "number_bet": 17,
  "color_bet": "none",
  "money_bet": 20.0
}
```

**Games Backend liquida a rodada**

```http
POST /roulette/games/3f1c…/draw
{ "number_draw": 17, "color_draw": "black" }
```

```json
{
  "game": { "id": "3f1c…", "number_draw": 17, "status": "ended", "game_start_time": "2026-09-21T18:17:20.260424" },
  "results": [ { "player_id": "b6f3…", "player_name": "Maria", "money_bet": 20.0, "win": 720.0, "net": 700.0 } ]
}
```

---

## 5. Pontos de atenção

Itens que apareceram durante a leitura do código (não é uma auditoria completa). Os números do item 3 vêm de uma simulação minha do `crashout()`.

1. **Sem autenticação, e regras que confiam no cliente.** Qualquer aparelho que alcance a API pode fazer `PATCH /players/{id}` com qualquer saldo ou mudar o status de uma rodada (inclusive reabrir uma encerrada). Coin Flip e Caça-Níquel dependem disso por desenho, pois sorteiam e calculam o saldo no navegador. Para uma simulação numa rede local de evento é aceitável, mas a API não deve ficar exposta à internet.
2. **O multiplicador do saque vem do cliente.** O comentário de `crash.js` diz que join e cashout são validados com o tempo do servidor, mas `cashout_crash_bet` usa `payload.multiplier` como chegou. A única barreira é a rodada estar `running`. Uma alternativa é calcular o multiplicador no servidor a partir de `game_start_time` + 15 s, ou recusar valores acima do teórico.
3. **`crashout()` pode dividir por zero (≈ 0,4% das rodadas).** `round(random.random(), 2)` chega a `1.0` quando o sorteio é ≥ 0,995, e `1 / (1 − 1.0)` levanta `ZeroDivisionError`. Em 400.000 sorteios simulados, ocorreu 1.623 vezes. Como o erro acontece antes do `PATCH … running`, a rodada fica parada em `waiting_for_bets`, e as apostas feitas nela **já foram debitadas e nunca são liquidadas nem estornadas**. Correção simples: limitar o valor (`min(r, 0.99)`) ou não arredondar.
4. **Acoplamento de 15 s duplicado.** `asyncio.sleep(15)` no Games Backend e `+ 15000` no `crash.js` precisam andar juntos (ver [3.5.2](#352-sincronização-entre-tablets-e-crupiê)). Uma forma de eliminar isso é a API informar o instante em que a rodada entrou em `running` (o `crash.js` já prevê o campo `server_time`).
5. **Fuso e relógio dos tablets.** O multiplicador do Crash depende de `game_start_time` sem fuso e do relógio do aparelho (ver [3.5.4](#354-fuso-horário-e-relógio)).
6. **`debug=True` com `host="0.0.0.0"` em `app.py`.** O comentário logo acima diz que `debug=False` foi escolhido de propósito para não expor o depurador do Flask à rede, mas o código faz o oposto.
7. **Pequenas inconsistências**
   - O Caça-Níquel grava `game="caca-niquel"`, mas `stats.js` só traduz `caca_niquel`; o painel mostra "Caca-niquel".
   - `index.html` termina com `sessaoInciada.then(async () => {...})();`: o `()` final tenta chamar uma Promise e gera erro no console (o saldo aparece mesmo assim, porque o callback já foi registrado).
   - No menu, o Caça-Níquel compara `active_page == 'caca_niquel'`, mas a rota envia `"slots"`; o item nunca fica destacado.
   - `logger.info(logger.info(...))` no Crash imprime `None`.
   - `ROULLETE_COLOR_PAYOUT_MULTIPLIER` (dois "L") em `models.py`.
   - Comentários citam `roulette.py`, `crash.py` e `time_to_crash_multiplier()`, que não existem mais (hoje: `backend/games/main.py` e `crash_multiplier_to_time`).
8. **Operação e empacotamento.** Não há `requirements.txt`; o zip leva `venv`, `__pycache__` e o banco (`casino.db`, `-wal`, `-shm`). Vale versionar só o código e um `requirements.txt`. O `base.html` usa Google Fonts e o Caça-Níquel busca imagens numa CDN (com emoji como plano B), então numa rede sem internet o visual degrada.
