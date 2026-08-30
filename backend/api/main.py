"""
Casino backend API.

Run with:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload

Docs (auto-generated) at:
    http://localhost:8000/docs
"""
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

import crud
import models
import schemas
from database import engine, get_db

# Creates casino.db and all tables on first run (statistics, players,
# roulette_games, roulette_players, crash_games, crash_players). Safe to
# call every startup: it only creates tables that don't exist yet.
models.Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Casino Backend API",
    description="Central statistics ledger + game-state API for locally-run casino games.",
    version="1.1.0",
)


# ---------------------------------------------------------------------------
# Domain error -> HTTP status mapping. Keeps crud.py free of FastAPI details
# while still giving roulette.py / crash.py / the frontend clear status codes.
# ---------------------------------------------------------------------------
@app.exception_handler(crud.NotFoundError)
async def _not_found_handler(request: Request, exc: crud.NotFoundError):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(crud.InvalidStateError)
async def _invalid_state_handler(request: Request, exc: crud.InvalidStateError):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(crud.ConflictError)
async def _conflict_handler(request: Request, exc: crud.ConflictError):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(crud.InsufficientFundsError)
async def _insufficient_funds_handler(request: Request, exc: crud.InsufficientFundsError):
    return JSONResponse(status_code=402, content={"detail": str(exc)})


@app.get("/", tags=["meta"])
def root():
    return {"status": "ok", "service": "casino-backend"}


# ---------------------------------------------------------------------------
# POST — game clients report a finished round here
# ---------------------------------------------------------------------------
@app.post(
    "/statistics",
    response_model=schemas.StatisticOut,
    status_code=status.HTTP_201_CREATED,
    tags=["statistics"],
    summary="Report the result of a finished game round",
)
def report_result(payload: schemas.StatisticCreate, db: Session = Depends(get_db)):
    row = crud.create_statistic(db, payload)
    return schemas.StatisticOut.from_row(row)


# ---------------------------------------------------------------------------
# GET — querying statistics
# ---------------------------------------------------------------------------
@app.get(
    "/statistics",
    response_model=schemas.StatisticList,
    tags=["statistics"],
    summary="List statistics, optionally filtered by player/device/game/date range",
)
def get_statistics(
    player_id: Optional[str] = Query(None, description="Filter by player id"),
    device: Optional[str] = Query(None, description="Filter by the player's device (joins players table)"),
    game: Optional[str] = Query(None, description="Filter by game name"),
    start: Optional[datetime] = Query(None, description="Only rows at/after this ISO timestamp"),
    end: Optional[datetime] = Query(None, description="Only rows at/before this ISO timestamp"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    total, rows = crud.list_statistics(
        db, player_id=player_id, device=device, game=game, start=start, end=end, limit=limit, offset=offset
    )
    return {"total": total, "results": [schemas.StatisticOut.from_row(r) for r in rows]}


@app.get(
    "/statistics/summary",
    response_model=schemas.PlayerSummary,
    tags=["statistics"],
    summary="Aggregate totals (rounds played, total bet/win, net) for a filter set",
)
def get_summary(
    player_id: Optional[str] = Query(None),
    device: Optional[str] = Query(None),
    game: Optional[str] = Query(None),
    start: Optional[datetime] = Query(None),
    end: Optional[datetime] = Query(None),
    db: Session = Depends(get_db),
):
    return crud.summarize(db, player_id=player_id, device=device, game=game, start=start, end=end)


@app.get(
    "/statistics/player-names",
    response_model=list[str],
    tags=["statistics"],
    summary="Distinct player names seen in the statistics ledger, resolved via the players table",
)
def get_statistics_player_names(db: Session = Depends(get_db)):
    return crud.list_distinct_player_names(db)


# NOTE: this path-param route MUST be declared after any other literal
# "/statistics/..." routes (like /statistics/summary and /statistics/player-names
# above), otherwise FastAPI matches e.g. "player-names" as {stat_id} since
# routes are matched in declaration order.
@app.get(
    "/statistics/{stat_id}",
    response_model=schemas.StatisticOut,
    tags=["statistics"],
    summary="Get a single statistics row by its id",
)
def get_statistic_by_id(stat_id: str, db: Session = Depends(get_db)):
    row = crud.get_statistic(db, stat_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Statistic not found")
    return schemas.StatisticOut.from_row(row)


@app.get(
    "/games",
    response_model=list[str],
    tags=["statistics"],
    summary="List distinct game names that have at least one statistic row",
)
def get_games(db: Session = Depends(get_db)):
    return crud.list_games(db)


# ---------------------------------------------------------------------------
# Players (wallets)
# ---------------------------------------------------------------------------
@app.post(
    "/players",
    response_model=schemas.PlayerOut,
    status_code=status.HTTP_201_CREATED,
    tags=["players"],
    summary="Register a new player/wallet",
)
def create_player(payload: schemas.PlayerCreate, db: Session = Depends(get_db)):
    return crud.create_player(db, payload)


@app.get(
    "/players",
    response_model=list[schemas.PlayerOut],
    tags=["players"],
    summary="List registered players, optionally filtered by device or name",
)
def list_players(
    device: Optional[str] = Query(None),
    name: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    return crud.list_all_players(db, device=device, name=name)


@app.get(
    "/players/{player_id}/summary",
    response_model=schemas.PlayerSummary,
    tags=["players"],
    summary="Aggregate statistics totals for a player (optionally scoped to a game)",
)
def get_player_summary(
    player_id: str,
    game: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    return crud.summarize(db, player_id=player_id, game=game)


@app.get(
    "/players/{player_id}",
    response_model=schemas.PlayerOut,
    tags=["players"],
    summary="Get a single player by id",
)
def get_player(player_id: str, db: Session = Depends(get_db)):
    return crud.get_player(db, player_id)


@app.patch(
    "/players/{player_id}",
    response_model=schemas.PlayerOut,
    tags=["players"],
    summary="Update a player's device and/or current balance",
)
def update_player(player_id: str, payload: schemas.PlayerUpdate, db: Session = Depends(get_db)):
    return crud.update_player(db, player_id, payload)


# ---------------------------------------------------------------------------
# Roulette
# ---------------------------------------------------------------------------
@app.post(
    "/roulette/games",
    response_model=schemas.RouletteGameOut,
    status_code=status.HTTP_201_CREATED,
    tags=["roulette"],
    summary="Start a new roulette round (called by roulette.py). Bets from prior rounds are kept, scoped by game id.",
)
def start_roulette_game(db: Session = Depends(get_db)):
    return crud.create_roulette_game(db)


@app.get(
    "/roulette/games",
    response_model=list[schemas.RouletteGameOut],
    tags=["roulette"],
    summary="List roulette games, optionally filtered by status",
)
def list_roulette_games(
    status_: Optional[schemas.GameStatus] = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    return crud.list_roulette_games(db, status=status_, limit=limit, offset=offset)


@app.get(
    "/roulette/games/current",
    response_model=schemas.RouletteGameOut,
    tags=["roulette"],
    summary="Get the most recent roulette game, by game_start_time (optionally filtered by status)",
)
def get_current_roulette_game(
    status_: Optional[schemas.GameStatus] = Query(None, alias="status"),
    db: Session = Depends(get_db),
):
    return crud.get_current_roulette_game(db, status=status_)


@app.get(
    "/roulette/games/{game_id}",
    response_model=schemas.RouletteGameOut,
    tags=["roulette"],
    summary="Get a single roulette game by id",
)
def get_roulette_game(game_id: str, db: Session = Depends(get_db)):
    return crud.get_roulette_game(db, game_id)


@app.patch(
    "/roulette/games/{game_id}/status",
    response_model=schemas.RouletteGameOut,
    tags=["roulette"],
    summary="Advance the game's status (waiting_for_bets -> running -> ended), called by roulette.py",
)
def set_roulette_status(game_id: str, payload: schemas.RouletteStatusUpdate, db: Session = Depends(get_db)):
    return crud.update_roulette_status(db, game_id, payload.status)


@app.post(
    "/roulette/games/{game_id}/join",
    response_model=schemas.RouletteBetOut,
    status_code=status.HTTP_201_CREATED,
    tags=["roulette"],
    summary="A player joins the current round with a number + bet amount (only while waiting_for_bets)",
)
def join_roulette_game(game_id: str, payload: schemas.RouletteBetCreate, db: Session = Depends(get_db)):
    bet = crud.place_roulette_bet(db, game_id, payload)
    return schemas.RouletteBetOut.from_row(bet)


@app.get(
    "/roulette/games/{game_id}/players",
    response_model=list[schemas.RouletteBetOut],
    tags=["roulette"],
    summary="List all bets placed in a roulette game",
)
def list_roulette_game_players(game_id: str, db: Session = Depends(get_db)):
    bets = crud.list_roulette_bets(db, game_id)
    return [schemas.RouletteBetOut.from_row(b) for b in bets]


@app.post(
    "/roulette/games/{game_id}/draw",
    response_model=schemas.RouletteDrawResult,
    tags=["roulette"],
    summary="Report the drawn number (called by roulette.py). Settles all bets and ends the game.",
)
def draw_roulette_game(game_id: str, payload: schemas.RouletteDrawRequest, db: Session = Depends(get_db)):
    game, results = crud.resolve_roulette_game(db, game_id, payload.number_draw)
    return {"game": game, "results": results}


# ---------------------------------------------------------------------------
# Crash
# ---------------------------------------------------------------------------
@app.post(
    "/crash/games",
    response_model=schemas.CrashGameOut,
    status_code=status.HTTP_201_CREATED,
    tags=["crash"],
    summary="Start a new crash round (called by crash.py). Bets from prior rounds are kept, scoped by game id.",
)
def start_crash_game(db: Session = Depends(get_db)):
    return crud.create_crash_game(db)


@app.get(
    "/crash/games",
    response_model=list[schemas.CrashGameOut],
    tags=["crash"],
    summary="List crash games, optionally filtered by status",
)
def list_crash_games(
    status_: Optional[schemas.GameStatus] = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    return crud.list_crash_games(db, status=status_, limit=limit, offset=offset)


@app.get(
    "/crash/games/current",
    response_model=schemas.CrashGameOut,
    tags=["crash"],
    summary="Get the most recent crash game, by game_start_time (optionally filtered by status)",
)
def get_current_crash_game(
    status_: Optional[schemas.GameStatus] = Query(None, alias="status"),
    db: Session = Depends(get_db),
):
    return crud.get_current_crash_game(db, status=status_)


@app.get(
    "/crash/games/{game_id}",
    response_model=schemas.CrashGameOut,
    tags=["crash"],
    summary="Get a single crash game by id",
)
def get_crash_game(game_id: str, db: Session = Depends(get_db)):
    return crud.get_crash_game(db, game_id)


@app.patch(
    "/crash/games/{game_id}/status",
    response_model=schemas.CrashGameOut,
    tags=["crash"],
    summary="Advance the game's status (waiting_for_bets -> running -> ended), called by crash.py",
)
def set_crash_status(game_id: str, payload: schemas.CrashStatusUpdate, db: Session = Depends(get_db)):
    return crud.update_crash_status(db, game_id, payload.status)


@app.post(
    "/crash/games/{game_id}/join",
    response_model=schemas.CrashBetOut,
    status_code=status.HTTP_201_CREATED,
    tags=["crash"],
    summary="A player joins the current round with a bet amount (only while waiting_for_bets)",
)
def join_crash_game(game_id: str, payload: schemas.CrashBetCreate, db: Session = Depends(get_db)):
    bet = crud.place_crash_bet(db, game_id, payload)
    return schemas.CrashBetOut.from_row(bet)


@app.get(
    "/crash/games/{game_id}/players",
    response_model=list[schemas.CrashBetOut],
    tags=["crash"],
    summary="List all bets/players in a crash game",
)
def list_crash_game_players(game_id: str, db: Session = Depends(get_db)):
    bets = crud.list_crash_bets(db, game_id)
    return [schemas.CrashBetOut.from_row(b) for b in bets]


@app.post(
    "/crash/games/{game_id}/cashout",
    response_model=schemas.CrashBetOut,
    tags=["crash"],
    summary="A player cashes out at the current multiplier (only while running)",
)
def cashout_crash_game(game_id: str, payload: schemas.CrashCashoutRequest, db: Session = Depends(get_db)):
    bet = crud.cashout_crash_bet(db, game_id, payload)
    return schemas.CrashBetOut.from_row(bet)


@app.post(
    "/crash/games/{game_id}/crash",
    response_model=schemas.CrashResolveResult,
    tags=["crash"],
    summary="Report the final crash multiplier (called by crash.py). Settles remaining bets and ends the game.",
)
def crash_out_game(game_id: str, payload: schemas.CrashResolveRequest, db: Session = Depends(get_db)):
    game, results = crud.resolve_crash_game(db, game_id, payload.crash_multiplier)
    return {"game": game, "results": results}
