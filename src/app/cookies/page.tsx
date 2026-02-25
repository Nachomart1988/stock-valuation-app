'use client';

import Header from '../components/Header';

export default function CookiesPage() {
  const lastUpdated = 'February 25, 2026';

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900 text-white">
      <Header />

      <main className="pt-28 pb-20 px-4 max-w-3xl mx-auto">
        <div className="mb-10">
          <h1 className="text-4xl font-black mb-2">Cookie Policy</h1>
          <p className="text-gray-500 text-sm">Last updated: {lastUpdated}</p>
        </div>

        <div className="space-y-8 text-gray-300 leading-relaxed">
          <section>
            <h2 className="text-xl font-bold text-white mb-3">What are cookies?</h2>
            <p>
              Cookies are small text files stored on your device when you visit a website. They help the website remember
              your preferences, keep you logged in, and understand how you use the service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">Cookies we use</h2>

            <div className="space-y-4">
              {[
                {
                  category: 'Essential Cookies',
                  color: 'border-emerald-700/40 bg-emerald-900/10',
                  badge: 'Always Active',
                  badgeColor: 'bg-emerald-900/40 text-emerald-400',
                  items: [
                    { name: '__session', purpose: 'Clerk authentication session token. Required to keep you logged in.', duration: 'Session' },
                    { name: '__client_uat', purpose: 'Clerk client verification token for security.', duration: '1 year' },
                    { name: 'prismo_lang', purpose: 'Stores your language preference (ES/EN).', duration: '1 year' },
                  ],
                },
                {
                  category: 'Analytics Cookies',
                  color: 'border-blue-700/40 bg-blue-900/10',
                  badge: 'Consent Required',
                  badgeColor: 'bg-blue-900/40 text-blue-400',
                  items: [
                    { name: '_ga', purpose: 'Google Analytics — tracks page views and session data (anonymized).', duration: '2 years' },
                    { name: '_ga_*', purpose: 'Google Analytics session identifier.', duration: '2 years' },
                  ],
                },
                {
                  category: 'Payment Cookies',
                  color: 'border-violet-700/40 bg-violet-900/10',
                  badge: 'Payment Flow Only',
                  badgeColor: 'bg-violet-900/40 text-violet-400',
                  items: [
                    { name: '__stripe_mid', purpose: 'Stripe fraud prevention and payment security.', duration: '1 year' },
                    { name: '__stripe_sid', purpose: 'Stripe session identifier for checkout flow.', duration: 'Session' },
                  ],
                },
              ].map((group) => (
                <div key={group.category} className={`rounded-2xl border ${group.color} p-5`}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-white">{group.category}</h3>
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${group.badgeColor}`}>{group.badge}</span>
                  </div>
                  <div className="space-y-3">
                    {group.items.map((item) => (
                      <div key={item.name} className="grid grid-cols-3 gap-3 text-sm">
                        <div className="font-mono text-gray-200">{item.name}</div>
                        <div className="text-gray-400 col-span-1">{item.purpose}</div>
                        <div className="text-gray-500 text-right">{item.duration}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">Managing Cookies</h2>
            <p className="mb-3">
              You can control cookies through your browser settings. Note that disabling essential cookies will prevent
              you from logging in or using key features of the Service.
            </p>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              <li><a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">Chrome Cookie Settings</a></li>
              <li><a href="https://support.mozilla.org/kb/clear-cookies-and-site-data-firefox" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">Firefox Cookie Settings</a></li>
              <li><a href="https://support.apple.com/guide/safari/manage-cookies-sfri11471" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">Safari Cookie Settings</a></li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">Contact</h2>
            <p>
              Questions about our use of cookies:{' '}
              <a href="mailto:privacy@prismo.app" className="text-emerald-400 hover:underline">privacy@prismo.app</a>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
