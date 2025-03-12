'use client'

import Link from 'next/link'

export default function PrivacyPolicy() {
  return (
    <main className="bg-[#020817] min-h-screen text-white">
      <div className="max-w-4xl mx-auto px-4 py-16">
        <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>

        <div className="space-y-8 text-white/80">
          <section>
            <p className="mb-4">Last Updated: March 12, 2025</p>
            <p>
              This Privacy Policy describes how Sim Studio, Inc ("we", "us", or "our") collects,
              uses, and discloses your information when you use our platform for building, testing,
              and optimizing agentic workflows (the "Service").
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">Information We Collect</h2>
            <p className="mb-4">We collect information that you provide directly to us when you:</p>
            <ul className="list-disc pl-6 space-y-2 mb-4">
              <li>Create an account or user profile</li>
              <li>Use our platform to build and deploy agent workflows</li>
              <li>Contact our customer support</li>
              <li>Subscribe to our newsletters or marketing communications</li>
              <li>Participate in surveys, contests, or other promotional activities</li>
            </ul>

            <p className="mb-4">The types of information we collect may include:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Contact information (such as name, email address)</li>
              <li>Account credentials</li>
              <li>Profile information</li>
              <li>Payment information (processed by our payment processors)</li>
              <li>Usage data and analytics</li>
              <li>Communications with us</li>
              <li>Any other information you choose to provide</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">Google User Data</h2>
            <p className="mb-4">
              Sim Studio provides functionality that allows you to connect to various Google
              services through our platform. When you choose to use these features, we may access
              certain Google user data as described below:
            </p>

            <h3 className="text-xl font-semibold mb-2 text-white">Gmail Data</h3>
            <p className="mb-4">When you use our Gmail block functionality, we may access:</p>
            <ul className="list-disc pl-6 space-y-2 mb-4">
              <li>Email messages and their contents</li>
              <li>Email labels and folders</li>
              <li>Email metadata (such as sender, recipient, date, subject)</li>
            </ul>
            <p className="mb-4">
              This access is used solely to enable the functionality you request within your
              workflows, such as reading emails from specific folders or sending emails as part of
              your automated processes.
            </p>

            <h3 className="text-xl font-semibold mb-2 text-white">Google Drive Data</h3>
            <p className="mb-4">When you use our Drive block functionality, we may access:</p>
            <ul className="list-disc pl-6 space-y-2 mb-4">
              <li>File and folder listings</li>
              <li>File contents</li>
              <li>File metadata (such as creation date, modification date, sharing settings)</li>
            </ul>
            <p className="mb-4">
              This access is used solely to enable the functionality you request within your
              workflows, such as reading from or writing to specific files.
            </p>

            <h3 className="text-xl font-semibold mb-2 text-white">Google Sheets Data</h3>
            <p className="mb-4">When you use our Sheets block functionality, we may access:</p>
            <ul className="list-disc pl-6 space-y-2 mb-4">
              <li>Spreadsheet contents</li>
              <li>Sheet names and structure</li>
              <li>Cell data and formatting</li>
            </ul>
            <p className="mb-4">
              This access is used solely to enable the functionality you request within your
              workflows, such as reading data from or writing data to specific spreadsheets.
            </p>

            <h3 className="text-xl font-semibold mb-2 text-white">Data Storage and Retention</h3>
            <p className="mb-4">
              <strong>Important:</strong> Sim Studio does not store your Google user data on our
              servers. All data processing occurs within your browser during workflow execution. We
              do not retain, store, or use your Google user data for any purpose other than to
              provide the specific functionality you request.
            </p>

            <h3 className="text-xl font-semibold mb-2 text-white">AI/ML Training</h3>
            <p className="mb-4">
              Sim Studio does not use any Google user data to develop, improve, or train generalized
              AI and/or ML models. Your data remains private and is only used for the specific
              purposes you authorize within your workflows.
            </p>

            <h3 className="text-xl font-semibold mb-2 text-white">Data Protection</h3>
            <p className="mb-4">
              We implement appropriate technical and organizational measures to protect your Google
              user data during processing. Since we do not store your Google user data on our
              servers, the risk of unauthorized access to this data is minimized.
            </p>

            <h3 className="text-xl font-semibold mb-2 text-white">Revoking Access</h3>
            <p className="mb-4">
              You can revoke Sim Studio's access to your Google user data at any time by:
            </p>
            <ul className="list-disc pl-6 space-y-2 mb-4">
              <li>
                Within Sim Studio: Going to Settings, Credentials, and disconnecting the service
              </li>
              <li>
                Directly through Google: Visiting{' '}
                <a
                  href="https://myaccount.google.com/permissions"
                  className="text-blue-400 hover:underline"
                >
                  Google Account Permissions
                </a>{' '}
                and removing Sim Studio from your list of connected applications
              </li>
              <li>
                Contacting us at privacy@simstudio.ai to request assistance with access revocation
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">
              Information Collected Automatically
            </h2>
            <p className="mb-4">
              When you access or use our Service, we may automatically collect information about
              you, including:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Log information (such as IP address, browser type, pages visited)</li>
              <li>Device information (such as device identifiers, operating system)</li>
              <li>Usage information (such as features used, actions taken)</li>
              <li>Location information (such as general location derived from IP address)</li>
              <li>Cookies and similar technologies (as described in our Cookie Policy)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">How We Use Your Information</h2>
            <p className="mb-4">We use the information we collect to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Provide, maintain, and improve our Service</li>
              <li>Process transactions and manage your account</li>
              <li>Send you technical notices, updates, security alerts, and support messages</li>
              <li>Respond to your comments, questions, and requests</li>
              <li>Communicate with you about products, services, offers, and events</li>
              <li>
                Monitor and analyze trends, usage, and activities in connection with our Service
              </li>
              <li>
                Detect, investigate, and prevent fraudulent transactions and other illegal
                activities
              </li>
              <li>Personalize and improve your experience</li>
              <li>Facilitate contests, sweepstakes, and promotions</li>
              <li>
                Carry out any other purpose described to you at the time the information was
                collected
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">Sharing of Information</h2>
            <p className="mb-4">We may share information about you as follows:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                With vendors, consultants, and other service providers who need access to such
                information to carry out work on our behalf
              </li>
              <li>
                In response to a request for information if we believe disclosure is in accordance
                with any applicable law, regulation, or legal process
              </li>
              <li>
                If we believe your actions are inconsistent with our user agreements or policies, or
                to protect the rights, property, and safety of Sim Studio, Inc or others
              </li>
              <li>
                In connection with, or during negotiations of, any merger, sale of company assets,
                financing, or acquisition of all or a portion of our business by another company
              </li>
              <li>
                Between and among Sim Studio, Inc and our current and future parents, affiliates,
                subsidiaries, and other companies under common control and ownership
              </li>
              <li>With your consent or at your direction</li>
            </ul>
            <p className="mt-4">
              We may also share aggregated or de-identified information that cannot reasonably be
              used to identify you.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">Data Retention</h2>
            <p>
              We store the information we collect about you for as long as is necessary for the
              purpose(s) for which we originally collected it. We may retain certain information for
              legitimate business purposes or as required by law.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">Security</h2>
            <p>
              We take reasonable measures to help protect information about you from loss, theft,
              misuse, unauthorized access, disclosure, alteration, and destruction.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">Your Choices</h2>
            <p className="mb-4">
              You have several choices regarding the information we collect and how it's used:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Account Information:</strong> You may update, correct, or delete your
                account information at any time by logging into your account or contacting us.
              </li>
              <li>
                <strong>Cookies:</strong> Most web browsers are set to accept cookies by default.
                You can usually choose to set your browser to remove or reject browser cookies.
              </li>
              <li>
                <strong>Promotional Communications:</strong> You may opt out of receiving
                promotional emails from us by following the instructions in those emails. If you opt
                out, we may still send you non-promotional emails, such as those about your account
                or our ongoing business relations.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">Your Rights</h2>
            <p className="mb-4">
              Depending on your location, you may have certain rights regarding your personal
              information, such as:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>The right to access personal information we hold about you</li>
              <li>
                The right to request that we update, correct, or delete your personal information
              </li>
              <li>The right to object to or restrict certain processing of your data</li>
              <li>The right to data portability</li>
              <li>The right to withdraw consent at any time for processing based on consent</li>
            </ul>
            <p className="mt-4">
              To exercise these rights, please contact us using the information provided below.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">Children's Privacy</h2>
            <p>
              Our Service is not directed to children under 16, and we do not knowingly collect
              personal information from children under 16. If we learn we have collected or received
              personal information from a child under 16 without verification of parental consent,
              we will delete that information.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">
              Changes to this Privacy Policy
            </h2>
            <p>
              We may update this Privacy Policy from time to time. If we make material changes, we
              will notify you as required by applicable law. We encourage you to review the Privacy
              Policy whenever you access the Service to stay informed about our information
              practices.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">Contact Us</h2>
            <p>If you have any questions about this Privacy Policy, please contact us at:</p>
            <p className="mt-2">Sim Studio, Inc</p>
            <p>Email: privacy@simstudio.ai</p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 text-center">
          <Link href="/" className="text-white/60 hover:text-white transition-colors duration-200">
            Return to Home
          </Link>
        </div>
      </div>
    </main>
  )
}
