// src/app/components/tabs/MLPredictionTab.tsx
'use client';

import { useState, useCallback } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';

interface MLPredictionTabProps {
  ticker: string;
  currentPrice: number;
}

interface Prediction {
  horizon: number;
  predictedPrice: number;
  upperBand: number;
  lowerBand: number;
  confidence: number;
  changePercent: number;
}

interface PredictionResult {
  predictions: Prediction[];
  metrics: {
    mae: number;
    rmse: number;
    mape: number;
    directionalAccuracy: number;
  };
  featureImportance: Record<string, number>;
  trainingInfo: {
    epochs: number;
    trainLoss: number;
    valLoss: number;
    dataPoints: number;
    modelType: string;
  };
  historicalPredictions: { date: string; actual: number; predicted: number }[];
}

export default function MLPredictionTab({ ticker, currentPrice }: MLPredictionTabProps) {
  const { locale } = useLanguage();
  const es = locale === 'es';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PredictionResult | null>(null);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  const runPrediction = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${backendUrl}/ml/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, horizons: [5, 10, 20, 30] }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (res.status === 503) throw new Error(es ? 'PyTorch no está instalado en el servidor. Contacta al administrador.' : 'PyTorch is not installed on the server. Contact administrator.');
        if (res.status === 500) throw new Error(es ? `Error del servidor: ${body.slice(0, 200)}` : `Server error: ${body.slice(0, 200)}`);
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        setError(es ? `No se pudo conectar al backend (${backendUrl}).` : `Cannot connect to backend (${backendUrl}).`);
      } else {
        setError(msg || 'Error running prediction');
      }
    } finally {
      setLoading(false);
    }
  }, [ticker, backendUrl]);

  const fmtPrice = (v: number) => `$${v.toFixed(2)}`;
  const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-cyan-400">
            {es ? 'Predicción ML (LSTM)' : 'ML Prediction (LSTM)'}
          </h3>
          <p className="text-sm text-gray-400 mt-1">
            {es
              ? 'Red neuronal LSTM entrenada en datos históricos con indicadores técnicos'
              : 'LSTM neural network trained on historical data with technical indicators'}
          </p>
        </div>
        <button
          onClick={runPrediction}
          disabled={loading}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold rounded-xl transition-all disabled:opacity-50"
        >
          {loading ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          )}
          {loading
            ? (es ? 'Entrenando modelo...' : 'Training model...')
            : (es ? 'Ejecutar Predicción' : 'Run Prediction')}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-900/30 border border-red-500/50 rounded-xl text-red-300">
          {error}
        </div>
      )}

      {!result && !loading && !error && (
        <div className="text-center py-16 text-gray-500">
          <svg className="w-16 h-16 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <p className="text-lg">{es ? 'Presiona "Ejecutar Predicción" para comenzar' : 'Press "Run Prediction" to start'}</p>
          <p className="text-sm mt-2">{es ? 'El modelo LSTM se entrena en ~500 días de datos históricos' : 'LSTM model trains on ~500 days of historical data'}</p>
        </div>
      )}

      {result && (
        <>
          {/* Predictions Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {result.predictions.map((pred) => {
              const isUp = pred.changePercent >= 0;
              return (
                <div key={pred.horizon} className="bg-gray-700/50 rounded-xl p-4 border border-gray-600/50">
                  <div className="text-sm text-gray-400 mb-1">
                    {pred.horizon} {es ? 'días' : 'days'}
                  </div>
                  <div className={`text-2xl font-bold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                    {fmtPrice(pred.predictedPrice)}
                  </div>
                  <div className={`text-sm ${isUp ? 'text-green-500' : 'text-red-500'}`}>
                    {fmtPct(pred.changePercent)}
                  </div>
                  <div className="mt-2 text-xs text-gray-500">
                    {fmtPrice(pred.lowerBand)} — {fmtPrice(pred.upperBand)}
                  </div>
                  <div className="mt-1">
                    <div className="h-1.5 bg-gray-600 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${isUp ? 'bg-green-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(100, pred.confidence)}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {es ? 'Confianza' : 'Confidence'}: {pred.confidence.toFixed(0)}%
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gray-700/30 rounded-lg p-3">
              <div className="text-xs text-gray-500 uppercase">MAE</div>
              <div className="text-lg font-semibold text-gray-200">${result.metrics.mae.toFixed(2)}</div>
            </div>
            <div className="bg-gray-700/30 rounded-lg p-3">
              <div className="text-xs text-gray-500 uppercase">RMSE</div>
              <div className="text-lg font-semibold text-gray-200">${result.metrics.rmse.toFixed(2)}</div>
            </div>
            <div className="bg-gray-700/30 rounded-lg p-3">
              <div className="text-xs text-gray-500 uppercase">MAPE</div>
              <div className="text-lg font-semibold text-gray-200">{result.metrics.mape.toFixed(2)}%</div>
            </div>
            <div className="bg-gray-700/30 rounded-lg p-3">
              <div className="text-xs text-gray-500 uppercase">{es ? 'Precisión Direc.' : 'Dir. Accuracy'}</div>
              <div className="text-lg font-semibold text-cyan-400">{result.metrics.directionalAccuracy.toFixed(1)}%</div>
            </div>
          </div>

          {/* Feature Importance */}
          {result.featureImportance && Object.keys(result.featureImportance).length > 0 && (
            <div className="bg-gray-700/30 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-gray-300 mb-3">
                {es ? 'Importancia de Features' : 'Feature Importance'}
              </h4>
              <div className="space-y-2">
                {Object.entries(result.featureImportance)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 10)
                  .map(([feature, importance]) => (
                    <div key={feature} className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-28 truncate">{feature}</span>
                      <div className="flex-1 h-2 bg-gray-600 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-cyan-500 rounded-full"
                          style={{ width: `${Math.min(100, importance * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-400 w-12 text-right">
                        {(importance * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Historical Backtest */}
          {result.historicalPredictions && result.historicalPredictions.length > 0 && (
            <div className="bg-gray-700/30 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-gray-300 mb-3">
                {es ? 'Backtest (últimos 30 días)' : 'Backtest (last 30 days)'}
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs">
                      <th className="text-left py-1">{es ? 'Fecha' : 'Date'}</th>
                      <th className="text-right py-1">{es ? 'Real' : 'Actual'}</th>
                      <th className="text-right py-1">{es ? 'Predicho' : 'Predicted'}</th>
                      <th className="text-right py-1">{es ? 'Error' : 'Error'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.historicalPredictions.slice(-15).map((hp) => {
                      const err = ((hp.predicted - hp.actual) / hp.actual) * 100;
                      return (
                        <tr key={hp.date} className="border-t border-gray-700/50">
                          <td className="py-1 text-gray-400">{hp.date}</td>
                          <td className="py-1 text-right text-gray-300">{fmtPrice(hp.actual)}</td>
                          <td className="py-1 text-right text-cyan-400">{fmtPrice(hp.predicted)}</td>
                          <td className={`py-1 text-right ${Math.abs(err) < 2 ? 'text-green-400' : 'text-yellow-400'}`}>
                            {fmtPct(err)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Training Info */}
          <div className="text-xs text-gray-500 flex flex-wrap gap-4">
            <span>Model: {result.trainingInfo.modelType}</span>
            <span>Epochs: {result.trainingInfo.epochs}</span>
            <span>Train Loss: {result.trainingInfo.trainLoss.toFixed(6)}</span>
            <span>Val Loss: {result.trainingInfo.valLoss.toFixed(6)}</span>
            <span>Data Points: {result.trainingInfo.dataPoints}</span>
          </div>
        </>
      )}
    </div>
  );
}
