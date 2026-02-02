'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [ticker, setTicker] = useState('');
  const router = useRouter();

  const handleAnalizar = () => {
    if (ticker.trim() === '') {
      alert('Ingresa un ticker válido (ej: AAPL)');
      return;
    }
    router.push(`/analizar?ticker=${ticker.trim().toUpperCase()}`);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-gray-50">
      <div className="text-center max-w-3xl">
        <h1 className="text-5xl font-bold mb-6 text-blue-700">
          Analizador de Acciones
        </h1>
        <p className="text-xl text-gray-600 mb-10">
          Ingresa un ticker (ej: AAPL, MELI, GGAL) para ver valoración con DDM, FCF, Graham y más.
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <input
            type="text"
            placeholder="Ej: AAPL"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            className="px-6 py-4 border border-gray-400 rounded-lg text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-64 bg-white text-gray-900 placeholder-gray-500"
          />
          <button 
            onClick={handleAnalizar}
            className="px-8 py-4 bg-blue-600 text-white rounded-lg text-lg font-semibold hover:bg-blue-700 transition"
          >
            Analizar
          </button>
        </div>
      </div>
    </main>
  );
}