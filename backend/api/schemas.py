"""
Pydantic (v2) request/response schemas.
"""
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

GameStatus = Literal["waiting_for_bets", "running", "ended"]


class StatisticCreate(BaseModel):
    """Body for POST /statistics — a game client reporting one round's result."""

    player: str = Field(..., min_length=1, description="Player id (see /players)")
    game: str = Field(..., min_length=1, examples=["roulette", "crash"])
    bet: float = Field(..., ge=0, description="Amount wagered")
    win: float = Field(..., ge=0, description="Amount returned to the player (0 if they lost)")


class StatisticOut(BaseModel):
    id: str
    player: str = Field(..., description="Player id")
    player_name: str
    device: str
    game: str
    bet: float
    win: float
    net: float
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_row(cls, row) -> "StatisticOut":
        return cls(
            id=row.id,
            player=row.player_id,
            player_name=row.player.name,
            device=row.player.device,
            game=row.game,
            bet=row.bet,
            win=row.win,
            net=row.net,
            created_at=row.created_at,
        )


class StatisticList(BaseModel):
    total: int
    results: list[StatisticOut]


class PlayerSummary(BaseModel):
    """Aggregated view for GET /statistics/summary and /players/{player_id}/summary."""

    player_id: Optional[str] = None
    player_name: Optional[str] = None
    game: Optional[str] = None
    rounds_played: int
    total_bet: float
    total_win: float
    net: float


# ---------------------------------------------------------------------------
# Players (wallets)
# ---------------------------------------------------------------------------
class PlayerCreate(BaseModel):
    name: str = Field(..., min_length=1)
    device: str = Field(..., min_length=1, description="Terminal/tablet identifier")
    starting_currency: float = Field(..., ge=0)
    current_currency: Optional[float] = Field(
        None, ge=0, description="Defaults to starting_currency if omitted"
    )


class PlayerUpdate(BaseModel):
    """Partial update -- send only the fields you want to change."""

    device: Optional[str] = None
    current_currency: Optional[float] = Field(None, ge=0)


class PlayerOut(BaseModel):
    id: str
    name: str
    device: str
    starting_currency: float
    current_currency: float
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BetResult(BaseModel):
    """One player's outcome after a roulette draw or a crash round ends."""

    player_id: str
    player_name: str
    money_bet: float
    win: float
    net: float


# ---------------------------------------------------------------------------
# Roulette
# ---------------------------------------------------------------------------
class RouletteGameOut(BaseModel):
    id: str
    number_draw: Optional[int] = None
    game_start_time: datetime
    status: str

    model_config = ConfigDict(from_attributes=True)


class RouletteStatusUpdate(BaseModel):
    status: GameStatus


class RouletteBetCreate(BaseModel):
    """POST body for a player joining/betting in the current roulette game."""

    player: str = Field(..., description="Player id")
    number_bet: int = Field(..., ge=0, le=36)
    money_bet: float = Field(..., gt=0)


class RouletteBetOut(BaseModel):
    id: str
    roulette_game: str
    player: str
    number_bet: int
    money_bet: float

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_row(cls, row) -> "RouletteBetOut":
        return cls(
            id=row.id,
            roulette_game=row.roulette_game_id,
            player=row.player_id,
            number_bet=row.number_bet,
            money_bet=row.money_bet,
        )


class RouletteDrawRequest(BaseModel):
    """Body roulette.py posts once it has drawn the winning number."""

    number_draw: int = Field(..., ge=0, le=36)


class RouletteDrawResult(BaseModel):
    game: RouletteGameOut
    results: list[BetResult]


# ---------------------------------------------------------------------------
# Crash
# ---------------------------------------------------------------------------
class CrashGameOut(BaseModel):
    id: str
    crash_multiplier: Optional[float] = None
    game_start_time: datetime
    status: str

    model_config = ConfigDict(from_attributes=True)


class CrashStatusUpdate(BaseModel):
    status: GameStatus


class CrashBetCreate(BaseModel):
    """POST body for a player joining/betting in the current crash game."""

    player: str = Field(..., description="Player id")
    money_bet: float = Field(..., gt=0)


class CrashBetOut(BaseModel):
    id: str
    crash_game: str
    player: str
    money_bet: float
    left: bool
    multiplier: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_row(cls, row) -> "CrashBetOut":
        return cls(
            id=row.id,
            crash_game=row.crash_game_id,
            player=row.player_id,
            money_bet=row.money_bet,
            left=row.left,
            multiplier=row.multiplier,
        )


class CrashCashoutRequest(BaseModel):
    """Body the frontend posts when a player hits 'cash out'."""

    player: str = Field(..., description="Player id")
    multiplier: float = Field(..., gt=0, description="Multiplier at the moment of cashout")


class CrashResolveRequest(BaseModel):
    """Body crash.py posts once it knows the final crash point."""

    crash_multiplier: float = Field(..., gt=0)


class CrashResolveResult(BaseModel):
    game: CrashGameOut
    results: list[BetResult]
