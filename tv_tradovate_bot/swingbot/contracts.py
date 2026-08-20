"""Futures contract specifications.

Everything the risk/backtest math needs to convert price moves into dollars for
the micro contracts we trade. Keep this the single source of truth for contract
economics -- do not sprinkle multipliers through the code.

Notes
-----
* MNQ  Micro E-mini Nasdaq-100 : $2 per index point, tick 0.25 (=$0.50/tick).
* MGC  Micro Gold             : $10 per $1.00 move, tick 0.10 (=$1.00/tick).

`point_value` is dollars per 1.00 of price move for ONE contract.
`initial_margin` is an approximate day/overnight margin used only for a sanity
cap in sizing -- your broker's live margin is authoritative.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict


@dataclass(frozen=True)
class ContractSpec:
    symbol: str          # root symbol, e.g. "MNQ"
    name: str
    point_value: float   # $ per 1.00 of price move, per contract
    tick_size: float     # minimum price increment
    tick_value: float    # $ per tick, per contract
    initial_margin: float  # approx $ margin per contract (sanity cap only)
    tradovate_root: str  # symbol root as Tradovate expects it


SPECS: Dict[str, ContractSpec] = {
    "MNQ": ContractSpec(
        symbol="MNQ",
        name="Micro E-mini Nasdaq-100",
        point_value=2.0,
        tick_size=0.25,
        tick_value=0.50,
        initial_margin=2000.0,
        tradovate_root="MNQ",
    ),
    "MGC": ContractSpec(
        symbol="MGC",
        name="Micro Gold",
        point_value=10.0,
        tick_size=0.10,
        tick_value=1.0,
        initial_margin=1500.0,
        tradovate_root="MGC",
    ),
}


def get_spec(symbol: str) -> ContractSpec:
    root = symbol.upper().strip()
    # Accept a full contract symbol like "MNQZ2025" by matching the root.
    for key in SPECS:
        if root == key or root.startswith(key):
            return SPECS[key]
    raise KeyError(
        f"Unknown contract '{symbol}'. Known roots: {', '.join(SPECS)}. "
        f"Add it to swingbot/contracts.py."
    )


def dollars_per_point(symbol: str) -> float:
    return get_spec(symbol).point_value
