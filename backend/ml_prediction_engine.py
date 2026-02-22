from __future__ import annotations

# backend/ml_prediction_engine.py
# Machine Learning Price Prediction Engine
# LSTM-based stock price forecasting with Monte Carlo dropout uncertainty estimation
# Integrates with existing backend engines (spectral_cycle_analyzer, market_sentiment_engine, probability_engine)

import logging
import math
import numpy as np
import os
import requests
import time
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# OPTIONAL DEPENDENCY IMPORTS
# ═══════════════════════════════════════════════════════════════════════════════

try:
    import torch
    import torch.nn as nn
    from torch.utils.data import DataLoader, TensorDataset
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False
    logger.warning("PyTorch not available - ML prediction disabled")

try:
    from sklearn.preprocessing import MinMaxScaler
    from sklearn.model_selection import TimeSeriesSplit
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    logger.warning("scikit-learn not available - ML prediction disabled")


# ═══════════════════════════════════════════════════════════════════════════════
# TECHNICAL FEATURE ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

class TechnicalFeatureEngine:
    """Calculate technical indicators as features for the ML model."""

    FEATURE_NAMES: List[str] = [
        'close', 'open', 'high', 'low', 'volume',
        'returns', 'log_returns',
        'sma_5', 'sma_10', 'sma_20', 'sma_50',
        'ema_12', 'ema_26',
        'rsi_14',
        'macd', 'macd_signal', 'macd_hist',
        'bb_upper', 'bb_middle', 'bb_lower', 'bb_width', 'bb_pctb',
        'atr_14',
        'volume_sma_20', 'volume_ratio',
        'price_to_sma20', 'price_to_sma50',
        'high_low_range', 'close_open_range',
    ]

    @staticmethod
    def _sma(data: np.ndarray, period: int) -> np.ndarray:
        """Simple Moving Average."""
        out = np.full_like(data, np.nan)
        if len(data) < period:
            return out
        cumsum = np.cumsum(data)
        cumsum[period:] = cumsum[period:] - cumsum[:-period]
        out[period - 1:] = cumsum[period - 1:] / period
        return out

    @staticmethod
    def _ema(data: np.ndarray, period: int) -> np.ndarray:
        """Exponential Moving Average."""
        out = np.full_like(data, np.nan)
        if len(data) < period:
            return out
        alpha = 2.0 / (period + 1)
        out[period - 1] = np.mean(data[:period])
        for i in range(period, len(data)):
            out[i] = alpha * data[i] + (1 - alpha) * out[i - 1]
        return out

    @staticmethod
    def _rsi(closes: np.ndarray, period: int = 14) -> np.ndarray:
        """Relative Strength Index."""
        out = np.full_like(closes, np.nan)
        if len(closes) < period + 1:
            return out
        deltas = np.diff(closes)
        gains = np.where(deltas > 0, deltas, 0.0)
        losses = np.where(deltas < 0, -deltas, 0.0)
        avg_gain = np.mean(gains[:period])
        avg_loss = np.mean(losses[:period])
        for i in range(period, len(deltas)):
            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period
            if avg_loss == 0:
                out[i + 1] = 100.0
            else:
                rs = avg_gain / avg_loss
                out[i + 1] = 100.0 - (100.0 / (1.0 + rs))
        return out

    @staticmethod
    def _atr(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> np.ndarray:
        """Average True Range."""
        out = np.full_like(closes, np.nan)
        if len(closes) < period + 1:
            return out
        tr = np.zeros(len(closes))
        tr[0] = highs[0] - lows[0]
        for i in range(1, len(closes)):
            tr[i] = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1]),
            )
        out[period] = np.mean(tr[1:period + 1])
        for i in range(period + 1, len(closes)):
            out[i] = (out[i - 1] * (period - 1) + tr[i]) / period
        return out

    @classmethod
    def compute_features(
        cls,
        opens: np.ndarray,
        highs: np.ndarray,
        lows: np.ndarray,
        closes: np.ndarray,
        volumes: np.ndarray,
    ) -> np.ndarray:
        """
        Compute technical indicator features from OHLCV data.

        Returns feature matrix of shape [n_samples, n_features].
        Rows with NaN (warm-up period) should be trimmed by the caller.
        """
        n = len(closes)
        features: Dict[str, np.ndarray] = {}

        # --- Raw OHLCV ---
        features['close'] = closes
        features['open'] = opens
        features['high'] = highs
        features['low'] = lows
        features['volume'] = volumes.astype(np.float64)

        # --- Returns ---
        returns = np.zeros(n)
        returns[1:] = (closes[1:] - closes[:-1]) / np.where(closes[:-1] != 0, closes[:-1], 1.0)
        features['returns'] = returns

        log_returns = np.zeros(n)
        safe_closes = np.where(closes > 0, closes, 1.0)
        log_returns[1:] = np.log(safe_closes[1:] / safe_closes[:-1])
        features['log_returns'] = log_returns

        # --- Simple Moving Averages ---
        features['sma_5'] = cls._sma(closes, 5)
        features['sma_10'] = cls._sma(closes, 10)
        features['sma_20'] = cls._sma(closes, 20)
        features['sma_50'] = cls._sma(closes, 50)

        # --- Exponential Moving Averages ---
        features['ema_12'] = cls._ema(closes, 12)
        features['ema_26'] = cls._ema(closes, 26)

        # --- RSI ---
        features['rsi_14'] = cls._rsi(closes, 14)

        # --- MACD ---
        ema12 = features['ema_12']
        ema26 = features['ema_26']
        macd_line = ema12 - ema26
        features['macd'] = macd_line
        features['macd_signal'] = cls._ema(
            np.where(np.isnan(macd_line), 0.0, macd_line), 9
        )
        features['macd_hist'] = macd_line - features['macd_signal']

        # --- Bollinger Bands ---
        sma20 = features['sma_20']
        bb_std = np.full(n, np.nan)
        for i in range(19, n):
            bb_std[i] = np.std(closes[i - 19:i + 1], ddof=0)
        features['bb_upper'] = sma20 + 2 * bb_std
        features['bb_middle'] = sma20
        features['bb_lower'] = sma20 - 2 * bb_std
        bb_range = features['bb_upper'] - features['bb_lower']
        features['bb_width'] = np.where(
            sma20 != 0, bb_range / sma20, np.nan
        )
        features['bb_pctb'] = np.where(
            bb_range != 0,
            (closes - features['bb_lower']) / np.where(bb_range != 0, bb_range, 1.0),
            np.nan,
        )

        # --- ATR ---
        features['atr_14'] = cls._atr(highs, lows, closes, 14)

        # --- Volume features ---
        features['volume_sma_20'] = cls._sma(volumes.astype(np.float64), 20)
        vol_sma = features['volume_sma_20']
        features['volume_ratio'] = np.where(
            (vol_sma != 0) & ~np.isnan(vol_sma),
            volumes.astype(np.float64) / np.where(vol_sma != 0, vol_sma, 1.0),
            np.nan,
        )

        # --- Price relative to SMAs ---
        features['price_to_sma20'] = np.where(
            (sma20 != 0) & ~np.isnan(sma20), closes / sma20 - 1.0, np.nan
        )
        sma50 = features['sma_50']
        features['price_to_sma50'] = np.where(
            (sma50 != 0) & ~np.isnan(sma50), closes / sma50 - 1.0, np.nan
        )

        # --- Range features ---
        features['high_low_range'] = np.where(
            closes != 0, (highs - lows) / np.where(closes != 0, closes, 1.0), 0.0
        )
        features['close_open_range'] = np.where(
            closes != 0, (closes - opens) / np.where(closes != 0, closes, 1.0), 0.0
        )

        # --- Build matrix in consistent order ---
        matrix = np.column_stack([features[name] for name in cls.FEATURE_NAMES])
        return matrix  # shape: (n, 29)


# ═══════════════════════════════════════════════════════════════════════════════
# LSTM MODEL
# ═══════════════════════════════════════════════════════════════════════════════

if TORCH_AVAILABLE:

    class LSTMPricePredictor(nn.Module):
        """
        LSTM neural network for stock price prediction.

        Architecture:
            Input -> LSTM layers (with dropout) -> FC -> Output
        """

        def __init__(
            self,
            input_size: int,
            hidden_size: int = 128,
            num_layers: int = 2,
            dropout: float = 0.2,
            output_size: int = 1,
        ):
            super().__init__()
            self.hidden_size = hidden_size
            self.num_layers = num_layers

            self.lstm = nn.LSTM(
                input_size=input_size,
                hidden_size=hidden_size,
                num_layers=num_layers,
                dropout=dropout if num_layers > 1 else 0.0,
                batch_first=True,
            )
            self.dropout = nn.Dropout(dropout)
            self.fc1 = nn.Linear(hidden_size, hidden_size // 2)
            self.relu = nn.ReLU()
            self.fc2 = nn.Linear(hidden_size // 2, output_size)

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            """
            Forward pass.

            Args:
                x: Tensor of shape (batch, seq_len, input_size)
            Returns:
                Tensor of shape (batch, output_size)
            """
            # LSTM output: (batch, seq_len, hidden_size)
            lstm_out, _ = self.lstm(x)
            # Take only the last time-step output
            last_hidden = lstm_out[:, -1, :]
            out = self.dropout(last_hidden)
            out = self.relu(self.fc1(out))
            out = self.dropout(out)
            out = self.fc2(out)
            return out


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN PREDICTION ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

class MLPredictionEngine:
    """
    Machine Learning engine for stock price prediction.

    Uses LSTM with Monte Carlo dropout for uncertainty estimation.
    Supports multiple prediction horizons with walk-forward validation.
    """

    # Default configuration
    DEFAULT_LOOKBACK = 60       # Sequence length (trading days)
    DEFAULT_HIDDEN_SIZE = 128
    DEFAULT_NUM_LAYERS = 2
    DEFAULT_DROPOUT = 0.2
    DEFAULT_EPOCHS = 50
    DEFAULT_BATCH_SIZE = 32
    DEFAULT_LEARNING_RATE = 0.001
    DEFAULT_MC_SAMPLES = 30     # Monte Carlo forward passes
    DEFAULT_HISTORY_DAYS = 750  # Fetch at least 3 years of data

    def __init__(self, api_key: Optional[str] = None):
        if not TORCH_AVAILABLE:
            raise RuntimeError("PyTorch is required for MLPredictionEngine")
        if not SKLEARN_AVAILABLE:
            raise RuntimeError("scikit-learn is required for MLPredictionEngine")

        self.api_key = api_key or os.environ.get('FMP_API_KEY', '')
        self._session = requests.Session()
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self._model_cache: Dict[str, Tuple[Any, Any, float]] = {}  # ticker -> (model, scaler, timestamp)
        self._cache_ttl = 3600  # 1 hour model cache

        logger.info("MLPredictionEngine initialized (device=%s)", self.device)

    # ───────────────────────────────────────────────────────────────────
    # PUBLIC API
    # ───────────────────────────────────────────────────────────────────

    def predict(
        self,
        ticker: str,
        horizons: Optional[List[int]] = None,
        lookback: int = DEFAULT_LOOKBACK,
        epochs: int = DEFAULT_EPOCHS,
        batch_size: int = DEFAULT_BATCH_SIZE,
        mc_samples: int = DEFAULT_MC_SAMPLES,
    ) -> Dict[str, Any]:
        """
        Generate price predictions for the given ticker and horizons.

        Args:
            ticker: Stock symbol (e.g. "AAPL")
            horizons: List of forecast horizons in trading days (default [5,10,20,30])
            lookback: Number of past days used as input sequence
            epochs: Training epochs
            batch_size: Mini-batch size
            mc_samples: Number of Monte Carlo dropout forward passes

        Returns:
            Dict with predictions, metrics, featureImportance, trainingInfo, historicalPredictions
        """
        if horizons is None:
            horizons = [5, 10, 20, 30]

        start_time = time.time()
        logger.info("[MLPredict] Starting prediction for %s, horizons=%s", ticker, horizons)

        try:
            # 1. Fetch historical data
            raw_data = self._fetch_historical(ticker, days=self.DEFAULT_HISTORY_DAYS)
            if not raw_data or len(raw_data) < lookback + max(horizons) + 50:
                return self._error_result(
                    ticker, horizons,
                    f"Insufficient data: got {len(raw_data) if raw_data else 0} bars, "
                    f"need at least {lookback + max(horizons) + 50}"
                )

            # 2. Extract OHLCV arrays
            opens = np.array([d.get('open', d.get('close', 0)) for d in raw_data], dtype=np.float64)
            highs = np.array([d.get('high', d.get('close', 0)) for d in raw_data], dtype=np.float64)
            lows = np.array([d.get('low', d.get('close', 0)) for d in raw_data], dtype=np.float64)
            closes = np.array([d.get('close', 0) for d in raw_data], dtype=np.float64)
            volumes = np.array([d.get('volume', 0) for d in raw_data], dtype=np.float64)
            dates = [d.get('date', '') for d in raw_data]

            # 3. Compute technical features
            feature_matrix = TechnicalFeatureEngine.compute_features(opens, highs, lows, closes, volumes)

            # 4. Trim NaN warm-up rows (first ~50 rows have NaN from indicators)
            valid_mask = ~np.any(np.isnan(feature_matrix), axis=1)
            first_valid = np.argmax(valid_mask)
            feature_matrix = feature_matrix[first_valid:]
            closes_trimmed = closes[first_valid:]
            dates_trimmed = dates[first_valid:]

            if len(feature_matrix) < lookback + max(horizons) + 50:
                return self._error_result(
                    ticker, horizons,
                    f"Insufficient valid data after indicator warm-up: {len(feature_matrix)} rows"
                )

            # 5. Scale features
            feature_scaler = MinMaxScaler(feature_range=(0, 1))
            scaled_features = feature_scaler.fit_transform(feature_matrix)

            target_scaler = MinMaxScaler(feature_range=(0, 1))
            scaled_targets = target_scaler.fit_transform(closes_trimmed.reshape(-1, 1)).flatten()

            # 6. Prepare sequences for each horizon and generate predictions
            all_predictions = []
            all_metrics_list = []
            training_info = {}
            historical_preds = []
            feature_importance_agg: Dict[str, List[float]] = {
                name: [] for name in TechnicalFeatureEngine.FEATURE_NAMES
            }

            for horizon in horizons:
                logger.info("[MLPredict] Processing horizon=%d days", horizon)

                # Build sequences: X[i] = features[i:i+lookback], y[i] = close[i+lookback+horizon-1]
                X, y, seq_dates = self._prepare_sequences(
                    scaled_features, scaled_targets, dates_trimmed, lookback, horizon
                )
                if len(X) < 50:
                    logger.warning("[MLPredict] Skipping horizon %d: only %d sequences", horizon, len(X))
                    continue

                # Walk-forward split: use last 20% as test
                split_idx = int(len(X) * 0.8)
                X_train, y_train = X[:split_idx], y[:split_idx]
                X_test, y_test = X[split_idx:], y[split_idx:]
                test_dates = seq_dates[split_idx:]

                # Train model
                model, train_loss, val_loss = self._train_model(
                    X_train, y_train, X_test, y_test,
                    input_size=feature_matrix.shape[1],
                    epochs=epochs,
                    batch_size=batch_size,
                )

                if horizon == horizons[0]:
                    training_info = {
                        'epochs': epochs,
                        'trainLoss': round(float(train_loss), 6),
                        'valLoss': round(float(val_loss), 6),
                        'dataPoints': len(X),
                        'trainSize': len(X_train),
                        'testSize': len(X_test),
                        'features': len(TechnicalFeatureEngine.FEATURE_NAMES),
                        'lookback': lookback,
                        'device': str(self.device),
                    }

                # Evaluate on test set
                test_preds_scaled, test_std_scaled = self._monte_carlo_predict(model, X_test, mc_samples)
                test_preds = target_scaler.inverse_transform(test_preds_scaled.reshape(-1, 1)).flatten()
                test_actuals = target_scaler.inverse_transform(y_test.reshape(-1, 1)).flatten()
                metrics = self._evaluate(test_preds, test_actuals)

                # Historical predictions (last 30 from test set) for the shortest horizon
                if horizon == horizons[0]:
                    n_hist = min(30, len(test_preds))
                    for i in range(len(test_preds) - n_hist, len(test_preds)):
                        historical_preds.append({
                            'date': test_dates[i] if i < len(test_dates) else '',
                            'actual': round(float(test_actuals[i]), 2),
                            'predicted': round(float(test_preds[i]), 2),
                        })

                # Future prediction: use the most recent lookback window
                last_seq = scaled_features[-lookback:]
                last_seq_tensor = torch.FloatTensor(last_seq).unsqueeze(0).to(self.device)

                future_pred_scaled, future_std_scaled = self._monte_carlo_predict(
                    model, last_seq_tensor.cpu().numpy(), mc_samples
                )
                future_price = target_scaler.inverse_transform(
                    future_pred_scaled.reshape(-1, 1)
                ).flatten()[0]
                future_std = float(future_std_scaled[0]) * (
                    target_scaler.data_max_[0] - target_scaler.data_min_[0]
                )

                # Confidence bands (approx 90% interval via 1.645 * std)
                upper_band = future_price + 1.645 * future_std
                lower_band = future_price - 1.645 * future_std
                confidence = max(0.0, min(1.0, 1.0 - (future_std / max(future_price, 1.0))))

                current_price = float(closes_trimmed[-1])
                predicted_change_pct = ((future_price - current_price) / current_price) * 100

                all_predictions.append({
                    'horizon': horizon,
                    'predictedPrice': round(float(future_price), 2),
                    'upperBand': round(float(upper_band), 2),
                    'lowerBand': round(float(max(lower_band, 0)), 2),
                    'confidence': round(float(confidence), 4),
                    'predictedChangePct': round(float(predicted_change_pct), 2),
                })

                all_metrics_list.append(metrics)

                # Feature importance via permutation (on test set, for first horizon)
                if horizon == horizons[0]:
                    fi = self._permutation_importance(model, X_test, y_test, target_scaler, mc_samples)
                    for idx, name in enumerate(TechnicalFeatureEngine.FEATURE_NAMES):
                        if idx < len(fi):
                            feature_importance_agg[name].append(fi[idx])

            # Aggregate metrics across horizons
            if all_metrics_list:
                avg_metrics = {}
                for key in all_metrics_list[0]:
                    vals = [m[key] for m in all_metrics_list if key in m]
                    avg_metrics[key] = round(float(np.mean(vals)), 4)
            else:
                avg_metrics = {'mae': 0, 'rmse': 0, 'mape': 0, 'directionalAccuracy': 0}

            # Aggregate feature importance
            feature_importance = {}
            for name, vals in feature_importance_agg.items():
                if vals:
                    feature_importance[name] = round(float(np.mean(vals)), 4)

            # Sort feature importance descending
            feature_importance = dict(
                sorted(feature_importance.items(), key=lambda x: x[1], reverse=True)
            )

            elapsed = time.time() - start_time
            logger.info("[MLPredict] Completed for %s in %.1fs", ticker, elapsed)

            return {
                'ticker': ticker,
                'currentPrice': round(float(closes_trimmed[-1]), 2),
                'lastDate': dates_trimmed[-1] if dates_trimmed else '',
                'predictions': all_predictions,
                'metrics': avg_metrics,
                'featureImportance': feature_importance,
                'trainingInfo': training_info,
                'historicalPredictions': historical_preds,
                'modelType': 'LSTM',
                'elapsedSeconds': round(elapsed, 2),
                'error': None,
            }

        except Exception as e:
            logger.error("[MLPredict] Error for %s: %s", ticker, e, exc_info=True)
            return self._error_result(ticker, horizons, str(e))

    # ───────────────────────────────────────────────────────────────────
    # DATA FETCHING
    # ───────────────────────────────────────────────────────────────────

    def _fetch_historical(self, ticker: str, days: int = 750) -> List[Dict]:
        """
        Fetch daily OHLCV data from FMP API.
        Returns list of dicts sorted oldest-first.
        """
        if not self.api_key:
            raise ValueError("FMP_API_KEY is required for fetching historical data")

        url = (
            f"https://financialmodelingprep.com/stable/historical-price-eod/full"
            f"?symbol={ticker}&apikey={self.api_key}"
        )

        for attempt in range(1, 4):
            try:
                logger.info("[MLPredict] Fetching historical data for %s (attempt %d)...", ticker, attempt)
                resp = self._session.get(url, timeout=20)
                resp.raise_for_status()
                raw = resp.json()
                historical = raw.get('historical', [])

                if not historical:
                    logger.warning("[MLPredict] No historical data for %s", ticker)
                    return []

                # Validate
                sample = historical[0]
                for key in ('close', 'high', 'low', 'open', 'volume'):
                    if key not in sample:
                        logger.error("[MLPredict] Missing key '%s' in data for %s", key, ticker)
                        return []

                # FMP returns newest first - reverse to oldest first
                historical = list(reversed(historical))

                # Trim to requested days
                if len(historical) > days:
                    historical = historical[-days:]

                logger.info("[MLPredict] Got %d bars for %s", len(historical), ticker)
                return historical

            except requests.exceptions.Timeout:
                logger.warning("[MLPredict] Timeout fetching %s (attempt %d)", ticker, attempt)
            except requests.exceptions.RequestException as e:
                logger.warning("[MLPredict] Request error for %s (attempt %d): %s", ticker, attempt, e)
            except Exception as e:
                logger.error("[MLPredict] Unexpected error fetching %s: %s", ticker, e)
                break

            time.sleep(1.0 * attempt)

        return []

    # ───────────────────────────────────────────────────────────────────
    # SEQUENCE PREPARATION
    # ───────────────────────────────────────────────────────────────────

    def _prepare_sequences(
        self,
        features: np.ndarray,
        targets: np.ndarray,
        dates: List[str],
        lookback: int,
        horizon: int,
    ) -> Tuple[np.ndarray, np.ndarray, List[str]]:
        """
        Build supervised learning sequences.

        For each index i:
            X[i] = features[i : i + lookback]          (shape: lookback x n_features)
            y[i] = targets[i + lookback + horizon - 1]  (scalar: future close price)

        Returns (X, y, dates_for_y)
        """
        X_list, y_list, d_list = [], [], []
        max_idx = len(features) - lookback - horizon

        for i in range(max_idx):
            X_list.append(features[i: i + lookback])
            target_idx = i + lookback + horizon - 1
            y_list.append(targets[target_idx])
            if target_idx < len(dates):
                d_list.append(dates[target_idx])
            else:
                d_list.append('')

        return np.array(X_list), np.array(y_list), d_list

    # ───────────────────────────────────────────────────────────────────
    # MODEL TRAINING
    # ───────────────────────────────────────────────────────────────────

    def _train_model(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        X_val: np.ndarray,
        y_val: np.ndarray,
        input_size: int,
        epochs: int = 50,
        batch_size: int = 32,
    ) -> Tuple[Any, float, float]:
        """
        Train LSTM model with early stopping.

        Returns (model, final_train_loss, final_val_loss)
        """
        model = LSTMPricePredictor(
            input_size=input_size,
            hidden_size=self.DEFAULT_HIDDEN_SIZE,
            num_layers=self.DEFAULT_NUM_LAYERS,
            dropout=self.DEFAULT_DROPOUT,
        ).to(self.device)

        optimizer = torch.optim.Adam(model.parameters(), lr=self.DEFAULT_LEARNING_RATE)
        scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
            optimizer, mode='min', factor=0.5, patience=5, min_lr=1e-6
        )
        criterion = nn.MSELoss()

        # Convert to tensors
        X_train_t = torch.FloatTensor(X_train).to(self.device)
        y_train_t = torch.FloatTensor(y_train).unsqueeze(1).to(self.device)
        X_val_t = torch.FloatTensor(X_val).to(self.device)
        y_val_t = torch.FloatTensor(y_val).unsqueeze(1).to(self.device)

        train_dataset = TensorDataset(X_train_t, y_train_t)
        train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)

        best_val_loss = float('inf')
        patience_counter = 0
        patience_limit = 10
        best_state = None
        final_train_loss = 0.0
        final_val_loss = 0.0

        for epoch in range(epochs):
            # --- Training ---
            model.train()
            epoch_loss = 0.0
            n_batches = 0

            for batch_X, batch_y in train_loader:
                optimizer.zero_grad()
                preds = model(batch_X)
                loss = criterion(preds, batch_y)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
                optimizer.step()
                epoch_loss += loss.item()
                n_batches += 1

            avg_train_loss = epoch_loss / max(n_batches, 1)

            # --- Validation ---
            model.eval()
            with torch.no_grad():
                val_preds = model(X_val_t)
                val_loss = criterion(val_preds, y_val_t).item()

            scheduler.step(val_loss)

            if val_loss < best_val_loss:
                best_val_loss = val_loss
                patience_counter = 0
                best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            else:
                patience_counter += 1

            final_train_loss = avg_train_loss
            final_val_loss = val_loss

            if (epoch + 1) % 10 == 0:
                logger.info(
                    "[MLPredict] Epoch %d/%d - train_loss=%.6f, val_loss=%.6f, lr=%.6f",
                    epoch + 1, epochs, avg_train_loss, val_loss,
                    optimizer.param_groups[0]['lr'],
                )

            if patience_counter >= patience_limit:
                logger.info("[MLPredict] Early stopping at epoch %d", epoch + 1)
                break

        # Restore best weights
        if best_state is not None:
            model.load_state_dict(best_state)
            model.to(self.device)

        return model, final_train_loss, best_val_loss

    # ───────────────────────────────────────────────────────────────────
    # MONTE CARLO DROPOUT INFERENCE
    # ───────────────────────────────────────────────────────────────────

    def _monte_carlo_predict(
        self,
        model: Any,
        X: np.ndarray,
        n_samples: int = 30,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Perform Monte Carlo dropout for uncertainty estimation.

        Runs `n_samples` forward passes with dropout enabled,
        then computes mean and std of predictions.

        Args:
            model: Trained LSTMPricePredictor
            X: Input array of shape (n, lookback, features) or numpy array
            n_samples: Number of stochastic forward passes

        Returns:
            (mean_predictions, std_predictions) each of shape (n,)
        """
        X_tensor = torch.FloatTensor(X).to(self.device)

        # Enable dropout during inference for MC estimation
        model.train()  # Keep dropout active

        all_preds = []
        with torch.no_grad():
            for _ in range(n_samples):
                preds = model(X_tensor).cpu().numpy().flatten()
                all_preds.append(preds)

        all_preds = np.array(all_preds)  # shape: (n_samples, n)
        mean_preds = np.mean(all_preds, axis=0)
        std_preds = np.std(all_preds, axis=0)

        return mean_preds, std_preds

    # ───────────────────────────────────────────────────────────────────
    # EVALUATION
    # ───────────────────────────────────────────────────────────────────

    def _evaluate(self, predictions: np.ndarray, actuals: np.ndarray) -> Dict[str, float]:
        """
        Calculate evaluation metrics.

        Returns dict with mae, rmse, mape, directionalAccuracy.
        """
        n = len(predictions)
        if n == 0:
            return {'mae': 0, 'rmse': 0, 'mape': 0, 'directionalAccuracy': 0}

        errors = predictions - actuals
        abs_errors = np.abs(errors)

        mae = float(np.mean(abs_errors))
        rmse = float(np.sqrt(np.mean(errors ** 2)))

        # MAPE - avoid division by zero
        safe_actuals = np.where(actuals != 0, actuals, 1.0)
        mape = float(np.mean(np.abs(errors / safe_actuals)) * 100)

        # Directional accuracy: did we predict the right direction of change?
        if n > 1:
            actual_dir = np.sign(np.diff(actuals))
            pred_dir = np.sign(np.diff(predictions))
            dir_acc = float(np.mean(actual_dir == pred_dir) * 100)
        else:
            dir_acc = 0.0

        return {
            'mae': round(mae, 4),
            'rmse': round(rmse, 4),
            'mape': round(mape, 4),
            'directionalAccuracy': round(dir_acc, 2),
        }

    # ───────────────────────────────────────────────────────────────────
    # FEATURE IMPORTANCE (Permutation-based)
    # ───────────────────────────────────────────────────────────────────

    def _permutation_importance(
        self,
        model: Any,
        X_test: np.ndarray,
        y_test: np.ndarray,
        target_scaler: Any,
        mc_samples: int = 10,
    ) -> np.ndarray:
        """
        Estimate feature importance via permutation shuffling.

        For each feature, shuffle its column across all sequences and
        measure the increase in prediction error (MAE).

        Returns array of importance scores (higher = more important), shape (n_features,).
        """
        # Baseline MAE
        base_preds, _ = self._monte_carlo_predict(model, X_test, mc_samples)
        base_preds_inv = target_scaler.inverse_transform(base_preds.reshape(-1, 1)).flatten()
        y_inv = target_scaler.inverse_transform(y_test.reshape(-1, 1)).flatten()
        base_mae = float(np.mean(np.abs(base_preds_inv - y_inv)))

        n_features = X_test.shape[2]
        importances = np.zeros(n_features)

        for f_idx in range(n_features):
            X_shuffled = X_test.copy()
            # Shuffle this feature across all samples (permute across sample axis)
            perm = np.random.permutation(X_shuffled.shape[0])
            X_shuffled[:, :, f_idx] = X_shuffled[perm, :, f_idx]

            shuf_preds, _ = self._monte_carlo_predict(model, X_shuffled, max(mc_samples // 3, 3))
            shuf_preds_inv = target_scaler.inverse_transform(shuf_preds.reshape(-1, 1)).flatten()
            shuf_mae = float(np.mean(np.abs(shuf_preds_inv - y_inv)))

            # Importance = increase in error when feature is shuffled
            importances[f_idx] = max(0.0, shuf_mae - base_mae)

        # Normalize to sum to 1
        total = importances.sum()
        if total > 0:
            importances = importances / total

        return importances

    # ───────────────────────────────────────────────────────────────────
    # HELPERS
    # ───────────────────────────────────────────────────────────────────

    @staticmethod
    def _error_result(ticker: str, horizons: List[int], message: str) -> Dict[str, Any]:
        """Return a structured error result."""
        return {
            'ticker': ticker,
            'currentPrice': None,
            'lastDate': None,
            'predictions': [],
            'metrics': {'mae': 0, 'rmse': 0, 'mape': 0, 'directionalAccuracy': 0},
            'featureImportance': {},
            'trainingInfo': {},
            'historicalPredictions': [],
            'modelType': 'LSTM',
            'elapsedSeconds': 0,
            'error': message,
        }


# ═══════════════════════════════════════════════════════════════════════════════
# MODULE-LEVEL CONVENIENCE FUNCTION
# ═══════════════════════════════════════════════════════════════════════════════

def predict_price(
    ticker: str,
    horizons: Optional[List[int]] = None,
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Convenience function for ML price prediction.

    Args:
        ticker: Stock symbol
        horizons: Prediction horizons in trading days (default [5, 10, 20, 30])
        api_key: FMP API key (falls back to FMP_API_KEY env var)

    Returns:
        Prediction result dict
    """
    if not TORCH_AVAILABLE or not SKLEARN_AVAILABLE:
        return {
            'ticker': ticker,
            'error': 'ML dependencies not available (PyTorch and/or scikit-learn not installed)',
            'predictions': [],
            'metrics': {},
            'featureImportance': {},
            'trainingInfo': {},
            'historicalPredictions': [],
        }

    engine = MLPredictionEngine(api_key=api_key)
    return engine.predict(ticker, horizons or [5, 10, 20, 30])
