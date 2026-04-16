import type { Metadata } from 'next'
import { getNavBlogPosts } from '@/lib/blog/registry'
import { SITE_URL } from '@/lib/core/utils/urls'
import { martianMono } from '@/app/_styles/fonts/martian-mono/martian-mono'
import { season } from '@/app/_styles/fonts/season/season'
import Footer from '@/app/(landing)/components/footer/footer'
import Navbar from '@/app/(landing)/components/navbar/navbar'

export const metadata: Metadata = {
  title: 'Partner Program',
  description:
    "Join the Sim partner program. Build, deploy, and sell AI agent solutions powered by Sim's AI workspace. Earn your certification through Sim Academy.",
  metadataBase: new URL(SITE_URL),
  openGraph: {
    title: 'Partner Program | Sim',
    description: 'Join the Sim partner program.',
    type: 'website',
  },
}

const PARTNER_TIERS = [
  {
    name: 'Certified Partner',
    badge: 'Entry',
    color: '#3A3A3A',
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
    color: '#5A5A5A',
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
    color: '#8B7355',
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
      'Learn on the real Sim canvas with drag-and-drop exercises, instant feedback, and guided exercises — not just videos.',
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

export default async function PartnersPage() {
  const blogPosts = await getNavBlogPosts()

  return (
    <div
      className={`${season.variable} ${martianMono.variable} min-h-screen bg-[#1C1C1C] font-[430] font-season text-[#ECECEC]`}
    >
      <header>
        <Navbar logoOnly={false} blogPosts={blogPosts} />
      </header>

      <main>
        {/* Hero */}
        <section className='border-[#2A2A2A] border-b px-[80px] py-[100px]'>
          <div className='mx-auto max-w-4xl'>
            <div className='mb-4 text-[#666] text-[13px] uppercase tracking-[0.12em]'>
              Partner Program
            </div>
            <h1 className='mb-5 text-[64px] text-white leading-[105%] tracking-[-0.03em]'>
              Build the future
              <br />
              of AI agents
            </h1>
            <p className='mb-10 max-w-xl text-[#F6F6F0]/60 text-[18px] leading-[160%] tracking-[0.01em]'>
              Become a certified Sim partner. Complete Sim Academy, deploy real solutions, and earn
              recognition in the growing ecosystem of AI agent builders.
            </p>
            <div className='flex items-center gap-4'>
              {/* TODO: Uncomment when academy is public */}
              {/* <Link
                href='/academy'
                className='inline-flex h-[44px] items-center rounded-[5px] bg-white px-6 text-[#1C1C1C] text-[15px] transition-colors hover:bg-[#E8E8E8]'
              >
                Start Sim Academy →
              </Link> */}
              <a
                href='#how-it-works'
                className='inline-flex h-[44px] items-center rounded-[5px] border border-[#3A3A3A] px-6 text-[#ECECEC] text-[15px] transition-colors hover:border-[#4A4A4A]'
              >
                Learn more
              </a>
            </div>
          </div>
        </section>

        {/* Benefits grid */}
        <section className='border-[#2A2A2A] border-b px-[80px] py-20'>
          <div className='mx-auto max-w-5xl'>
            <div className='mb-12 text-[#666] text-[13px] uppercase tracking-[0.12em]'>
              Why partner with Sim
            </div>
            <div className='grid gap-6 sm:grid-cols-2 lg:grid-cols-3'>
              {BENEFITS.map((b) => (
                <div key={b.title} className='rounded-[8px] border border-[#2A2A2A] bg-[#222] p-6'>
                  <div className='mb-3 text-[24px]'>{b.icon}</div>
                  <h3 className='mb-2 text-[#ECECEC] text-[15px]'>{b.title}</h3>
                  <p className='text-[#999] text-[14px] leading-[160%]'>{b.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id='how-it-works' className='border-[#2A2A2A] border-b px-[80px] py-20'>
          <div className='mx-auto max-w-4xl'>
            <div className='mb-12 text-[#666] text-[13px] uppercase tracking-[0.12em]'>
              How it works
            </div>
            <div className='space-y-10'>
              {HOW_IT_WORKS.map((step) => (
                <div key={step.step} className='flex gap-8'>
                  <div className='flex-shrink-0 font-[430] text-[#2A2A2A] text-[48px] leading-none'>
                    {step.step}
                  </div>
                  <div className='pt-2'>
                    <h3 className='mb-2 text-[#ECECEC] text-[18px]'>{step.title}</h3>
                    <p className='text-[#999] text-[15px] leading-[160%]'>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Partner tiers */}
        <section className='border-[#2A2A2A] border-b px-[80px] py-20'>
          <div className='mx-auto max-w-5xl'>
            <div className='mb-12 text-[#666] text-[13px] uppercase tracking-[0.12em]'>
              Partner tiers
            </div>
            <div className='grid gap-5 lg:grid-cols-3'>
              {PARTNER_TIERS.map((tier) => (
                <div
                  key={tier.name}
                  className='flex flex-col rounded-[8px] border border-[#2A2A2A] bg-[#222] p-6'
                >
                  <div className='mb-4 flex items-center justify-between'>
                    <h3 className='text-[#ECECEC] text-[16px]'>{tier.name}</h3>
                    <span
                      className='rounded-full px-2.5 py-0.5 text-[11px]'
                      style={{
                        backgroundColor: `${tier.color}33`,
                        color: tier.color === '#8B7355' ? '#C8A96E' : '#999',
                        border: `1px solid ${tier.color}`,
                      }}
                    >
                      {tier.badge}
                    </span>
                  </div>

                  <div className='mb-4'>
                    <p className='mb-2 text-[#555] text-[12px] uppercase tracking-[0.1em]'>
                      Requirements
                    </p>
                    <ul className='space-y-1.5'>
                      {tier.requirements.map((r) => (
                        <li key={r} className='flex items-start gap-2 text-[#999] text-[13px]'>
                          <span className='mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-[#555]' />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className='mt-auto'>
                    <p className='mb-2 text-[#555] text-[12px] uppercase tracking-[0.1em]'>Perks</p>
                    <ul className='space-y-1.5'>
                      {tier.perks.map((p) => (
                        <li key={p} className='flex items-start gap-2 text-[#ECECEC] text-[13px]'>
                          <span className='mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-[#4CAF50]' />
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
        <section className='px-[80px] py-[100px]'>
          <div className='mx-auto max-w-3xl text-center'>
            <h2 className='mb-4 text-[48px] text-white leading-[110%] tracking-[-0.02em]'>
              Ready to get started?
            </h2>
            <p className='mb-10 text-[#F6F6F0]/60 text-[18px] leading-[160%]'>
              Complete Sim Academy to earn your first certification and unlock partner benefits.
              It's free to start — no credit card required.
            </p>
            {/* TODO: Uncomment when academy is public */}
            {/* <Link
              href='/academy'
              className='inline-flex h-[48px] items-center rounded-[5px] bg-white px-8 font-[430] text-[#1C1C1C] text-[15px] transition-colors hover:bg-[#E8E8E8]'
            >
              Start Sim Academy →
            </Link> */}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
