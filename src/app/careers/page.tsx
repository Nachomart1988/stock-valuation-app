'use client';

import Link from 'next/link';
import Header from '../components/Header';

const openings = [
  {
    title: 'Senior Quantitative Analyst',
    team: 'Quant Research',
    location: 'Remote',
    type: 'Full-time',
    description: 'Design and validate valuation models, backtest strategies, and ensure mathematical rigor across our analysis engine.',
  },
  {
    title: 'Full-Stack Engineer (Next.js / FastAPI)',
    team: 'Engineering',
    location: 'Remote',
    type: 'Full-time',
    description: 'Build and scale the Prismo platform — frontend in Next.js 14, backend in FastAPI with PyTorch-powered engines.',
  },
  {
    title: 'Financial Data Engineer',
    team: 'Data',
    location: 'Remote',
    type: 'Full-time',
    description: 'Own our data pipeline: FMP integration, data quality, normalization, and caching layers for real-time financial data.',
  },
];

export default function CareersPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-gray-800 to-black text-white">
      <Header />

      <main className="pt-28 pb-20 px-4 max-w-4xl mx-auto">
        {/* Hero */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-6">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm text-emerald-400">We're hiring</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-black mb-4">
            Build the future of{' '}
            <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
              investment analysis
            </span>
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            We're a small team of finance professionals and engineers building professional-grade analysis tools for individual investors.
            If that excites you, we want to hear from you.
          </p>
        </div>

        {/* Values */}
        <div className="grid md:grid-cols-3 gap-4 mb-16">
          {[
            { title: 'Remote First', desc: 'Work from anywhere. Results matter, not hours logged.' },
            { title: 'Finance + Tech', desc: 'Rare intersection. If you can do both, you belong here.' },
            { title: 'Impact Fast', desc: 'Small team, high ownership. Your work ships to thousands of investors.' },
          ].map((v) => (
            <div key={v.title} className="p-5 rounded-2xl bg-black/50 border border-green-900/15">
              <div className="w-1 h-5 bg-gradient-to-b from-emerald-400 to-teal-500 rounded-full mb-3" />
              <div className="font-semibold mb-1">{v.title}</div>
              <div className="text-sm text-gray-400">{v.desc}</div>
            </div>
          ))}
        </div>

        {/* Open Roles */}
        <h2 className="text-2xl font-bold mb-6">Open Positions</h2>
        <div className="space-y-4 mb-16">
          {openings.map((role) => (
            <div key={role.title} className="p-6 rounded-2xl bg-black/40 border border-green-900/15 hover:border-emerald-500/40 transition group">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold group-hover:text-emerald-400 transition">{role.title}</h3>
                  <div className="flex items-center gap-3 mt-1 mb-3 text-sm text-gray-400">
                    <span>{role.team}</span>
                    <span className="text-gray-600">·</span>
                    <span>{role.location}</span>
                    <span className="text-gray-600">·</span>
                    <span>{role.type}</span>
                  </div>
                  <p className="text-gray-400 text-sm">{role.description}</p>
                </div>
                <a
                  href="mailto:careers@prismo.app"
                  className="flex-shrink-0 px-5 py-2 rounded-xl bg-emerald-600/20 border border-emerald-600/40 text-emerald-400 hover:bg-emerald-600/40 transition text-sm font-semibold whitespace-nowrap"
                >
                  Apply →
                </a>
              </div>
            </div>
          ))}
        </div>

        {/* Spontaneous */}
        <div className="p-8 rounded-2xl bg-gradient-to-br from-emerald-900/30 to-teal-900/20 border border-emerald-700/30 text-center">
          <h3 className="text-xl font-bold mb-2">Don't see your role?</h3>
          <p className="text-gray-400 mb-6">
            We hire for talent and mindset. Send us your background and tell us how you'd contribute to Prismo.
          </p>
          <a
            href="mailto:careers@prismo.app"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl font-semibold hover:from-emerald-500 hover:to-teal-500 transition"
          >
            careers@prismo.app
          </a>
        </div>
      </main>
    </div>
  );
}
