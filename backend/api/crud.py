"""
Database access functions, kept separate from the route handlers.

This module deliberately doesn't import FastAPI: game-logic errors (not
found, wrong game state, insufficient balance, ...) are raised as the
plain exceptions below, and main.py is responsible for turning them into
the right HTTP status codes.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

import models
import schemas


class CasinoError(Exception):
    """Base class for domain errors raised from crud.py."""


class NotFoundError(CasinoError):
    pass


class InvalidStateError(CasinoError):
    """Raised when an action is attempted against a game/bet in the wrong state,
    e.g. betting on a game that's already running, or cashing out twice."""


class InsufficientFundsError(CasinoError):
    pass


class ConflictError(CasinoError):
    """Raised for things like a player betting twice in the same round."""


def create_statistic(db: Session, payload: schemas.StatisticCreate) -> models.Statistics:
    player = get_player(db, payload.player)  # raises NotFoundError if the id doesn't exist
    row = models.Statistics(
        player_id=player.id,
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
    player_id: Optional[str],
    device: Optional[str],
    game: Optional[str],
    start: Optional[datetime],
    end: Optional[datetime],
):
    if player_id is not None:
        query = query.filter(models.Statistics.player_id == player_id)
    if device is not None:
        # Statistics no longer stores its own device column -- device now
        # lives on the related player, so filtering by it means a join.
        query = query.join(models.Player, models.Statistics.player_id == models.Player.id).filter(
            models.Player.device == device
        )
    if game is not None:
        query = query.filter(models.Statistics.game == game)
    if start is not None:
        query = query.filter(models.Statistics.created_at >= start)
    if end is not None:
        query = query.filter(models.Statistics.created_at <= end)
    return query


def list_statistics(
    db: Session,
    player_id: Optional[str] = None,
    device: Optional[str] = None,
    game: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[int, list[models.Statistics]]:
    base = select(models.Statistics)
    base = _apply_filters(base, player_id, device, game, start, end)

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
    player_id: Optional[str] = None,
    device: Optional[str] = None,
    game: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
) -> dict:
    query = select(
        func.count(models.Statistics.id),
        func.coalesce(func.sum(models.Statistics.bet), 0.0),
        func.coalesce(func.sum(models.Statistics.win), 0.0),
    )
    query = _apply_filters(query, player_id, device, game, start, end)

    rounds_played, total_bet, total_win = db.execute(query).one()

    player_name = None
    if player_id is not None:
        player = db.get(models.Player, player_id)
        player_name = player.name if player else None

    return {
        "player_id": player_id,
        "player_name": player_name,
        "game": game,
        "rounds_played": rounds_played,
        "total_bet": float(total_bet),
        "total_win": float(total_win),
        "net": float(total_win) - float(total_bet),
    }


def list_distinct_player_names(db: Session) -> list[str]:
    """Distinct player names that have at least one statistics row, resolved
    via the player_id FK (not the players table itself -- use
    list_all_players() for the full roster)."""
    rows = db.execute(
        select(models.Player.name)
        .join(models.Statistics, models.Statistics.player_id == models.Player.id)
        .distinct()
    ).scalars().all()
    return sorted(rows)


def list_games(db: Session) -> list[str]:
    rows = db.execute(select(models.Statistics.game).distinct()).scalars().all()
    return sorted(rows)


def _log_statistic(db: Session, player: models.Player, game: str, bet: float, win: float) -> None:
    """Write a row to the game-agnostic statistics ledger, linked to the
    player via the real player_id FK."""
    db.add(models.Statistics(player_id=player.id, game=game, bet=bet, win=win))


# ---------------------------------------------------------------------------
# Players (wallets)
# ---------------------------------------------------------------------------
def create_player(db: Session, payload: schemas.PlayerCreate) -> models.Player:
    import random
    starting_currency = payload.starting_currency if payload.starting_currency is not None else round(random.gauss(6500, 1500), -2)
    current_currency = payload.current_currency if payload.current_currency is not None else starting_currency
    row = models.Player(
        name=payload.name,
        device=payload.device,
        starting_currency=starting_currency,
        current_currency=current_currency,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_player(db: Session, player_id: str) -> models.Player:
    row = db.get(models.Player, player_id)
    if row is None:
        raise NotFoundError(f"Player {player_id} not found")
    return row


def list_all_players(db: Session, device: Optional[str] = None, name: Optional[str] = None) -> list[models.Player]:
    query = select(models.Player)
    if device is not None:
        query = query.filter(models.Player.device == device)
    if name is not None:
        query = query.filter(models.Player.name == name)
    return db.execute(query.order_by(models.Player.created_at.desc())).scalars().all()


def update_player(db: Session, player_id: str, payload: schemas.PlayerUpdate) -> models.Player:
    row = get_player(db, player_id)
    if payload.device is not None:
        row.device = payload.device
    if payload.current_currency is not None:
        row.current_currency = payload.current_currency
    db.commit()
    db.refresh(row)
    return row


# ---------------------------------------------------------------------------
# Roulette
# ---------------------------------------------------------------------------
def create_roulette_game(db: Session) -> models.RouletteGame:
    """Starts a fresh roulette round. Bets from previous rounds are left in
    place in roulette_players -- each row is already scoped to its own game
    via roulette_game_id, so "current round's bets" just means filtering by
    the new game's id (see list_roulette_bets), not clearing the table."""
    game = models.RouletteGame(status="waiting_for_bets")
    db.add(game)
    db.commit()
    db.refresh(game)
    return game


def get_roulette_game(db: Session, game_id: str) -> models.RouletteGame:
    row = db.get(models.RouletteGame, game_id)
    if row is None:
        raise NotFoundError(f"Roulette game {game_id} not found")
    return row


def list_roulette_games(
    db: Session, status: Optional[str] = None, limit: int = 50, offset: int = 0
) -> list[models.RouletteGame]:
    query = select(models.RouletteGame)
    if status is not None:
        query = query.filter(models.RouletteGame.status == status)
    query = query.order_by(models.RouletteGame.game_start_time.desc()).limit(limit).offset(offset)
    return db.execute(query).scalars().all()


def get_current_roulette_game(db: Session, status: Optional[str] = None) -> models.RouletteGame:
    query = select(models.RouletteGame)
    if status is not None:
        query = query.filter(models.RouletteGame.status == status)
    query = query.order_by(models.RouletteGame.game_start_time.desc()).limit(1)
    row = db.execute(query).scalars().first()
    if row is None:
        raise NotFoundError("No roulette game found")
    return row


def update_roulette_status(db: Session, game_id: str, status: str) -> models.RouletteGame:
    game = get_roulette_game(db, game_id)
    game.status = status
    db.commit()
    db.refresh(game)
    return game


def place_roulette_bet(db: Session, game_id: str, payload: schemas.RouletteBetCreate) -> models.RoulettePlayer:
    game = get_roulette_game(db, game_id)
    if game.status != "waiting_for_bets":
        raise InvalidStateError(f"Roulette game {game_id} is not accepting bets (status={game.status})")

    player = get_player(db, payload.player)

    existing = db.execute(
        select(models.RoulettePlayer).filter_by(roulette_game_id=game_id, player_id=player.id)
    ).scalars().first()
    if existing is not None:
        raise ConflictError("Player has already placed a bet in this roulette game")

    if player.current_currency < payload.money_bet:
        raise InsufficientFundsError(f"Player {player.name} has insufficient balance")

    player.current_currency -= payload.money_bet
    bet = models.RoulettePlayer(
        roulette_game_id=game_id,
        player_id=player.id,
        color_bet=payload.color_bet,
        money_bet=payload.money_bet,
    )
    db.add(bet)
    db.commit()
    db.refresh(bet)
    return bet


def list_roulette_bets(db: Session, game_id: str) -> list[models.RoulettePlayer]:
    get_roulette_game(db, game_id)  # 404 if missing
    return db.execute(
        select(models.RoulettePlayer).filter_by(roulette_game_id=game_id)
    ).scalars().all()


ROULETTE_RED_NUMBERS = {1, 2, 3, 4, 5, 6, 7}

def resolve_roulette_game(db: Session, game_id: str, number_draw: int) -> tuple[models.RouletteGame, list[dict]]:
    """Called by roulette.py once it has drawn the winning number. Settles
    every bet, credits winners, logs each outcome to `statistics`, and
    closes the game out."""
    game = get_roulette_game(db, game_id)
    if game.status == "ended":
        raise InvalidStateError(f"Roulette game {game_id} has already ended")

    bets = list_roulette_bets(db, game_id)
    results = []
    
    # Determina a cor vencedora com base no número sorteado pelo Croupier
    if number_draw == 0:
        winning_color = "white"
    elif number_draw in ROULETTE_RED_NUMBERS:
        winning_color = "red"
    else:
        winning_color = "black"

    for bet in bets:
        player = get_player(db, bet.player_id)
        
        # O jogador apostou na cor certa?
        won = bet.color_bet == winning_color
        
        if won:
            multiplier = 14 if winning_color == "white" else 2
            win = bet.money_bet * multiplier
        else:
            win = 0.0
            
        if win:
            player.current_currency += win
            
        _log_statistic(db, player, game="roulette", bet=bet.money_bet, win=win)
        
        results.append(
            {
                "player_id": player.id,
                "player_name": player.name,
                "money_bet": bet.money_bet,
                "win": win,
                "net": win - bet.money_bet,
            }
        )

    game.number_draw = number_draw
    game.status = "ended"
    db.commit()
    db.refresh(game)
    return game, results


# ---------------------------------------------------------------------------
# Crash
# ---------------------------------------------------------------------------
def create_crash_game(db: Session) -> models.CrashGame:
    """Starts a fresh crash round. Bets stay in crash_players across rounds,
    scoped by crash_game_id -- same reasoning as create_roulette_game."""
    game = models.CrashGame(status="waiting_for_bets")
    db.add(game)
    db.commit()
    db.refresh(game)
    return game


def get_crash_game(db: Session, game_id: str) -> models.CrashGame:
    row = db.get(models.CrashGame, game_id)
    if row is None:
        raise NotFoundError(f"Crash game {game_id} not found")
    return row


def list_crash_games(
    db: Session, status: Optional[str] = None, limit: int = 50, offset: int = 0
) -> list[models.CrashGame]:
    query = select(models.CrashGame)
    if status is not None:
        query = query.filter(models.CrashGame.status == status)
    query = query.order_by(models.CrashGame.game_start_time.desc()).limit(limit).offset(offset)
    return db.execute(query).scalars().all()


def get_current_crash_game(db: Session, status: Optional[str] = None) -> models.CrashGame:
    query = select(models.CrashGame)
    if status is not None:
        query = query.filter(models.CrashGame.status == status)
    query = query.order_by(models.CrashGame.game_start_time.desc()).limit(1)
    row = db.execute(query).scalars().first()
    if row is None:
        raise NotFoundError("No crash game found")
    return row


def update_crash_status(db: Session, game_id: str, status: str) -> models.CrashGame:
    game = get_crash_game(db, game_id)
    game.status = status
    db.commit()
    db.refresh(game)
    return game


def place_crash_bet(db: Session, game_id: str, payload: schemas.CrashBetCreate) -> models.CrashPlayer:
    game = get_crash_game(db, game_id)
    if game.status != "waiting_for_bets":
        raise InvalidStateError(f"Crash game {game_id} is not accepting bets (status={game.status})")

    player = get_player(db, payload.player)

    existing = db.execute(
        select(models.CrashPlayer).filter_by(crash_game_id=game_id, player_id=player.id)
    ).scalars().first()
    if existing is not None:
        raise ConflictError("Player has already placed a bet in this crash game")

    if player.current_currency < payload.money_bet:
        raise InsufficientFundsError(f"Player {player.name} has insufficient balance")

    player.current_currency -= payload.money_bet
    bet = models.CrashPlayer(
        crash_game_id=game_id,
        player_id=player.id,
        money_bet=payload.money_bet,
        left=False,
        multiplier=None,
    )
    db.add(bet)
    db.commit()
    db.refresh(bet)
    return bet


def list_crash_bets(db: Session, game_id: str) -> list[models.CrashPlayer]:
    get_crash_game(db, game_id)  # 404 if missing
    return db.execute(select(models.CrashPlayer).filter_by(crash_game_id=game_id)).scalars().all()


def cashout_crash_bet(db: Session, game_id: str, payload: schemas.CrashCashoutRequest) -> models.CrashPlayer:
    """Called when the frontend reports a player hit 'cash out' at a given
    multiplier while the round is still running."""
    game = get_crash_game(db, game_id)
    if game.status != "running":
        raise InvalidStateError(f"Crash game {game_id} is not running (status={game.status})")

    bet = db.execute(
        select(models.CrashPlayer).filter_by(crash_game_id=game_id, player_id=payload.player)
    ).scalars().first()
    if bet is None:
        raise NotFoundError("Player has no bet in this crash game")
    if bet.left:
        raise InvalidStateError("Player has already cashed out of this crash game")

    player = get_player(db, payload.player)
    win = bet.money_bet * payload.multiplier

    bet.left = True
    bet.multiplier = payload.multiplier
    player.current_currency += win
    _log_statistic(db, player, game="crash", bet=bet.money_bet, win=win)

    db.commit()
    db.refresh(bet)
    return bet


def resolve_crash_game(db: Session, game_id: str, crash_multiplier: float) -> tuple[models.CrashGame, list[dict]]:
    """Called by crash.py once it knows the round's crash point. Anyone who
    hadn't cashed out yet loses their stake (already deducted at bet time,
    so no balance change needed) -- we just log it and close the game."""
    game = get_crash_game(db, game_id)
    if game.status == "ended":
        raise InvalidStateError(f"Crash game {game_id} has already ended")

    bets = list_crash_bets(db, game_id)
    results = []
    for bet in bets:
        player = get_player(db, bet.player_id)
        if bet.left:
            # Already resolved + credited at cashout time.
            win = bet.money_bet * (bet.multiplier or 0.0)
        else:
            win = 0.0
            _log_statistic(db, player, game="crash", bet=bet.money_bet, win=win)
        results.append(
            {
                "player_id": player.id,
                "player_name": player.name,
                "money_bet": bet.money_bet,
                "win": win,
                "net": win - bet.money_bet,
            }
        )

    game.crash_multiplier = crash_multiplier
    game.status = "ended"
    db.commit()
    db.refresh(game)
    return game, results