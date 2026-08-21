"""
Casino backend API.

Run with:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload

Docs (auto-generated) at:
    http://localhost:8000/docs
"""
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

import crud
import models
import schemas
from database import engine, get_db

# Creates casino.db and the statistics table on first run.
# Safe to call every startup: it only creates tables that don't exist yet,
# so adding new game-specific tables later (imported into models.py) won't
# touch this table.
models.Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Casino Backend API",
    description="Central statistics ledger for locally-run casino games.",
    version="1.0.0",
)


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
    return row


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
    player: Optional[str] = Query(None, description="Filter by exact player name"),
    device: Optional[int] = Query(None, description="Filter by device id"),
    game: Optional[str] = Query(None, description="Filter by game name"),
    start: Optional[datetime] = Query(None, description="Only rows at/after this ISO timestamp"),
    end: Optional[datetime] = Query(None, description="Only rows at/before this ISO timestamp"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    total, rows = crud.list_statistics(
        db, player=player, device=device, game=game, start=start, end=end, limit=limit, offset=offset
    )
    return {"total": total, "results": rows}


@app.get(
    "/statistics/summary",
    response_model=schemas.PlayerSummary,
    tags=["statistics"],
    summary="Aggregate totals (rounds played, total bet/win, net) for a filter set",
)
def get_summary(
    player: Optional[str] = Query(None),
    device: Optional[int] = Query(None),
    game: Optional[str] = Query(None),
    start: Optional[datetime] = Query(None),
    end: Optional[datetime] = Query(None),
    db: Session = Depends(get_db),
):
    return crud.summarize(db, player=player, device=device, game=game, start=start, end=end)


# NOTE: this path-param route MUST be declared after any other literal
# "/statistics/..." routes (like /statistics/summary above), otherwise
# FastAPI matches e.g. "summary" as {stat_id} since routes are matched
# in declaration order.
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
    return row


@app.get(
    "/players/{player}/summary",
    response_model=schemas.PlayerSummary,
    tags=["players"],
    summary="Aggregate totals for one specific player (optionally scoped to a game)",
)
def get_player_summary(
    player: str,
    game: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    return crud.summarize(db, player=player, game=game)


@app.get(
    "/players",
    response_model=list[str],
    tags=["players"],
    summary="List distinct player names that have at least one statistic row",
)
def get_players(db: Session = Depends(get_db)):
    return crud.list_players(db)


@app.get(
    "/games",
    response_model=list[str],
    tags=["games"],
    summary="List distinct game names that have at least one statistic row",
)
def get_games(db: Session = Depends(get_db)):
    return crud.list_games(db)
