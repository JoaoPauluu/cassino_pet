# Casino Backend

Central statistics ledger for your locally-run casino games, built with FastAPI + SQLite (SQLAlchemy).

## Setup

```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The SQLite file `casino.db` is created automatically on first run, in the same folder.
Interactive docs (Swagger UI): `http://localhost:8000/docs`

## Project layout

| File | Purpose |
|---|---|
| `database.py` | Engine + session setup (SQLite, WAL mode enabled for better concurrent writes) |
| `models.py` | SQLAlchemy ORM models — the `Statistics` table |
| `schemas.py` | Pydantic request/response schemas |
| `crud.py` | DB query functions, kept separate from route handlers |
| `main.py` | FastAPI app and all routes |

## `statistics` table

| column | type | notes |
|---|---|---|
| `id` | str (UUID) | primary key, auto-generated |
| `player` | str | indexed |
| `device` | int | indexed |
| `game` | str | indexed, e.g. `"roulette"`, `"crash"` |
| `bet` | float | amount wagered |
| `win` | float | amount returned to the player (`0` on a loss) |
| `created_at` | datetime (UTC) | not in your original spec, but added since you'll want it for any time-based query (sessions, daily totals, etc.); set automatically server-side |

`net` (`win - bet`) is exposed in API responses as a computed field, not stored, so it's never out of sync with `bet`/`win`.

## Endpoints

### `POST /statistics`
Game client reports a finished round.

```bash
curl -X POST http://localhost:8000/statistics \
  -H "Content-Type: application/json" \
  -d '{"player": "joao", "device": 1, "game": "roulette", "bet": 10, "win": 35}'
```

### `GET /statistics`
List statistics, with optional filters: `player`, `device`, `game`, `start`, `end` (ISO timestamps), plus `limit`/`offset` pagination.

```
GET /statistics?player=joao&game=roulette&limit=50
```

### `GET /statistics/{id}`
Fetch one row by its UUID.

### `GET /statistics/summary`
Aggregated totals (`rounds_played`, `total_bet`, `total_win`, `net`) for a filter set — same filters as the list endpoint (minus pagination).

```
GET /statistics/summary?game=crash
```

### `GET /players/{player}/summary`
Shortcut for a single player's totals, optionally scoped with `?game=`.

### `GET /players` / `GET /games`
Distinct player names / game names seen so far — handy for populating dashboards.

## Extending with per-game tables (roulette rooms, crash rounds, etc.)

Keep `statistics` as the single source of truth for "what a player bet/won", and give each new game
its own detail table with a foreign key back to it. In `models.py`:

```python
class RouletteRound(Base):
    __tablename__ = "roulette_rounds"

    id = Column(String(36), primary_key=True, default=_uuid_str)
    statistics_id = Column(String(36), ForeignKey("statistics.id"), nullable=False)
    room = Column(String, nullable=False)          # which table/room
    number_hit = Column(Integer, nullable=False)   # winning number
    bet_type = Column(String, nullable=False)       # "straight", "red", "dozen", etc.

    statistic = relationship("Statistics", back_populates="roulette_round")
```

and add the reverse `relationship(...)` on `Statistics`. This way:

- `POST /statistics` stays generic and unchanged for every game.
- Add a game-specific `POST /roulette/rounds` (or fold it into one call that writes both rows
  in the same DB transaction) once you're ready.
- All cross-game reporting (leaderboards, house edge, player totals) keeps working off `statistics`
  alone, no matter how many game tables you bolt on later.

## Notes on the "trusted devices" setup

Since you mentioned the games post results directly and devices are controlled by you: there's
currently no auth on the endpoints. If you want a minimal safety net without much overhead, the
easiest options are:
- an API key header checked via a FastAPI dependency, or
- binding `uvicorn` to your LAN/VPN interface only, not `0.0.0.0` on an open network.

Happy to add either if useful.
