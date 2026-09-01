"""
SQLAlchemy ORM models.

`Statistics` is the core, game-agnostic ledger of round results. Every
game (roulette, crash, whatever comes next) writes exactly one row here
per resolved bet, linked to the player via `player_id` (a real FK to
`players.id`, not a denormalized name/device pair).
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship

from database import Base

# Status values shared by roulette_games and crash_games.
GAME_STATUSES = ("waiting_for_bets", "running", "ended")


def _uuid_str() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Statistics(Base):
    __tablename__ = "statistics"

    id = Column(String(36), primary_key=True, default=_uuid_str)
    player_id = Column(String(36), ForeignKey("players.id"), nullable=False, index=True)
    game = Column(String, nullable=False, index=True)
    bet = Column(Float, nullable=False)
    win = Column(Float, nullable=False)

    # Not explicitly requested, but a timestamp is close to mandatory for
    # any kind of "statistics" table -- without it you can't compute
    # sessions, daily totals, or plot anything over time. Defaults
    # server-side so game clients don't need to send it themselves.
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False, index=True)

    player = relationship("Player")

    __table_args__ = (
        Index("ix_statistics_player_game", "player_id", "game"),
    )

    @property
    def net(self) -> float:
        """Convenience: positive = player profited, negative = house won."""
        return self.win - self.bet


class Player(Base):
    """A registered player/wallet. `device` here identifies the terminal/tablet
    they're currently playing from (string, e.g. a hostname or asset tag) --
    separate from `statistics.device`, which is the historical integer id."""

    __tablename__ = "players"

    id = Column(String(36), primary_key=True, default=_uuid_str)
    name = Column(String, nullable=False, index=True)
    device = Column(String, nullable=False, index=True)
    starting_currency = Column(Float, nullable=False)
    current_currency = Column(Float, nullable=False)

    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

    __table_args__ = (
        Index("ix_players_name_device", "name", "device"),
    )


class RouletteGame(Base):
    __tablename__ = "roulette_games"

    id = Column(String(36), primary_key=True, default=_uuid_str)  # unique_identifier
    number_draw = Column(Integer, nullable=True)  # set once the wheel is resolved
    game_start_time = Column(DateTime(timezone=True), default=_utcnow, nullable=False, index=True)
    status = Column(String, nullable=False, default="waiting_for_bets", index=True)

    bets = relationship("RoulettePlayer", back_populates="game", cascade="all, delete-orphan")


class RoulettePlayer(Base):
    """A player's bet in one roulette round. Rows persist across rounds --
    "the current round's bets" means filtering by roulette_game_id, not a
    table that gets cleared. Full player win/loss history lives here too;
    `statistics` is the game-agnostic rollup of the same events."""

    __tablename__ = "roulette_players"

    id = Column(String(36), primary_key=True, default=_uuid_str)
    roulette_game_id = Column(String(36), ForeignKey("roulette_games.id"), nullable=False, index=True)
    player_id = Column(String(36), ForeignKey("players.id"), nullable=False, index=True)
    color_bet = Column(String, nullable=False)
    money_bet = Column(Float, nullable=False)

    game = relationship("RouletteGame", back_populates="bets")
    player = relationship("Player")

    __table_args__ = (
        Index("ix_roulette_players_game_player", "roulette_game_id", "player_id"),
    )


class CrashGame(Base):
    __tablename__ = "crash_games"

    id = Column(String(36), primary_key=True, default=_uuid_str)  # unique_identifier
    crash_multiplier = Column(Float, nullable=True)  # set once the round crashes
    game_start_time = Column(DateTime(timezone=True), default=_utcnow, nullable=False, index=True)
    status = Column(String, nullable=False, default="waiting_for_bets", index=True)

    bets = relationship("CrashPlayer", back_populates="game", cascade="all, delete-orphan")


class CrashPlayer(Base):
    """A player's bet in one crash round. Same reasoning as RoulettePlayer
    above -- rows persist across rounds, scoped by crash_game_id."""

    __tablename__ = "crash_players"

    id = Column(String(36), primary_key=True, default=_uuid_str)
    crash_game_id = Column(String(36), ForeignKey("crash_games.id"), nullable=False, index=True)
    player_id = Column(String(36), ForeignKey("players.id"), nullable=False, index=True)
    money_bet = Column(Float, nullable=False)
    left = Column(Boolean, nullable=False, default=False)  # has the player cashed out?
    multiplier = Column(Float, nullable=True)  # multiplier at cashout, if left=True

    game = relationship("CrashGame", back_populates="bets")
    player = relationship("Player")

    __table_args__ = (
        Index("ix_crash_players_game_player", "crash_game_id", "player_id"),
    )