'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser, SignedIn, SignedOut } from '@clerk/nextjs';
import Header from '../components/Header';

export interface BlogPost {
  id: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  ticker: string;
  title: string;
  body: string;
  targetPrice: number | null;
  currentPrice: number | null;
  horizon: string; // e.g. "3M", "6M", "1Y"
  sentiment: 'bullish' | 'bearish' | 'neutral';
  upvotes: number;
  outcome: 'pending' | 'hit' | 'miss' | null;
}

interface UserScore {
  authorId: string;
  authorName: string;
  total: number;
  hits: number;
  winRate: number;
}

// ─── sample data shown when no real posts exist ────────────────────────
const SAMPLE_POSTS: BlogPost[] = [
  {
    id: 'sample-1',
    authorId: 'sample',
    authorName: 'Carlos M.',
    createdAt: '2026-02-10T14:30:00Z',
    ticker: 'NVDA',
    title: 'NVDA — Compresión Prismo pre-breakout',
    body: 'NVDA lleva 3 semanas con amplitud comprimida después del último earnings. El volumen está seco, techo diagonal en $875. Si rompe ese nivel con volumen, target $950 en 3 meses. El Prismo Score está en 87/100.',
    targetPrice: 950,
    currentPrice: 862,
    horizon: '3M',
    sentiment: 'bullish',
    upvotes: 34,
    outcome: 'pending',
  },
  {
    id: 'sample-2',
    authorId: 'sample',
    authorName: 'Ana R.',
    createdAt: '2026-02-05T10:15:00Z',
    ticker: 'AAPL',
    title: 'AAPL — Valuación Graham atractiva',
    body: 'Con AAPL en $185, el Graham Number da $210. P/E ajustado por crecimiento está a 1.4x PEG. Históricamente esta zona ha sido buen punto de entrada. Target $220 en 12 meses.',
    targetPrice: 220,
    currentPrice: 185,
    horizon: '1Y',
    sentiment: 'bullish',
    upvotes: 21,
    outcome: 'pending',
  },
  {
    id: 'sample-3',
    authorId: 'sample2',
    authorName: 'Diego P.',
    createdAt: '2025-11-20T09:00:00Z',
    ticker: 'META',
    title: 'META — DCF sugiere 20% upside',
    body: 'Con FCF yield al 4.2% y WACC del 10%, el DCF 3-Stage da un valor intrínseco de $650. Meta lleva 3 trimestres superando estimaciones de FCF. Target $650 en 6 meses.',
    targetPrice: 650,
    currentPrice: 548,
    horizon: '6M',
    sentiment: 'bullish',
    upvotes: 18,
    outcome: 'hit',
  },
];

// ─── Utilities ─────────────────────────────────────────────────────────
function getPosts(): BlogPost[] {
  if (typeof window === 'undefined') return SAMPLE_POSTS;
  try {
    const saved = localStorage.getItem('prismo_blog_posts');
    const userPosts: BlogPost[] = saved ? JSON.parse(saved) : [];
    return [...userPosts, ...SAMPLE_POSTS];
  } catch {
    return SAMPLE_POSTS;
  }
}

function savePost(post: BlogPost) {
  if (typeof window === 'undefined') return;
  try {
    const saved = localStorage.getItem('prismo_blog_posts');
    const posts: BlogPost[] = saved ? JSON.parse(saved) : [];
    posts.unshift(post);
    localStorage.setItem('prismo_blog_posts', JSON.stringify(posts));
  } catch {}
}

function calcLeaderboard(posts: BlogPost[]): UserScore[] {
  const scores: Record<string, UserScore> = {};
  posts.forEach((p) => {
    if (p.outcome === null) return;
    if (!scores[p.authorId]) {
      scores[p.authorId] = { authorId: p.authorId, authorName: p.authorName, total: 0, hits: 0, winRate: 0 };
    }
    scores[p.authorId].total++;
    if (p.outcome === 'hit') scores[p.authorId].hits++;
  });
  Object.values(scores).forEach((s) => {
    s.winRate = s.total > 0 ? Math.round((s.hits / s.total) * 100) : 0;
  });
  return Object.values(scores)
    .filter((s) => s.total >= 1)
    .sort((a, b) => b.winRate - a.winRate || b.hits - a.hits);
}

const sentimentColor = (s: string) =>
  s === 'bullish' ? 'text-emerald-400 bg-emerald-900/30 border-emerald-700/40'
    : s === 'bearish' ? 'text-red-400 bg-red-900/30 border-red-700/40'
    : 'text-gray-400 bg-black/60/40 border-green-900/20/40';

const outcomeColor = (o: string | null) =>
  o === 'hit' ? 'text-emerald-400 bg-emerald-900/20'
    : o === 'miss' ? 'text-red-400 bg-red-900/20'
    : 'text-gray-400 bg-black/60/30';

const outcomeLabel = (o: string | null) =>
  o === 'hit' ? '✓ Acertó' : o === 'miss' ? '✗ Falló' : '⏳ Pendiente';

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / 86400000);
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor(diff / 60000);
  if (days > 30) return `${Math.floor(days / 30)}mo ago`;
  if (days > 0) return `${days}d ago`;
  if (hrs > 0) return `${hrs}h ago`;
  return `${mins}m ago`;
}

// ─── New Post Form ──────────────────────────────────────────────────────
function NewPostForm({ onClose, onSaved }: { onClose: () => void; onSaved: (p: BlogPost) => void }) {
  const { user } = useUser();
  const [form, setForm] = useState({
    ticker: '',
    title: '',
    body: '',
    targetPrice: '',
    horizon: '3M',
    sentiment: 'bullish' as BlogPost['sentiment'],
  });
  const [submitting, setSubmitting] = useState(false);

  const handle = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    if (!form.ticker.trim() || !form.title.trim() || !form.body.trim()) return;
    setSubmitting(true);
    const post: BlogPost = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      authorId: user?.id ?? 'anonymous',
      authorName: user?.fullName ?? user?.username ?? 'Anónimo',
      createdAt: new Date().toISOString(),
      ticker: form.ticker.toUpperCase().trim(),
      title: form.title.trim(),
      body: form.body.trim(),
      targetPrice: form.targetPrice ? parseFloat(form.targetPrice) : null,
      currentPrice: null,
      horizon: form.horizon,
      sentiment: form.sentiment,
      upvotes: 0,
      outcome: null,
    };
    savePost(post);
    onSaved(post);
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-black/80 border border-green-900/20 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-green-900/20">
          <h2 className="text-xl font-bold">Publicar Análisis</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">×</button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Ticker *</label>
              <input
                className="w-full bg-black/60 border border-green-900/20 rounded-xl px-4 py-2.5 text-sm font-data uppercase focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="AAPL"
                value={form.ticker}
                onChange={(e) => handle('ticker', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Sentimiento</label>
              <select
                className="w-full bg-black/60 border border-green-900/20 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                value={form.sentiment}
                onChange={(e) => handle('sentiment', e.target.value)}
              >
                <option value="bullish">📈 Alcista</option>
                <option value="bearish">📉 Bajista</option>
                <option value="neutral">➖ Neutral</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Título *</label>
            <input
              className="w-full bg-black/60 border border-green-900/20 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="Ej: AAPL — DCF sugiere 20% upside"
              value={form.title}
              onChange={(e) => handle('title', e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Análisis *</label>
            <textarea
              rows={5}
              className="w-full bg-black/60 border border-green-900/20 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
              placeholder="Explica tu tesis. Qué modelo usaste, qué datos te llevaron a esta conclusión, qué riesgos ves..."
              value={form.body}
              onChange={(e) => handle('body', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Precio Objetivo ($)</label>
              <input
                type="number"
                className="w-full bg-black/60 border border-green-900/20 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="150.00"
                value={form.targetPrice}
                onChange={(e) => handle('targetPrice', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Horizonte</label>
              <select
                className="w-full bg-black/60 border border-green-900/20 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                value={form.horizon}
                onChange={(e) => handle('horizon', e.target.value)}
              >
                <option value="1M">1 mes</option>
                <option value="3M">3 meses</option>
                <option value="6M">6 meses</option>
                <option value="1Y">1 año</option>
                <option value="2Y">2 años</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 p-6 border-t border-green-900/20">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl bg-black/60 hover:bg-black/50 text-sm font-semibold transition">
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={submitting || !form.ticker || !form.title || !form.body}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-sm font-semibold transition disabled:opacity-50"
          >
            {submitting ? 'Publicando...' : 'Publicar Análisis'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Post Card ─────────────────────────────────────────────────────────
function PostCard({ post, onClick }: { post: BlogPost; onClick: () => void }) {
  const upside = post.targetPrice && post.currentPrice
    ? (((post.targetPrice - post.currentPrice) / post.currentPrice) * 100).toFixed(1)
    : null;

  return (
    <div
      onClick={onClick}
      className="p-5 rounded-2xl bg-black/40 border border-green-900/15 hover:border-emerald-500/40 transition cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-data font-bold text-white bg-black/50 px-2 py-0.5 rounded text-sm">{post.ticker}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${sentimentColor(post.sentiment)}`}>
            {post.sentiment === 'bullish' ? '📈 Alcista' : post.sentiment === 'bearish' ? '📉 Bajista' : '➖ Neutral'}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${outcomeColor(post.outcome)}`}>
            {outcomeLabel(post.outcome)}
          </span>
        </div>
        <span className="text-xs text-gray-500 flex-shrink-0">{timeAgo(post.createdAt)}</span>
      </div>

      <h3 className="font-bold text-white mb-2 line-clamp-2">{post.title}</h3>
      <p className="text-sm text-gray-400 line-clamp-3 mb-4">{post.body}</p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>Por <span className="text-gray-300 font-medium">{post.authorName}</span></span>
          {post.targetPrice && (
            <span>
              Target: <span className="text-white font-semibold">${post.targetPrice}</span>
              {upside && (
                <span className={parseFloat(upside) > 0 ? ' text-emerald-400' : ' text-red-400'}>
                  {' '}({upside}%)
                </span>
              )}
            </span>
          )}
          <span>Horizonte: {post.horizon}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <span>▲</span>
          <span>{post.upvotes}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Post Detail Modal ──────────────────────────────────────────────────
function PostModal({ post, onClose }: { post: BlogPost; onClose: () => void }) {
  const router = useRouter();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-black/80 border border-green-900/20 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-green-900/20">
          <div className="flex items-center gap-2">
            <span className="font-data font-bold text-white bg-black/50 px-2 py-0.5 rounded">{post.ticker}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${sentimentColor(post.sentiment)}`}>
              {post.sentiment === 'bullish' ? '📈 Alcista' : post.sentiment === 'bearish' ? '📉 Bajista' : '➖ Neutral'}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">×</button>
        </div>

        <div className="p-6">
          <h2 className="text-xl font-bold mb-2">{post.title}</h2>
          <div className="flex items-center gap-3 text-xs text-gray-500 mb-6">
            <span>Por <span className="text-gray-300 font-semibold">{post.authorName}</span></span>
            <span>·</span>
            <span>{new Date(post.createdAt).toLocaleDateString('es-ES')}</span>
            <span>·</span>
            <span className={`px-2 py-0.5 rounded-full font-semibold ${outcomeColor(post.outcome)}`}>
              {outcomeLabel(post.outcome)}
            </span>
          </div>

          <p className="text-gray-300 leading-relaxed whitespace-pre-wrap mb-6">{post.body}</p>

          {(post.targetPrice || post.horizon) && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 rounded-xl bg-black/40 border border-green-900/15 mb-6">
              {post.targetPrice && (
                <div>
                  <div className="text-xs text-gray-500">Precio Objetivo</div>
                  <div className="font-bold text-white">${post.targetPrice}</div>
                </div>
              )}
              {post.currentPrice && (
                <div>
                  <div className="text-xs text-gray-500">Precio al Publicar</div>
                  <div className="font-bold text-white">${post.currentPrice}</div>
                </div>
              )}
              <div>
                <div className="text-xs text-gray-500">Horizonte</div>
                <div className="font-bold text-white">{post.horizon}</div>
              </div>
            </div>
          )}

          <button
            onClick={() => { onClose(); router.push(`/analizar?ticker=${post.ticker}`); }}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 font-semibold transition text-sm"
          >
            Analizar {post.ticker} en Prismo →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────
export default function BlogPage() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [leaderboard, setLeaderboard] = useState<UserScore[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedPost, setSelectedPost] = useState<BlogPost | null>(null);
  const [filterSentiment, setFilterSentiment] = useState<string>('all');
  const [filterTicker, setFilterTicker] = useState('');

  useEffect(() => {
    const p = getPosts();
    setPosts(p);
    setLeaderboard(calcLeaderboard(p));
  }, []);

  const onSaved = (post: BlogPost) => {
    const updated = [post, ...posts];
    setPosts(updated);
    setLeaderboard(calcLeaderboard(updated));
    setShowForm(false);
  };

  const filtered = posts.filter((p) => {
    if (filterSentiment !== 'all' && p.sentiment !== filterSentiment) return false;
    if (filterTicker && !p.ticker.includes(filterTicker.toUpperCase())) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-gray-800 to-black text-white">
      <Header />

      {showForm && <NewPostForm onClose={() => setShowForm(false)} onSaved={onSaved} />}
      {selectedPost && <PostModal post={selectedPost} onClose={() => setSelectedPost(null)} />}

      <main className="pt-28 pb-20 px-4 max-w-6xl mx-auto">
        {/* Hero */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-10">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black mb-2">Blog de Inversores</h1>
            <p className="text-gray-400">Análisis de la comunidad. Cada predicción queda registrada.</p>
          </div>
          <SignedIn>
            <button
              onClick={() => setShowForm(true)}
              className="flex-shrink-0 px-5 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 font-semibold transition text-sm"
            >
              + Publicar Análisis
            </button>
          </SignedIn>
          <SignedOut>
            <Link
              href="/login"
              className="flex-shrink-0 px-5 py-3 rounded-xl bg-black/50 hover:bg-green-900/15 font-semibold transition text-sm text-center"
            >
              Inicia sesión para publicar
            </Link>
          </SignedOut>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Posts Column */}
          <div className="lg:col-span-2">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <input
                className="bg-black/60 border border-green-900/20 rounded-xl px-4 py-2 text-sm font-data uppercase focus:outline-none focus:ring-2 focus:ring-emerald-500 w-28"
                placeholder="Ticker"
                value={filterTicker}
                onChange={(e) => setFilterTicker(e.target.value)}
              />
              {['all', 'bullish', 'bearish', 'neutral'].map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterSentiment(s)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                    filterSentiment === s
                      ? 'bg-emerald-600 text-white'
                      : 'bg-black/60 text-gray-400 hover:text-white border border-green-900/20'
                  }`}
                >
                  {s === 'all' ? 'Todos' : s === 'bullish' ? '📈 Alcista' : s === 'bearish' ? '📉 Bajista' : '➖ Neutral'}
                </button>
              ))}
              <span className="text-xs text-gray-500 ml-auto">{filtered.length} análisis</span>
            </div>

            <div className="space-y-4">
              {filtered.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <div className="text-3xl mb-3">📭</div>
                  <div>No hay análisis que coincidan con los filtros</div>
                </div>
              ) : (
                filtered.map((post) => (
                  <PostCard key={post.id} post={post} onClick={() => setSelectedPost(post)} />
                ))
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* How it works */}
            <div className="p-5 rounded-2xl bg-black/40 border border-green-900/15">
              <h3 className="font-bold mb-3">Cómo funciona el Win-Rate</h3>
              <div className="space-y-3 text-sm text-gray-400">
                <p>1. Publica tu análisis con un precio objetivo y horizonte temporal.</p>
                <p>2. Cuando el horizonte vence, el sistema verifica si el precio alcanzó tu objetivo.</p>
                <p>3. Tu <strong className="text-white">Win-Rate</strong> refleja el % de predicciones correctas.</p>
                <p>4. Los analistas con mejor historial aparecen en el leaderboard.</p>
              </div>
            </div>

            {/* Leaderboard */}
            <div className="p-5 rounded-2xl bg-black/40 border border-green-900/15">
              <h3 className="font-bold mb-4">🏆 Top Analistas</h3>
              {leaderboard.length === 0 ? (
                <p className="text-sm text-gray-500">Todavía no hay predicciones resueltas. ¡Sé el primero!</p>
              ) : (
                <div className="space-y-3">
                  {leaderboard.slice(0, 5).map((user, i) => (
                    <div key={user.authorId} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-500 w-4">{i + 1}</span>
                        <div>
                          <div className="text-sm font-semibold text-white">{user.authorName}</div>
                          <div className="text-xs text-gray-500">{user.hits}/{user.total} correctas</div>
                        </div>
                      </div>
                      <div className={`text-sm font-bold ${user.winRate >= 60 ? 'text-emerald-400' : user.winRate >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {user.winRate}%
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Stats */}
            <div className="p-5 rounded-2xl bg-black/40 border border-green-900/15">
              <h3 className="font-bold mb-3">Estadísticas</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Total análisis</span>
                  <span className="font-bold">{posts.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Bullish</span>
                  <span className="font-bold text-emerald-400">{posts.filter(p => p.sentiment === 'bullish').length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Bearish</span>
                  <span className="font-bold text-red-400">{posts.filter(p => p.sentiment === 'bearish').length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Resoltos</span>
                  <span className="font-bold">{posts.filter(p => p.outcome !== null && p.outcome !== 'pending').length}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
