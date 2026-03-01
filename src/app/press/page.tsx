'use client';

import Header from '../components/Header';

const socialLinks = [
  { name: 'Twitter / X', handle: '@prismoapp', url: 'https://twitter.com/prismoapp', color: 'text-sky-400 border-sky-700/40' },
  { name: 'LinkedIn', handle: 'Prismo', url: 'https://linkedin.com/company/prismoapp', color: 'text-blue-400 border-blue-700/40' },
  { name: 'YouTube', handle: 'Prismo Finance', url: 'https://youtube.com/@prismoapp', color: 'text-red-400 border-red-700/40' },
];

const pressKit = [
  { label: 'Full Name', value: 'Prismo' },
  { label: 'Category', value: 'Fintech / Investment Analysis SaaS' },
  { label: 'Founded', value: '2024' },
  { label: 'HQ', value: 'Remote (US)' },
  { label: 'Focus', value: 'Professional-grade stock analysis for retail investors' },
];

export default function PressPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-gray-800 to-black text-white">
      <Header />

      <main className="pt-28 pb-20 px-4 max-w-4xl mx-auto">
        <div className="mb-12">
          <h1 className="text-4xl sm:text-5xl font-black mb-4">Press & Media</h1>
          <p className="text-gray-400 text-lg max-w-2xl">
            Resources for journalists and media professionals covering Prismo.
            For press inquiries, reach us directly — we respond within 24 hours.
          </p>
        </div>

        {/* Media Contact */}
        <div className="grid md:grid-cols-2 gap-6 mb-12">
          <div className="p-6 rounded-2xl bg-black/50 border border-green-900/15">
            <h2 className="text-xl font-bold mb-4">Media Contact</h2>
            <div className="space-y-3">
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">General Inquiries</div>
                <a href="mailto:press@prismo.app" className="text-emerald-400 hover:text-emerald-300 font-semibold transition">
                  press@prismo.app
                </a>
              </div>
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Partnerships</div>
                <a href="mailto:partnerships@prismo.app" className="text-emerald-400 hover:text-emerald-300 font-semibold transition">
                  partnerships@prismo.app
                </a>
              </div>
              <div className="mt-4 pt-4 border-t border-green-900/15 text-sm text-gray-400">
                Response time: within 24 business hours
              </div>
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-black/50 border border-green-900/15">
            <h2 className="text-xl font-bold mb-4">Company Facts</h2>
            <div className="space-y-2">
              {pressKit.map((item) => (
                <div key={item.label} className="flex justify-between text-sm">
                  <span className="text-gray-400">{item.label}</span>
                  <span className="text-white font-medium">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Social Channels */}
        <h2 className="text-xl font-bold mb-4">Social Channels</h2>
        <div className="grid sm:grid-cols-3 gap-4 mb-12">
          {socialLinks.map((s) => (
            <a
              key={s.name}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`p-5 rounded-2xl bg-black/40 border ${s.color} hover:scale-[1.02] transition`}
            >
              <div className={`font-bold mb-1 ${s.color.split(' ')[0]}`}>{s.name}</div>
              <div className="text-sm text-gray-400">{s.handle}</div>
            </a>
          ))}
        </div>

        {/* Elevator Pitch */}
        <div className="p-8 rounded-2xl bg-gradient-to-br from-gray-800/80 to-black/80 border border-green-900/15">
          <h2 className="text-xl font-bold mb-3">About Prismo</h2>
          <p className="text-gray-300 leading-relaxed">
            Prismo is a professional-grade investment analysis platform designed for the individual investor.
            We combine 20+ institutional-level valuation models — DCF, DDM, Graham, Monte Carlo, and more —
            into a fully customizable, bilingual (ES/EN) analysis suite. Our neural engine processes 12 layers
            of financial analysis in seconds, giving retail investors the same analytical tools previously
            available only to large institutions.
          </p>
          <div className="mt-4 pt-4 border-t border-green-900/15 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { n: '20+', l: 'Valuation Models' },
              { n: '21', l: 'Analysis Tabs' },
              { n: '5000', l: 'Monte Carlo Sims' },
              { n: '100%', l: 'Editable Inputs' },
            ].map((s) => (
              <div key={s.l} className="text-center">
                <div className="text-2xl font-black text-emerald-400">{s.n}</div>
                <div className="text-xs text-gray-400 mt-0.5">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
