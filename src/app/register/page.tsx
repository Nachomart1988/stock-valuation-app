'use client';

import Link from 'next/link';
import Logo from '../components/Logo';

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-slate-900 to-black text-white flex flex-col">
      <header className="border-b border-green-900/20 bg-gray-900/80/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Logo size="md" />
          <Link href="/" className="text-gray-400 hover:text-white transition">← Inicio</Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="bg-gray-900/40 backdrop-blur border border-green-900/20 rounded-2xl p-5 sm:p-8 text-center">
            <div className="text-5xl mb-4">🔒</div>
            <h1 className="text-3xl font-bold mb-3">Registro cerrado</h1>
            <p className="text-gray-400 mb-6">
              El registro de nuevos usuarios está temporalmente cerrado.
              Si ya tienes una cuenta, puedes iniciar sesión normalmente.
            </p>
            <p className="text-gray-500 text-sm mb-8">
              Para solicitar acceso, contacta al administrador.
            </p>
            <Link
              href="/login"
              className="inline-block w-full py-3 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold rounded-xl transition"
            >
              Ir a Iniciar Sesión
            </Link>
          </div>

          <div className="mt-6 text-center">
            <Link href="/" className="text-gray-500 hover:text-gray-300 text-sm">
              &larr; Volver al inicio
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
