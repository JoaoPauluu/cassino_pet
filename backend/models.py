"""
SQLAlchemy ORM models.

`Statistics` is the core, game-agnostic ledger of round results.
Every game (roulette, crash, whatever comes next) writes exactly one
row here per round played. Game-specific detail tables (e.g. a future
`RouletteRound` or `CrashRound`) should each carry a
`statistics_id` FK back to this table's `id`, so you can always join
"what happened in detail" back to "what the player won/lost overall".
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, String, Integer, Float, DateTime, Index
from sqlalchemy.orm import relationship

from database import Base


def _uuid_str() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Statistics(Base):
    __tablename__ = "statistics"

    id = Column(String(36), primary_key=True, default=_uuid_str)
    player = Column(String, nullable=False, index=True)
    device = Column(Integer, nullable=False, index=True)
    game = Column(String, nullable=False, index=True)
    bet = Column(Float, nullable=False)
    win = Column(Float, nullable=False)

    # Not explicitly requested, but a timestamp is close to mandatory for
    # any kind of "statistics" table -- without it you can't compute
    # sessions, daily totals, or plot anything over time. Defaults
    # server-side so game clients don't need to send it themselves.
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False, index=True)

    # Placeholder for future game-specific tables to hook into, e.g.:
    #   roulette_round = relationship("RouletteRound", uselist=False, back_populates="statistic")
    #   crash_round = relationship("CrashRound", uselist=False, back_populates="statistic")

    __table_args__ = (
        Index("ix_statistics_player_game", "player", "game"),
    )

    @property
    def net(self) -> float:
        """Convenience: positive = player profited, negative = house won."""
        return self.win - self.bet
