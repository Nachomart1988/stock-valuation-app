'use client';

import { useState, useEffect, useCallback } from 'react';
import { PLAN_METADATA, type PlanTier } from '@/lib/plans';

interface UserRow {
  id: string;
  email: string;
  name: string;
  plan: PlanTier;
  createdAt: string;
  imageUrl: string;
}

const PLAN_COLORS: Record<PlanTier, string> = {
  free:  'bg-gray-700 text-gray-300',
  pro:   'bg-emerald-800 text-emerald-300',
  elite: 'bg-violet-800 text-violet-300',
  gold:  'bg-yellow-800 text-yellow-300',
};

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState('');

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchEmail, setSearchEmail] = useState('');

  const [updating, setUpdating] = useState<string | null>(null); // userId being updated
  const [updateMsg, setUpdateMsg] = useState('');

  const fetchUsers = useCallback(async (email = '') => {
    setLoading(true);
    setUpdateMsg('');
    try {
      const url = email ? `/api/admin/users?email=${encodeURIComponent(email)}` : '/api/admin/users';
      const res = await fetch(url, { headers: { 'x-admin-key': adminKey } });
      if (res.status === 401) { setAuthenticated(false); return; }
      const data = await res.json();
      setUsers(data.users ?? []);
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    const res = await fetch('/api/admin/users', { headers: { 'x-admin-key': adminKey } });
    if (res.ok) {
      setAuthenticated(true);
      const data = await res.json();
      setUsers(data.users ?? []);
    } else {
      setAuthError('Clave incorrecta');
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchUsers(searchEmail.trim());
  };

  const handlePlanChange = async (userId: string, email: string, newPlan: PlanTier) => {
    setUpdating(userId);
    setUpdateMsg('');
    try {
      const res = await fetch('/api/admin/set-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ email, plan: newPlan }),
      });
      const data = await res.json();
      if (data.success) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, plan: newPlan } : u));
        setUpdateMsg(`✓ Plan de ${email} actualizado a ${newPlan}`);
      } else {
        setUpdateMsg(`✗ Error: ${data.error}`);
      }
    } finally {
      setUpdating(null);
    }
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-2xl p-8">
          <h1 className="text-2xl font-bold text-white mb-2">Admin Panel</h1>
          <p className="text-gray-400 text-sm mb-6">Ingresa la clave de administrador</p>
          <form onSubmit={handleAuth} className="space-y-4">
            {authError && (
              <p className="text-red-400 text-sm">{authError}</p>
            )}
            <input
              type="password"
              value={adminKey}
              onChange={e => setAdminKey(e.target.value)}
              placeholder="Admin key"
              required
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              type="submit"
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition"
            >
              Entrar
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 px-4 py-10">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-extrabold text-emerald-400">Admin Panel</h1>
            <p className="text-gray-400 text-sm mt-1">Gestión de usuarios y planes</p>
          </div>
          <button
            onClick={() => setAuthenticated(false)}
            className="text-sm text-gray-500 hover:text-gray-300 transition"
          >
            Cerrar sesión admin
          </button>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex gap-3 mb-6">
          <input
            type="email"
            value={searchEmail}
            onChange={e => setSearchEmail(e.target.value)}
            placeholder="Buscar por email..."
            className="flex-1 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="submit"
            className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-600 rounded-xl font-semibold transition"
          >
            Buscar
          </button>
          {searchEmail && (
            <button
              type="button"
              onClick={() => { setSearchEmail(''); fetchUsers(); }}
              className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-xl transition"
            >
              Limpiar
            </button>
          )}
        </form>

        {/* Status message */}
        {updateMsg && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm ${updateMsg.startsWith('✓') ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700' : 'bg-red-900/40 text-red-300 border border-red-700'}`}>
            {updateMsg}
          </div>
        )}

        {/* Users table */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-16 text-gray-500">No se encontraron usuarios</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
                  <th className="px-5 py-4 text-left">Usuario</th>
                  <th className="px-5 py-4 text-left">Email</th>
                  <th className="px-5 py-4 text-left">Registro</th>
                  <th className="px-5 py-4 text-left">Plan actual</th>
                  <th className="px-5 py-4 text-left">Cambiar plan</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <tr
                    key={u.id}
                    className={`border-b border-gray-800/60 hover:bg-gray-800/30 transition ${i % 2 === 0 ? '' : 'bg-gray-800/10'}`}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        {u.imageUrl ? (
                          <img src={u.imageUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-gray-400 text-xs font-bold">
                            {u.name.charAt(0) || '?'}
                          </div>
                        )}
                        <span className="text-white font-medium">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-gray-300">{u.email}</td>
                    <td className="px-5 py-3 text-gray-400">{u.createdAt}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${PLAN_COLORS[u.plan] ?? PLAN_COLORS.free}`}>
                        {PLAN_METADATA[u.plan]?.name ?? u.plan}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          defaultValue={u.plan}
                          disabled={updating === u.id}
                          onChange={e => handlePlanChange(u.id, u.email, e.target.value as PlanTier)}
                          className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                        >
                          <option value="free">Free</option>
                          <option value="pro">Pro</option>
                          <option value="elite">Elite</option>
                          <option value="gold">Gold</option>
                        </select>
                        {updating === u.id && (
                          <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">
          Mostrando {users.length} usuario(s) · Panel restringido
        </p>
      </div>
    </div>
  );
}
