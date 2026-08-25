"""
Database access functions, kept separate from the route handlers.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

import backend.api.models as models
import backend.api.schemas as schemas


def create_statistic(db: Session, payload: schemas.StatisticCreate) -> models.Statistics:
    row = models.Statistics(
        player=payload.player,
        device=payload.device,
        game=payload.game,
        bet=payload.bet,
        win=payload.win,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_statistic(db: Session, stat_id: str) -> Optional[models.Statistics]:
    return db.get(models.Statistics, stat_id)


def _apply_filters(
    query,
    player: Optional[str],
    device: Optional[int],
    game: Optional[str],
    start: Optional[datetime],
    end: Optional[datetime],
):
    if player is not None:
        query = query.filter(models.Statistics.player == player)
    if device is not None:
        query = query.filter(models.Statistics.device == device)
    if game is not None:
        query = query.filter(models.Statistics.game == game)
    if start is not None:
        query = query.filter(models.Statistics.created_at >= start)
    if end is not None:
        query = query.filter(models.Statistics.created_at <= end)
    return query


def list_statistics(
    db: Session,
    player: Optional[str] = None,
    device: Optional[int] = None,
    game: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[int, list[models.Statistics]]:
    base = select(models.Statistics)
    base = _apply_filters(base, player, device, game, start, end)

    total = db.scalar(select(func.count()).select_from(base.subquery()))

    rows = (
        db.execute(
            base.order_by(models.Statistics.created_at.desc()).limit(limit).offset(offset)
        )
        .scalars()
        .all()
    )
    return total or 0, rows


def summarize(
    db: Session,
    player: Optional[str] = None,
    device: Optional[int] = None,
    game: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
) -> dict:
    query = select(
        func.count(models.Statistics.id),
        func.coalesce(func.sum(models.Statistics.bet), 0.0),
        func.coalesce(func.sum(models.Statistics.win), 0.0),
    )
    query = _apply_filters(query, player, device, game, start, end)

    rounds_played, total_bet, total_win = db.execute(query).one()
    return {
        "player": player,
        "game": game,
        "rounds_played": rounds_played,
        "total_bet": float(total_bet),
        "total_win": float(total_win),
        "net": float(total_win) - float(total_bet),
    }


def list_players(db: Session) -> list[str]:
    rows = db.execute(select(models.Statistics.player).distinct()).scalars().all()
    return sorted(rows)


def list_games(db: Session) -> list[str]:
    rows = db.execute(select(models.Statistics.game).distinct()).scalars().all()
    return sorted(rows)
