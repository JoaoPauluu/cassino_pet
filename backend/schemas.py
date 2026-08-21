"""
Pydantic (v2) request/response schemas.
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class StatisticCreate(BaseModel):
    """Body for POST /statistics — a game client reporting one round's result."""

    player: str = Field(..., min_length=1, examples=["joao123"])
    device: int = Field(..., ge=0, description="ID of the device/terminal the round was played on")
    game: str = Field(..., min_length=1, examples=["roulette", "crash"])
    bet: float = Field(..., ge=0, description="Amount wagered")
    win: float = Field(..., ge=0, description="Amount returned to the player (0 if they lost)")


class StatisticOut(BaseModel):
    id: str
    player: str
    device: int
    game: str
    bet: float
    win: float
    net: float
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class StatisticList(BaseModel):
    total: int
    results: list[StatisticOut]


class PlayerSummary(BaseModel):
    """Aggregated view for GET /statistics/summary and /players/{player}/summary."""

    player: Optional[str] = None
    game: Optional[str] = None
    rounds_played: int
    total_bet: float
    total_win: float
    net: float
