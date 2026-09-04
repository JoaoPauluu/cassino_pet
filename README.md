# Casino Project

A locally-run casino system for events/tablets: a FastAPI + SQLite backend that owns
all game state and the statistics ledger, and a Flask front-end that serves the TV
panel and the Double (roulette) game from Jinja templates.

```
.
├── backend/     # Statistics ledger + game-state API (FastAPI + SQLite)
└── frontend/    # Painel TV + jogo Double (Flask, Jinja templates)
```

The front-end is presentation only — all game logic (players, rounds, bets) lives in
the backend API. Run both; point the front-end at wherever the backend is listening.

---

## `backend/` — Casino Backend

Statistics ledger + game-state API for your locally-run casino games, built with FastAPI + SQLite (SQLAlchemy).

### Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The SQLite file `casino.db` is created automatically on first run, in the same folder.
Interactive docs (Swagger UI): `http://localhost:8000/docs`

### Project layout

| File | Purpose |
|---|---|
| `database.py` | Engine + session setup (SQLite, WAL mode enabled for better concurrent writes) |
| `models.py` | SQLAlchemy ORM models — all six tables |
| `schemas.py` | Pydantic request/response schemas |
| `crud.py` | DB query + game-settlement logic, kept separate from route handlers. Raises plain `NotFoundError` / `InvalidStateError` / `ConflictError` / `InsufficientFundsError`, which `main.py` maps to HTTP 404 / 409 / 409 / 402 |
| `main.py` | FastAPI app and all routes |

### Tables

#### `statistics`
The game-agnostic historical ledger — one row per resolved bet, across every game. `roulette.py`/`crash.py`
don't need to touch this directly: the `/draw`, `/crash`, and `/cashout` endpoints write to it
automatically whenever a bet is settled.

| column | type | notes |
|---|---|---|
| `id` | str (UUID) | primary key |
| `player_id` | str (UUID) | FK → `players.id` — replaces the old free-text `player`/`device` pair |
| `game` | str | indexed, e.g. `"roulette"`, `"crash"` |
| `bet` | float | amount wagered |
| `win` | float | amount returned to the player (`0` on a loss) |
| `created_at` | datetime | |

API responses (`StatisticOut`) still expose `player_name` and `device` as read-only convenience fields —
they're just resolved from the `players` join now instead of being stored redundantly, so they can never
drift out of sync with the player record. This also fully resolves the earlier `int`/`str` device type
mismatch, since `statistics` no longer stores its own copy of `device` at all.

#### `players`
| column | type | notes |
|---|---|---|
| `id` | str (UUID) | primary key |
| `name` | str | indexed |
| `device` | str | indexed — the tablet/terminal identifier |
| `starting_currency` | float | |
| `current_currency` | float | live wallet balance, updated automatically as bets are placed/settled |
| `created_at` | datetime | added for audit purposes |

#### `roulette_games`
| column | type | notes |
|---|---|---|
| `id` | str (UUID) | unique_identifier |
| `number_draw` | int, nullable | set once `roulette.py` posts the drawn number |
| `game_start_time` | datetime | indexed, used to find the current game |
| `status` | str | `"waiting_for_bets"` \| `"running"` \| `"ended"` |

#### `roulette_players`
One row per bet, scoped to a specific round via `roulette_game_id` — **not reset** when a new game starts.
Bets from every past round stay in this table; "this round's bets" just means filtering by the current
`roulette_game_id` (which `GET /roulette/games/{id}/players` does for you). So this table doubles as a
full roulette history, not just current-round state.
| column | type |
|---|---|
| `id` | str (UUID), row id |
| `roulette_game` (`roulette_game_id`) | FK → `roulette_games.id` |
| `player` (`player_id`) | FK → `players.id` |
| `number_bet` | int |
| `money_bet` | float |

#### `crash_games`
Same shape as `roulette_games`, with `crash_multiplier` (float, nullable) instead of `number_draw`.

#### `crash_players`
Same reasoning as `roulette_players` — persists across rounds, scoped by `crash_game_id`.
| column | type |
|---|---|
| `id` | str (UUID), row id |
| `crash_game` (`crash_game_id`) | FK → `crash_games.id` |
| `player` (`player_id`) | FK → `players.id` |
| `money_bet` | float |
| `left` | bool — has this player cashed out? |
| `multiplier` | float, nullable — multiplier at cashout |

### Typical flow

#### Setup (once per player)
```bash
POST /players   {"name": "joao", "device": "tablet-1", "starting_currency": 100}
# -> returns {"id": "<player_id>", ...}; use that id everywhere below
```

#### Roulette (driven by roulette.py)
1. `POST /roulette/games` — starts a round, status `waiting_for_bets`. Bets from previous rounds are untouched; each round's bets live under their own `roulette_game_id`.
2. Frontend calls `POST /roulette/games/{id}/join` per player — `{"player": "<player_id>", "number_bet": 7, "money_bet": 10}`. Validates the game is still accepting bets, the player has funds, and they haven't already bet this round; deducts the stake immediately.
3. `roulette.py` calls `PATCH /roulette/games/{id}/status` `{"status": "running"}` to close betting.
4. `roulette.py` draws the number itself, then calls `POST /roulette/games/{id}/draw` `{"number_draw": 7}`. This settles every bet in one transaction: straight-up hits pay 36x (35:1 + stake back — tweak `ROULETTE_STRAIGHT_PAYOUT_MULTIPLIER` in `models.py` if you want a different payout table later, e.g. red/black or dozens), credits winners' `current_currency`, logs a `statistics` row per player, and sets `status="ended"`.

#### Crash (driven by crash.py + frontend)
1. `POST /crash/games` — starts a round. Same "old bets stay, new round gets a fresh id" behavior as roulette.
2. Frontend calls `POST /crash/games/{id}/join` per player — `{"player": "<player_id>", "money_bet": 20}`. Same validation/deduction as roulette.
3. `crash.py` calls `PATCH /crash/games/{id}/status` `{"status": "running"}` and starts climbing the multiplier.
4. Whenever a player hits "cash out", frontend calls `POST /crash/games/{id}/cashout` `{"player": "<player_id>", "multiplier": 2.5}`. Credits `money_bet * multiplier` immediately and logs the win to `statistics`.
5. When `crash.py` determines the round has crashed, it calls `POST /crash/games/{id}/crash` `{"crash_multiplier": 3.1}`. Anyone who hadn't cashed out yet loses their stake (already deducted at bet time, so this just logs a `statistics` row with `win=0`), and the game is marked `ended`.

### Full endpoint list

**Players**
- `POST /players` — register a player/wallet
- `GET /players?device=&name=` — list
- `GET /players/{id}` — fetch one
- `PATCH /players/{id}` — update `device` and/or `current_currency`
- `GET /players/{id}/summary?game=` — aggregate stats totals for that player

**Roulette**
- `POST /roulette/games` — start a round (old rounds' bets are untouched, just scoped to their own game id)
- `GET /roulette/games?status=` — list
- `GET /roulette/games/current?status=` — most recent by `game_start_time`
- `GET /roulette/games/{id}` — fetch one
- `PATCH /roulette/games/{id}/status` — `{"status": "running"}` etc.
- `POST /roulette/games/{id}/join` — a player bets
- `GET /roulette/games/{id}/players` — list bets in that round
- `POST /roulette/games/{id}/draw` — report the drawn number, settle all bets, end the game

**Crash**
- `POST /crash/games` — start a round (same "old rounds untouched" behavior as roulette)
- `GET /crash/games?status=` — list
- `GET /crash/games/current?status=` — most recent by `game_start_time`
- `GET /crash/games/{id}` — fetch one
- `PATCH /crash/games/{id}/status` — `{"status": "running"}` etc.
- `POST /crash/games/{id}/join` — a player bets
- `GET /crash/games/{id}/players` — list bets in that round
- `POST /crash/games/{id}/cashout` — a player leaves at the current multiplier
- `POST /crash/games/{id}/crash` — report the crash point, settle remaining bets, end the game

**Statistics**
- `POST /statistics` `{"player": "<player_id>", "game": "...", "bet": ..., "win": ...}`
- `GET /statistics?player_id=&device=&game=&start=&end=` — `device` filters via a join to `players`
- `GET /statistics/{id}`
- `GET /statistics/summary?player_id=&device=&game=&start=&end=`
- `GET /statistics/player-names` — distinct player names with at least one statistics row (via the `players` join)
- `GET /games`

### Error handling

Game-logic problems come back as clean HTTP errors instead of 500s:
| Situation | Status |
|---|---|
| Game/player/bet id doesn't exist | `404` |
| Betting on a game that isn't `waiting_for_bets`, cashing out of a game that isn't `running`, drawing/crashing an already-`ended` game, double cashout | `409` |
| Player already has a bet in this round | `409` |
| Player's `current_currency` is less than `money_bet` | `402` |

### Notes on the "trusted devices" setup

Still no auth on any endpoint, per your earlier note that devices are controlled by you. If that changes,
the easiest options are an API key header via a FastAPI dependency, or binding `uvicorn` to your LAN/VPN
interface only rather than `0.0.0.0`. Happy to add either.

---

## `frontend/` — PET Cassino, App Flask

Serve o Painel TV e o jogo Double a partir de templates Jinja, com nome de
jogador por sessao e nome do tablet salvo no navegador.

### Estrutura

```
frontend/
├── app.py
├── requirements.txt
├── static/
│   ├── css/
│   │   ├── index.css     # Painel TV
│   │   ├── roleta.css    # Jogo Double
│   │   └── auth.css      # Tela "Entrar"
│   ├── js/
│   │   ├── index.js      # Polling das estatisticas do Painel TV
│   │   └── roleta.js     # Logica do jogo (roleta, apostas, historico)
│   └── img/
│       └── logo-pet.jpg
└── templates/
    ├── base.html          # Layout compartilhado (header/menu) - herdado por todos
    ├── painel.html
    ├── roleta.html
    └── entrar.html
```

### Como rodar

```bash
cd frontend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Depois acesse `http://localhost:5000` na propria maquina, ou
`http://<ip-desta-maquina>:5000` nos outros tablets da rede.

Isso continua sendo so' o front-end: o jogo em si (jogadores, rodadas,
apostas) depende da API separada (backend/) rodando em `http://<ip>:8000`,
igual antes.

### O que mudou em relacao aos arquivos originais

- **Nome do tablet ("dispositivo")**: continua exatamente como antes -
  guardado no `localStorage` do navegador (`static/js/roleta.js`,
  funcao `configurarSistema()`). E' por isso que so' pede uma vez por
  aparelho: uma vez salvo naquele navegador, fica salvo ate' alguem trocar
  clicando no ⚙️.
- **Nome do jogador**: antes era um `prompt()` do navegador toda vez que a
  pagina carregava. Agora e' pedido pela rota `/entrar` do Flask e guardado
  em `session["username"]` - ou seja, dura so' enquanto a sessao do
  navegador estiver aberta (fecha o navegador ou clica em "Sair" -> esquece).
  Isso nao fica salvo em disco nem em banco de dados.
- **Botao "Sair"**: no canto do jogo, ao lado do saldo. Chama `/sair`, que
  limpa `session["username"]` e manda de volta pra tela de nome.
- **Templates Jinja**: `base.html` tem o `<header>` (logo, menu, `Sistema
  Online` / area do usuario) que `painel.html`, `roleta.html` e
  `entrar.html` reaproveitam via `{% extends %}`, entao o cabecalho so'
  existe escrito em um lugar.

### Sobre a SECRET_KEY

Por padrao a chave de assinatura da sessao e' gerada aleatoriamente toda vez
que a aplicacao inicia - funciona bem para uso local/evento, mas significa
que reiniciar o servidor derruba todo mundo da sessao (precisam digitar o
nome de novo). Se isso incomodar, defina uma fixa antes de rodar:

```bash
export SECRET_KEY="cole-aqui-uma-string-aleatoria-longa"
python app.py
```
