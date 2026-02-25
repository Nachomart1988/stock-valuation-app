'use client';

import Header from '../components/Header';

const openSourceLibs = [
  { name: 'Next.js', version: '14.x', license: 'MIT', url: 'https://github.com/vercel/next.js/blob/canary/license.md' },
  { name: 'React', version: '18.x', license: 'MIT', url: 'https://github.com/facebook/react/blob/main/LICENSE' },
  { name: 'TypeScript', version: '5.x', license: 'Apache-2.0', url: 'https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt' },
  { name: 'Tailwind CSS', version: '3.x', license: 'MIT', url: 'https://github.com/tailwindlabs/tailwindcss/blob/master/LICENSE' },
  { name: 'FastAPI', version: '0.x', license: 'MIT', url: 'https://github.com/tiangolo/fastapi/blob/master/LICENSE' },
  { name: 'PyTorch', version: '2.x', license: 'BSD-3-Clause', url: 'https://github.com/pytorch/pytorch/blob/main/LICENSE' },
  { name: 'NumPy', version: '1.x', license: 'BSD-3-Clause', url: 'https://github.com/numpy/numpy/blob/main/LICENSE.txt' },
  { name: 'Pandas', version: '2.x', license: 'BSD-3-Clause', url: 'https://github.com/pandas-dev/pandas/blob/main/LICENSE' },
  { name: 'yfinance', version: '0.2.x', license: 'Apache-2.0', url: 'https://github.com/ranaroussi/yfinance/blob/main/LICENSE.txt' },
  { name: 'Headless UI', version: '1.x', license: 'MIT', url: 'https://github.com/tailwindlabs/headlessui/blob/main/LICENSE' },
  { name: 'Clerk', version: '4.x', license: 'MIT (SDK)', url: 'https://github.com/clerkinc/javascript/blob/main/LICENSE' },
  { name: 'jsPDF', version: '2.x', license: 'MIT', url: 'https://github.com/parallax/jsPDF/blob/master/LICENSE' },
  { name: 'Chart.js', version: '4.x', license: 'MIT', url: 'https://github.com/chartjs/Chart.js/blob/master/LICENSE.md' },
  { name: 'Lucide React', version: '0.x', license: 'ISC', url: 'https://github.com/lucide-icons/lucide/blob/main/LICENSE' },
  { name: 'SciPy', version: '1.x', license: 'BSD-3-Clause', url: 'https://github.com/scipy/scipy/blob/main/LICENSE.txt' },
];

const licenseColors: Record<string, string> = {
  'MIT': 'text-emerald-400 bg-emerald-900/30 border-emerald-700/40',
  'Apache-2.0': 'text-blue-400 bg-blue-900/30 border-blue-700/40',
  'BSD-3-Clause': 'text-violet-400 bg-violet-900/30 border-violet-700/40',
  'ISC': 'text-amber-400 bg-amber-900/30 border-amber-700/40',
};

export default function LicensesPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900 text-white">
      <Header />

      <main className="pt-28 pb-20 px-4 max-w-4xl mx-auto">
        <div className="mb-10">
          <h1 className="text-4xl font-black mb-2">Licenses</h1>
          <p className="text-gray-400">
            Prismo is built with open-source software. We are grateful to every contributor and maintainer
            of the libraries listed below.
          </p>
        </div>

        {/* Prismo own license */}
        <div className="p-6 rounded-2xl bg-gradient-to-br from-emerald-900/20 to-teal-900/10 border border-emerald-700/30 mb-10">
          <h2 className="text-xl font-bold mb-2">Prismo Software License</h2>
          <p className="text-gray-400 text-sm leading-relaxed">
            The Prismo platform, including all proprietary algorithms, valuation models, neural engine code, and user interface,
            is <strong className="text-white">proprietary and confidential</strong>. All rights reserved. Unauthorized reproduction,
            distribution, or reverse engineering is strictly prohibited.
          </p>
          <p className="text-gray-500 text-xs mt-3">
            © 2024–2026 Prismo. For licensing inquiries: <a href="mailto:legal@prismo.app" className="text-emerald-400 hover:underline">legal@prismo.app</a>
          </p>
        </div>

        {/* Open Source Attribution */}
        <h2 className="text-xl font-bold mb-4">Open Source Dependencies</h2>
        <p className="text-gray-400 text-sm mb-6">
          This product includes software developed by third parties, each governed by their respective open-source licenses.
        </p>

        <div className="overflow-hidden rounded-2xl border border-gray-700/50">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-800/60 border-b border-gray-700/50">
                <th className="text-left p-4 text-gray-400 font-semibold text-sm">Package</th>
                <th className="text-left p-4 text-gray-400 font-semibold text-sm">Version</th>
                <th className="text-left p-4 text-gray-400 font-semibold text-sm">License</th>
                <th className="text-left p-4 text-gray-400 font-semibold text-sm hidden sm:table-cell">Source</th>
              </tr>
            </thead>
            <tbody>
              {openSourceLibs.map((lib, i) => (
                <tr key={lib.name} className={`border-b border-gray-700/30 ${i % 2 === 0 ? '' : 'bg-gray-800/20'}`}>
                  <td className="p-4 font-semibold text-sm">{lib.name}</td>
                  <td className="p-4 text-gray-500 text-sm font-mono">{lib.version}</td>
                  <td className="p-4">
                    <span className={`text-xs font-bold px-2 py-1 rounded border ${licenseColors[lib.license] ?? 'text-gray-400 bg-gray-800 border-gray-700'}`}>
                      {lib.license}
                    </span>
                  </td>
                  <td className="p-4 hidden sm:table-cell">
                    <a href={lib.url} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-emerald-400 transition">
                      View License →
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-gray-500 text-xs mt-6">
          This list may not be exhaustive. For the complete list of dependencies, see{' '}
          <code className="font-mono text-gray-400">package.json</code> and{' '}
          <code className="font-mono text-gray-400">requirements.txt</code> in the project repository.
        </p>
      </main>
    </div>
  );
}
