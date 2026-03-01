# backend/drl_trading_engine.py
# Deep Reinforcement Learning Trading Simulator
# Uses stable-baselines3 PPO/A2C with custom Gymnasium environment

from __future__ import annotations
import logging
import numpy as np
import os
import requests
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

try:
    import gymnasium as gym
    from gymnasium import spaces
    from stable_baselines3 import PPO, A2C
    from stable_baselines3.common.callbacks import BaseCallback
    SB3_AVAILABLE = True
except ImportError:
    SB3_AVAILABLE = False
    gym = None
    spaces = None
    PPO = None
    A2C = None
    BaseCallback = object  # fallback base class so class definitions don't crash
    logger.warning("stable-baselines3 not available — DRL trading will use rule-based fallback")

TRADING_DAYS = 252


class TrainingCallback(BaseCallback if SB3_AVAILABLE else object):
    """Callback to capture training metrics."""

    def __init__(self):
        if SB3_AVAILABLE:
            super().__init__()
        self.losses = []
        self.rewards = []

    def _on_step(self) -> bool:
        if len(self.model.logger.name_to_value) > 0:
            loss = self.model.logger.name_to_value.get('train/loss', 0)
            self.losses.append(float(loss))
        return True


class TradingEnvironment(gym.Env if SB3_AVAILABLE else object):
    """
    Custom Gymnasium environment for stock trading.

    Observation: 23 features
      - price_features (20): normalized close, volume, RSI, MACD, Bollinger position,
        returns (1d, 5d, 20d), SMA ratios, volatility, etc.
      - position (1): current position (-1, 0, 1)
      - cash_ratio (1): cash / initial capital
      - portfolio_value_ratio (1): portfolio_value / initial capital

    Action: Discrete(3)
      0 = hold
      1 = buy (invest 100% of cash)
      2 = sell (liquidate all shares)
    """

    metadata = {'render_modes': []}

    def __init__(self, prices: np.ndarray, features: np.ndarray,
                 initial_cash: float = 10000.0, commission: float = 0.001):
        if SB3_AVAILABLE:
            super().__init__()
        self.prices = prices
        self.features = features
        self.initial_cash = initial_cash
        self.commission = commission
        self.n_steps = len(prices)

        if SB3_AVAILABLE:
            self.observation_space = spaces.Box(low=-np.inf, high=np.inf, shape=(23,), dtype=np.float32)
            self.action_space = spaces.Discrete(3)

        self.reset()

    def reset(self, seed=None, options=None):
        if SB3_AVAILABLE:
            super().reset(seed=seed)
        self.current_step = 20  # skip first 20 for indicator warmup
        self.cash = self.initial_cash
        self.shares = 0
        self.trades = []
        self.portfolio_values = []
        if SB3_AVAILABLE:
            return self._get_obs(), {}
        return None, {}

    def _get_obs(self) -> np.ndarray:
        feat = self.features[self.current_step]
        position = 1.0 if self.shares > 0 else 0.0
        cash_ratio = self.cash / self.initial_cash
        pv = self.cash + self.shares * self.prices[self.current_step]
        pv_ratio = pv / self.initial_cash
        return np.concatenate([feat, [position, cash_ratio, pv_ratio]]).astype(np.float32)

    def step(self, action: int):
        price = self.prices[self.current_step]
        prev_value = self.cash + self.shares * price

        # Execute action
        if action == 1 and self.cash > 0:  # Buy
            n_shares = int(self.cash * (1 - self.commission) / price)
            if n_shares > 0:
                cost = n_shares * price * (1 + self.commission)
                self.cash -= cost
                self.shares += n_shares
                self.trades.append({
                    'step': int(self.current_step),
                    'action': 'buy',
                    'price': float(price),
                    'shares': int(n_shares),
                })

        elif action == 2 and self.shares > 0:  # Sell
            revenue = self.shares * price * (1 - self.commission)
            self.cash += revenue
            self.trades.append({
                'step': int(self.current_step),
                'action': 'sell',
                'price': float(price),
                'shares': int(self.shares),
            })
            self.shares = 0

        # Move to next step
        self.current_step += 1

        if self.current_step >= self.n_steps:
            # Force sell remaining at end
            if self.shares > 0:
                self.cash += self.shares * self.prices[-1] * (1 - self.commission)
                self.shares = 0
            terminated = True
        else:
            terminated = False

        # Calculate reward: percentage change in portfolio value
        new_price = self.prices[min(self.current_step, self.n_steps - 1)]
        new_value = self.cash + self.shares * new_price
        reward = (new_value - prev_value) / prev_value

        self.portfolio_values.append(float(new_value))

        obs = self._get_obs() if not terminated else np.zeros(23, dtype=np.float32)
        return obs, float(reward), terminated, False, {}


class DRLTradingEngine:
    """
    Train and evaluate DRL trading agents on historical stock data.

    Supports PPO and A2C from stable-baselines3.
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get('FMP_API_KEY')
        self._session = requests.Session()

    def _fetch_prices(self, ticker: str, period_days: int) -> Optional[np.ndarray]:
        """Fetch historical OHLCV from FMP."""
        try:
            url = "https://financialmodelingprep.com/stable/historical-price-eod/full"
            params = {
                'symbol': ticker,
                'apikey': self.api_key,
            }
            resp = self._session.get(url, params=params, timeout=15)
            data = resp.json()
            # FMP returns {"historical": [...]} or a list depending on endpoint
            hist = data.get('historical', data) if isinstance(data, dict) else data
            if isinstance(hist, list) and len(hist) > 50:
                hist_sorted = sorted(hist, key=lambda x: x.get('date', ''))
                closes = np.array([d['close'] for d in hist_sorted if 'close' in d])
                volumes = np.array([d.get('volume', 0) for d in hist_sorted if 'close' in d])
                return closes, volumes
        except Exception as e:
            logger.error(f"Failed to fetch {ticker}: {e}")
        return None, None

    def _compute_features(self, prices: np.ndarray, volumes: np.ndarray) -> np.ndarray:
        """Compute 20 technical features from price/volume data."""
        n = len(prices)
        features = np.zeros((n, 20))

        # Normalized close (z-score over 50-day window)
        for i in range(50, n):
            window = prices[i-50:i]
            features[i, 0] = (prices[i] - window.mean()) / (window.std() + 1e-8)

        # Normalized volume
        for i in range(20, n):
            window = volumes[i-20:i]
            features[i, 1] = (volumes[i] - window.mean()) / (window.std() + 1e-8)

        # Returns: 1d, 5d, 20d
        features[1:, 2] = np.diff(np.log(prices + 1e-8))
        for i in range(5, n):
            features[i, 3] = np.log(prices[i] / (prices[i-5] + 1e-8))
        for i in range(20, n):
            features[i, 4] = np.log(prices[i] / (prices[i-20] + 1e-8))

        # RSI (14-day)
        deltas = np.diff(prices)
        for i in range(15, n):
            gains = np.maximum(deltas[i-14:i], 0).mean()
            losses = np.abs(np.minimum(deltas[i-14:i], 0)).mean()
            rs = gains / (losses + 1e-8)
            features[i, 5] = (rs / (1 + rs) - 0.5) * 2  # normalize to [-1, 1]

        # MACD (12, 26, 9)
        ema12 = self._ema(prices, 12)
        ema26 = self._ema(prices, 26)
        macd = ema12 - ema26
        signal = self._ema(macd, 9)
        features[:, 6] = (macd - signal) / (prices.std() + 1e-8)

        # Bollinger Band position
        for i in range(20, n):
            sma = prices[i-20:i].mean()
            std = prices[i-20:i].std()
            features[i, 7] = (prices[i] - sma) / (2 * std + 1e-8)

        # SMA ratios: close/SMA5, close/SMA10, close/SMA20, close/SMA50
        for period, col in [(5, 8), (10, 9), (20, 10), (50, 11)]:
            for i in range(period, n):
                sma = prices[i-period:i].mean()
                features[i, col] = prices[i] / (sma + 1e-8) - 1

        # Volatility (20-day rolling std of returns)
        log_ret = np.diff(np.log(prices + 1e-8))
        for i in range(21, n):
            features[i, 12] = log_ret[i-20:i].std() * np.sqrt(TRADING_DAYS)

        # Volume trend
        for i in range(10, n):
            features[i, 13] = volumes[i] / (volumes[i-10:i].mean() + 1e-8) - 1

        # Price momentum (rate of change)
        for period, col in [(5, 14), (10, 15), (20, 16)]:
            for i in range(period, n):
                features[i, col] = (prices[i] - prices[i-period]) / (prices[i-period] + 1e-8)

        # High-low range proxy (using close differences)
        for i in range(5, n):
            window = prices[i-5:i+1]
            features[i, 17] = (window.max() - window.min()) / (window.mean() + 1e-8)

        # Gap feature (overnight gap proxy)
        features[1:, 18] = np.diff(prices) / (prices[:-1] + 1e-8)

        # Cumulative return
        features[:, 19] = prices / (prices[0] + 1e-8) - 1

        # Replace NaN/Inf
        features = np.nan_to_num(features, nan=0.0, posinf=0.0, neginf=0.0)
        return features

    @staticmethod
    def _ema(data: np.ndarray, period: int) -> np.ndarray:
        """Compute exponential moving average."""
        ema = np.zeros_like(data, dtype=float)
        ema[0] = data[0]
        alpha = 2.0 / (period + 1)
        for i in range(1, len(data)):
            ema[i] = alpha * data[i] + (1 - alpha) * ema[i-1]
        return ema

    def _rule_based_fallback(self, prices: np.ndarray, features: np.ndarray) -> Dict[str, Any]:
        """Simple momentum-based fallback when SB3 is not available."""
        n = len(prices)
        cash = 10000.0
        shares = 0
        trades = []
        portfolio_values = []
        actions = []

        for i in range(20, n):
            pv = cash + shares * prices[i]
            portfolio_values.append(float(pv))

            rsi_norm = features[i, 5]
            momentum = features[i, 4]

            if rsi_norm < -0.3 and momentum > 0 and cash > 0:  # Oversold + uptrend → buy
                n_shares = int(cash * 0.999 / prices[i])
                if n_shares > 0:
                    cash -= n_shares * prices[i] * 1.001
                    shares += n_shares
                    trades.append({'step': i, 'action': 'buy', 'price': float(prices[i]), 'shares': n_shares})
                    actions.append(1)
                else:
                    actions.append(0)
            elif rsi_norm > 0.3 and shares > 0:  # Overbought → sell
                cash += shares * prices[i] * 0.999
                trades.append({'step': i, 'action': 'sell', 'price': float(prices[i]), 'shares': shares})
                shares = 0
                actions.append(2)
            else:
                actions.append(0)

        # Close remaining position
        if shares > 0:
            cash += shares * prices[-1] * 0.999
            shares = 0

        final_value = cash
        return {
            'trades': trades,
            'portfolio_values': portfolio_values,
            'actions': actions,
            'final_value': float(final_value),
            'method': 'Rule-Based Momentum (fallback)',
        }

    def simulate(self, ticker: str, algorithm: str = 'PPO',
                 training_steps: int = 10000, initial_capital: float = 10000.0,
                 period_days: int = 756) -> Dict[str, Any]:
        """
        Train and evaluate a DRL agent.

        Returns trades, PnL, metrics, and comparison to buy-and-hold.
        """

        # Fetch data
        result = self._fetch_prices(ticker, period_days)
        if result[0] is None:
            return {'error': f'Could not fetch data for {ticker}'}

        prices, volumes = result

        if len(prices) < 100:
            return {'error': f'Insufficient data for {ticker} ({len(prices)} days)'}

        features = self._compute_features(prices, volumes)

        # Train/test split: 70/30
        split = int(len(prices) * 0.7)
        train_prices = prices[:split]
        train_features = features[:split]
        test_prices = prices[split:]
        test_features = features[split:]

        # Buy-and-hold benchmark
        bh_return = float((test_prices[-1] / test_prices[0]) - 1)
        bh_values = (test_prices / test_prices[0] * initial_capital).tolist()

        if not SB3_AVAILABLE:
            fallback = self._rule_based_fallback(test_prices, test_features)
            agent_return = (fallback['final_value'] / initial_capital) - 1

            return {
                'ticker': ticker,
                'algorithm': fallback['method'],
                'sb3_available': False,
                'trades': fallback['trades'],
                'pnl_curve': fallback['portfolio_values'],
                'benchmark_curve': bh_values,
                'training_curve': [],
                'action_distribution': {'hold': fallback['actions'].count(0), 'buy': fallback['actions'].count(1), 'sell': fallback['actions'].count(2)},
                'metrics': {
                    'total_return': float(agent_return),
                    'benchmark_return': float(bh_return),
                    'alpha': float(agent_return - bh_return),
                    'n_trades': len(fallback['trades']),
                    'final_value': float(fallback['final_value']),
                    'initial_capital': float(initial_capital),
                },
                'train_days': split,
                'test_days': len(test_prices),
            }

        # Create environments
        train_env = TradingEnvironment(train_prices, train_features, initial_capital)
        test_env = TradingEnvironment(test_prices, test_features, initial_capital)

        # Cap training steps
        training_steps = min(training_steps, 20000)

        # Train agent
        callback = TrainingCallback()
        AlgoClass = PPO if algorithm.upper() == 'PPO' else A2C
        model = AlgoClass('MlpPolicy', train_env, verbose=0,
                          learning_rate=3e-4, n_steps=min(256, split - 25),
                          batch_size=64 if algorithm.upper() == 'PPO' else None)
        model.learn(total_timesteps=training_steps, callback=callback)

        # Evaluate on test set
        obs, _ = test_env.reset()
        done = False
        actions = []

        while not done:
            action, _ = model.predict(obs, deterministic=True)
            obs, reward, done, truncated, info = test_env.step(int(action))
            actions.append(int(action))

        pnl_curve = test_env.portfolio_values
        trades = test_env.trades
        final_value = test_env.cash + test_env.shares * test_prices[-1]
        agent_return = (final_value / initial_capital) - 1

        # Compute metrics
        pnl_arr = np.array(pnl_curve)
        returns = np.diff(pnl_arr) / pnl_arr[:-1] if len(pnl_arr) > 1 else np.array([0])
        sharpe = float(returns.mean() / (returns.std() + 1e-8) * np.sqrt(TRADING_DAYS)) if len(returns) > 1 else 0
        max_dd = float(np.max(np.maximum.accumulate(pnl_arr) - pnl_arr) / (np.maximum.accumulate(pnl_arr) + 1e-8).max())

        # Win rate
        winning_trades = 0
        for i in range(0, len(trades) - 1, 2):
            if i + 1 < len(trades):
                if trades[i]['action'] == 'buy' and trades[i+1]['action'] == 'sell':
                    if trades[i+1]['price'] > trades[i]['price']:
                        winning_trades += 1
        n_round_trips = len(trades) // 2
        win_rate = winning_trades / n_round_trips if n_round_trips > 0 else 0

        action_counts = {'hold': actions.count(0), 'buy': actions.count(1), 'sell': actions.count(2)}

        return {
            'ticker': ticker,
            'algorithm': f'{algorithm.upper()} (stable-baselines3)',
            'sb3_available': True,
            'trades': trades,
            'pnl_curve': pnl_curve,
            'benchmark_curve': bh_values,
            'training_curve': callback.losses[-100:] if callback.losses else [],
            'action_distribution': action_counts,
            'metrics': {
                'total_return': float(agent_return),
                'benchmark_return': float(bh_return),
                'alpha': float(agent_return - bh_return),
                'sharpe': float(sharpe),
                'max_drawdown': float(max_dd),
                'win_rate': float(win_rate),
                'n_trades': len(trades),
                'n_round_trips': n_round_trips,
                'final_value': float(final_value),
                'initial_capital': float(initial_capital),
            },
            'train_days': split,
            'test_days': len(test_prices),
            'training_steps': training_steps,
        }


# Module-level singleton
_engine: Optional[DRLTradingEngine] = None

def get_drl_engine() -> DRLTradingEngine:
    global _engine
    if _engine is None:
        _engine = DRLTradingEngine()
    return _engine
