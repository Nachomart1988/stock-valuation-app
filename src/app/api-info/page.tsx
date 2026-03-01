'use client';

import Header from '../components/Header';

export default function ApiInfoPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-gray-800 to-black text-white">
      <Header />

      <main className="pt-28 pb-20 px-4 max-w-4xl mx-auto">
        {/* Hero */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-500/10 border border-violet-500/20 mb-6">
            <span className="text-sm text-violet-400">Coming Soon</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-black mb-4">
            Prismo{' '}
            <span className="bg-gradient-to-r from-violet-400 to-purple-400 bg-clip-text text-transparent">
              API & Integrations
            </span>
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            We're building a REST API so you can integrate Prismo's valuation engine, quality scores, and neural analysis directly
            into your own tools, screeners, and workflows.
          </p>
        </div>

        {/* Planned Endpoints */}
        <h2 className="text-xl font-bold mb-6">Planned API Endpoints</h2>
        <div className="space-y-3 mb-12">
          {[
            { method: 'GET', path: '/v1/valuation/{ticker}', desc: 'Full 20+ model valuation suite for any US stock' },
            { method: 'GET', path: '/v1/quality/{ticker}', desc: '5-dimension company quality score' },
            { method: 'GET', path: '/v1/summary/{ticker}', desc: 'Neural 12-layer master summary and recommendation' },
            { method: 'GET', path: '/v1/momentum/{ticker}', desc: 'Prismo momentum score + breakout probability' },
            { method: 'GET', path: '/v1/screener', desc: 'Stock screener with 50+ filters' },
            { method: 'POST', path: '/v1/dcf/custom', desc: 'Custom DCF calculation with your inputs' },
          ].map((ep) => (
            <div key={ep.path} className="flex items-start gap-4 p-4 rounded-xl bg-black/40 border border-green-900/15">
              <span className="text-xs font-bold font-data px-2 py-1 rounded bg-emerald-900/40 text-emerald-400 border border-emerald-700/40 flex-shrink-0">
                {ep.method}
              </span>
              <div>
                <div className="font-data text-sm text-gray-200">{ep.path}</div>
                <div className="text-sm text-gray-400 mt-0.5">{ep.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Integrations */}
        <h2 className="text-xl font-bold mb-4">Planned Integrations</h2>
        <div className="grid sm:grid-cols-3 gap-4 mb-12">
          {[
            { name: 'Google Sheets', desc: 'Pull valuations directly into your spreadsheet via our add-on.' },
            { name: 'TradingView', desc: 'Display Prismo scores and valuation ranges as custom indicators.' },
            { name: 'Notion', desc: 'Embed analysis cards in your investment thesis workspace.' },
          ].map((i) => (
            <div key={i.name} className="p-5 rounded-2xl bg-black/40 border border-green-900/15">
              <div className="font-bold mb-2">{i.name}</div>
              <div className="text-sm text-gray-400">{i.desc}</div>
            </div>
          ))}
        </div>

        {/* Waitlist */}
        <div className="p-8 rounded-2xl bg-gradient-to-br from-violet-900/30 to-purple-900/20 border border-violet-700/30 text-center">
          <h3 className="text-xl font-bold mb-2">Want early API access?</h3>
          <p className="text-gray-400 mb-6">
            Join the waitlist. Gold-tier subscribers get priority access when the API launches.
          </p>
          <a
            href="mailto:api@prismo.app"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-violet-600 to-purple-600 rounded-xl font-semibold hover:from-violet-500 hover:to-purple-500 transition"
          >
            api@prismo.app
          </a>
        </div>
      </main>
    </div>
  );
}
