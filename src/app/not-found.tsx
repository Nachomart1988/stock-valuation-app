import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '404 - Pagina no encontrada | Prismo',
  description: 'La pagina que buscas no existe. Vuelve al inicio de Prismo.',
};

export default function NotFound() {
  return (
    <div className="min-h-screen bg-black/80 text-white flex flex-col items-center justify-center px-4">
      <h1 className="text-7xl font-black text-emerald-500 mb-4">404</h1>
      <p className="text-xl text-gray-300 mb-2">Pagina no encontrada</p>
      <p className="text-gray-500 mb-8 text-center max-w-sm">
        La pagina que buscas no existe o fue movida.
      </p>
      <Link
        href="/"
        className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl transition"
      >
        Volver al inicio
      </Link>
    </div>
  );
}
