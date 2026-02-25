'use client';

import Header from '../components/Header';

export default function PrivacyPage() {
  const lastUpdated = 'February 25, 2026';

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900 text-white">
      <Header />

      <main className="pt-28 pb-20 px-4 max-w-3xl mx-auto">
        <div className="mb-10">
          <h1 className="text-4xl font-black mb-2">Privacy Policy</h1>
          <p className="text-gray-500 text-sm">Last updated: {lastUpdated}</p>
        </div>

        <div className="prose prose-invert prose-sm max-w-none space-y-8 text-gray-300 leading-relaxed">
          <section>
            <h2 className="text-xl font-bold text-white mb-3">1. Introduction</h2>
            <p>
              Prismo ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect,
              use, disclose, and safeguard your information when you use our website and services. Please read this policy carefully.
              By using Prismo, you agree to the terms described herein.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">2. Information We Collect</h2>
            <p className="mb-3">We collect the following categories of information:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Account Information:</strong> Name, email address, and authentication data provided when you create an account via Clerk.</li>
              <li><strong>Usage Data:</strong> Pages visited, features used, tickers analyzed, and session duration — collected anonymously via analytics tools.</li>
              <li><strong>Payment Information:</strong> Billing details are processed by Stripe. We do not store full card numbers on our servers.</li>
              <li><strong>User Content:</strong> Investor diary entries, blog posts, and analyses you choose to save or publish.</li>
              <li><strong>Technical Data:</strong> IP address, browser type, device type, and operating system for security and debugging.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>To provide and improve the Prismo service.</li>
              <li>To process subscriptions and transactions via Stripe.</li>
              <li>To send transactional emails (receipts, account alerts) — not marketing without consent.</li>
              <li>To personalize your experience and remember your preferences.</li>
              <li>To detect fraud, abuse, and security incidents.</li>
              <li>To comply with legal obligations.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">4. Data Sharing</h2>
            <p className="mb-3">We do not sell your personal data. We share data only with:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Clerk:</strong> Authentication provider. Governs identity and session data.</li>
              <li><strong>Stripe:</strong> Payment processor. Subject to Stripe's privacy policy.</li>
              <li><strong>Analytics providers:</strong> Aggregated, anonymized usage data only.</li>
              <li><strong>Legal authorities:</strong> When required by law or valid legal process.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">5. Data Retention</h2>
            <p>
              We retain your account data for as long as your account is active. Upon account deletion, personal data is removed
              within 30 days, except where retention is required by law (e.g., financial records for tax purposes — up to 7 years).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">6. Your Rights</h2>
            <p className="mb-3">Depending on your location, you may have the right to:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Access the personal data we hold about you.</li>
              <li>Request correction of inaccurate data.</li>
              <li>Request deletion of your data ("right to be forgotten").</li>
              <li>Object to or restrict processing of your data.</li>
              <li>Receive your data in a portable format.</li>
            </ul>
            <p className="mt-3">To exercise these rights, contact us at <a href="mailto:privacy@prismo.app" className="text-emerald-400">privacy@prismo.app</a>.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">7. Cookies</h2>
            <p>
              We use essential cookies for authentication and session management. Analytics cookies are only placed with your
              consent. See our <a href="/cookies" className="text-emerald-400 hover:underline">Cookie Policy</a> for details.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">8. Security</h2>
            <p>
              All data is transmitted over HTTPS/TLS. We use industry-standard security practices, including encrypted storage,
              access controls, and regular security reviews. No system is 100% secure; we will notify you of any breach
              as required by applicable law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">9. Children's Privacy</h2>
            <p>
              Prismo is not directed at children under 13. We do not knowingly collect personal information from children.
              If you believe a child has provided us with their data, contact us immediately.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">10. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy periodically. We will notify you of material changes via email or a prominent
              notice in the application. Continued use after changes constitutes acceptance of the revised policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">11. Contact</h2>
            <p>
              For privacy-related inquiries: <a href="mailto:privacy@prismo.app" className="text-emerald-400 hover:underline">privacy@prismo.app</a>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
