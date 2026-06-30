import { ChipLink } from '@sim/emcn'
import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/core/utils/urls'

const PAGE_URL = `${SITE_URL}/partners`
const TITLE = 'Partner Program | Sim'
const DESCRIPTION =
  "Join the Sim partner program. Build, deploy, and sell AI agent solutions powered by Sim's AI workspace, and earn your certification through Sim Academy."

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords:
    'Sim partner program, AI agent partners, AI workspace partners, Sim Academy certification, AI agent reseller, co-marketing',
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    url: PAGE_URL,
    siteName: 'Sim',
    locale: 'en_US',
    images: [
      {
        url: '/logo/426-240/reverse/small.png',
        width: 2130,
        height: 1200,
        alt: TITLE,
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@simdotai',
    creator: '@simdotai',
    title: TITLE,
    description: DESCRIPTION,
    images: { url: '/logo/426-240/reverse/small.png', alt: 'Sim' },
  },
  alternates: {
    canonical: PAGE_URL,
    languages: { 'en-US': PAGE_URL, 'x-default': PAGE_URL },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  category: 'technology',
}

const partnersJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: TITLE,
  description: DESCRIPTION,
  url: PAGE_URL,
  isPartOf: { '@type': 'WebSite', name: 'Sim', url: SITE_URL },
}

const breadcrumbJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
    { '@type': 'ListItem', position: 2, name: 'Partners', item: PAGE_URL },
  ],
}

const PARTNER_TIERS = [
  {
    name: 'Certified Partner',
    badge: 'Entry',
    requirements: ['Complete Sim Academy certification', 'Deploy at least 1 live agent'],
    perks: [
      'Official partner badge',
      'Listed in partner directory',
      'Early access to new features',
    ],
  },
  {
    name: 'Silver Partner',
    badge: 'Growth',
    requirements: [
      'All Certified requirements',
      '3+ active client deployments',
      'Sim Academy advanced certification',
    ],
    perks: [
      'All Certified perks',
      'Dedicated partner Slack channel',
      'Co-marketing opportunities',
      'Priority support',
    ],
  },
  {
    name: 'Gold Partner',
    badge: 'Premier',
    requirements: [
      'All Silver requirements',
      '10+ active client deployments',
      'Sim solutions architect certification',
    ],
    perks: [
      'All Silver perks',
      'Revenue share program',
      'Joint case studies',
      'Dedicated partner success manager',
      'Influence product roadmap',
    ],
  },
]

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Sign up & complete Sim Academy',
    description:
      'Create an account and work through the Sim Academy certification program. Learn to build, integrate, and deploy AI agents through hands-on exercises.',
  },
  {
    step: '02',
    title: 'Build & deploy real solutions',
    description:
      'Put your skills to work. Build AI agents for clients, integrate Sim into existing products, or create your own Sim-powered applications.',
  },
  {
    step: '03',
    title: 'Get certified & grow',
    description:
      'Earn your partner certification and unlock perks, co-marketing opportunities, and revenue share as you scale your practice.',
  },
]

const BENEFITS = [
  {
    icon: '🎓',
    title: 'Interactive Learning',
    description:
      'Learn on the real Sim canvas with drag-and-drop exercises, instant feedback, and guided exercises, not just videos.',
  },
  {
    icon: '🤝',
    title: 'Co-Marketing',
    description:
      'Get listed in the Sim partner directory, featured in case studies, and promoted to the Sim user base.',
  },
  {
    icon: '💰',
    title: 'Revenue Share',
    description: 'Gold partners earn revenue share on referred customers and managed deployments.',
  },
  {
    icon: '🚀',
    title: 'Early Access',
    description:
      'Partners get early access to new Sim features, APIs, and integrations before they launch publicly.',
  },
  {
    icon: '🛠️',
    title: 'Technical Support',
    description:
      'Priority technical support, private Slack access, and a dedicated partner success manager for Gold partners.',
  },
  {
    icon: '📣',
    title: 'Community',
    description:
      'Join a growing community of Sim builders. Share agents, collaborate on solutions, and shape the product roadmap.',
  },
]

export default function PartnersPage() {
  return (
    <main id='main-content'>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(partnersJsonLd) }}
      />
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      {/* Hero */}
      <section
        aria-labelledby='partners-hero-heading'
        className='mx-auto w-full max-w-[1446px] border-[var(--border)] border-b px-12 py-[100px] max-sm:px-5 max-lg:px-8'
      >
        <div className='mx-auto max-w-4xl'>
          <p className='sr-only'>
            Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. The
            Sim partner program lets agencies and builders get certified through Sim Academy, deploy
            real AI agent solutions for clients, and earn co-marketing, revenue share, and priority
            support as they grow.
          </p>
          <div className='mb-4 text-[13px] text-[var(--text-muted)] uppercase tracking-[0.12em]'>
            Partner Program
          </div>
          <h1
            id='partners-hero-heading'
            className='mb-5 text-[64px] text-[var(--text-primary)] leading-[105%] tracking-[-0.03em] max-sm:text-[32px] max-md:text-[40px] max-lg:text-[44px] max-xl:text-[52px] [&>br]:max-sm:hidden'
          >
            Build the future <br />
            of AI agents
          </h1>
          <p className='mb-10 max-w-xl text-[18px] text-[var(--text-muted)]/60 leading-[160%] tracking-[0.01em]'>
            Become a certified Sim partner. Complete Sim Academy, deploy real solutions, and earn
            recognition in the growing ecosystem of AI agent builders.
          </p>
          <div className='flex items-center gap-4'>
            <a
              href='#how-it-works'
              className='inline-flex h-[44px] items-center rounded-[5px] border border-[var(--border-1)] px-6 text-[15px] text-[var(--text-primary)] transition-colors hover:border-[var(--border-1)]'
            >
              Learn more
            </a>
          </div>
        </div>
      </section>

      {/* Benefits grid */}
      <section
        aria-labelledby='partners-benefits-heading'
        className='mx-auto w-full max-w-[1446px] border-[var(--border)] border-b px-12 py-20 max-sm:px-5 max-lg:px-8'
      >
        <div className='mx-auto max-w-5xl'>
          <h2
            id='partners-benefits-heading'
            className='mb-12 text-[13px] text-[var(--text-muted)] uppercase tracking-[0.12em]'
          >
            Why partner with Sim
          </h2>
          <div className='grid gap-6 sm:grid-cols-2 lg:grid-cols-3'>
            {BENEFITS.map((b) => (
              <div
                key={b.title}
                className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-6'
              >
                <div className='mb-3 text-[24px]'>{b.icon}</div>
                <h3 className='mb-2 text-[15px] text-[var(--text-primary)]'>{b.title}</h3>
                <p className='text-[14px] text-[var(--text-body)] leading-[160%]'>
                  {b.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section
        id='how-it-works'
        aria-labelledby='partners-how-heading'
        className='mx-auto w-full max-w-[1446px] border-[var(--border)] border-b px-12 py-20 max-sm:px-5 max-lg:px-8'
      >
        <div className='mx-auto max-w-4xl'>
          <h2
            id='partners-how-heading'
            className='mb-12 text-[13px] text-[var(--text-muted)] uppercase tracking-[0.12em]'
          >
            How it works
          </h2>
          <div className='space-y-10'>
            {HOW_IT_WORKS.map((step) => (
              <div key={step.step} className='flex gap-8'>
                <div className='flex-shrink-0 text-[48px] text-[var(--border)] leading-none'>
                  {step.step}
                </div>
                <div className='pt-2'>
                  <h3 className='mb-2 text-[18px] text-[var(--text-primary)]'>{step.title}</h3>
                  <p className='text-[15px] text-[var(--text-body)] leading-[160%]'>
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Partner tiers */}
      <section
        aria-labelledby='partners-tiers-heading'
        className='mx-auto w-full max-w-[1446px] border-[var(--border)] border-b px-12 py-20 max-sm:px-5 max-lg:px-8'
      >
        <div className='mx-auto max-w-5xl'>
          <h2
            id='partners-tiers-heading'
            className='mb-12 text-[13px] text-[var(--text-muted)] uppercase tracking-[0.12em]'
          >
            Partner tiers
          </h2>
          <div className='grid gap-5 lg:grid-cols-3'>
            {PARTNER_TIERS.map((tier) => (
              <div
                key={tier.name}
                className='flex flex-col rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-6'
              >
                <div className='mb-4 flex items-center justify-between'>
                  <h3 className='text-[16px] text-[var(--text-primary)]'>{tier.name}</h3>
                  <span className='rounded-full border border-[var(--border)] bg-[var(--surface-3)] px-2.5 py-0.5 text-[11px] text-[var(--text-muted)]'>
                    {tier.badge}
                  </span>
                </div>

                <div className='mb-4'>
                  <p className='mb-2 text-[12px] text-[var(--text-subtle)] uppercase tracking-[0.1em]'>
                    Requirements
                  </p>
                  <ul className='space-y-1.5'>
                    {tier.requirements.map((r) => (
                      <li
                        key={r}
                        className='flex items-start gap-2 text-[13px] text-[var(--text-body)]'
                      >
                        <span className='mt-1.5 size-1 flex-shrink-0 rounded-full bg-[var(--text-subtle)]' />
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className='mt-auto'>
                  <p className='mb-2 text-[12px] text-[var(--text-subtle)] uppercase tracking-[0.1em]'>
                    Perks
                  </p>
                  <ul className='space-y-1.5'>
                    {tier.perks.map((p) => (
                      <li
                        key={p}
                        className='flex items-start gap-2 text-[13px] text-[var(--text-primary)]'
                      >
                        <span className='mt-1.5 size-1 flex-shrink-0 rounded-full bg-[var(--success)]' />
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        aria-labelledby='partners-cta-heading'
        className='mx-auto w-full max-w-[1446px] px-12 py-[100px] max-sm:px-5 max-lg:px-8'
      >
        <div className='mx-auto max-w-3xl text-center'>
          <h2
            id='partners-cta-heading'
            className='mb-4 text-[48px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em] max-sm:text-[32px] max-md:text-[40px]'
          >
            Ready to get started?
          </h2>
          <p className='mb-10 text-[18px] text-[var(--text-muted)]/60 leading-[160%]'>
            Complete Sim Academy to earn your first certification and unlock partner benefits. It's
            free to start, no credit card required.
          </p>
          <div className='flex items-center justify-center'>
            <ChipLink variant='primary' href='/demo'>
              Book a demo
            </ChipLink>
          </div>
        </div>
      </section>
    </main>
  )
}
