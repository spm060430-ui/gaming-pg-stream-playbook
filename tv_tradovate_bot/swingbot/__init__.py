"""TradingView -> Tradovate swing-trading bot (micro futures).

Signal generation lives in Pine Script on TradingView (native backtest + paper
trading + live alerts). This Python package provides:

  * a research backtester that mirrors the Pine strategy's logic,
  * an independent risk / circuit-breaker layer, and
  * a webhook relay that turns TradingView alerts into Tradovate orders.

Pipeline for LIVE trades:

    TradingView (Pine strategy alert)
        -> webhook  -> relay (validate + risk check + circuit breaker)
        -> Tradovate API (place/flatten order)
        -> logging + daily report + halt/alert

See README.md for the full write-up, wiring guide, and the paper-first plan.
"""

__version__ = "0.1.0"
