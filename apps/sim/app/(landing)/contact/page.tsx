import type { Metadata } from 'next'
import { getNavBlogPosts } from '@/lib/blog/registry'
import { isHosted } from '@/lib/core/config/feature-flags'
import { SITE_URL } from '@/lib/core/utils/urls'
import { ContactForm } from '@/app/(landing)/components/contact/contact-form'
import Footer from '@/app/(landing)/components/footer/footer'
import Navbar from '@/app/(landing)/components/navbar/navbar'

export const metadata: Metadata = {
  title: 'Contact Us',
  description:
    "Get in touch with Sim. Ask a general question, request an integration, or get help. We'll respond quickly.",
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: '/contact' },
  openGraph: {
    title: 'Contact Us | Sim',
    description: 'Get in touch with the Sim team for questions, integrations, and support.',
    type: 'website',
  },
}

interface DirectContact {
  label: string
  description: string
  email: string
}

const DIRECT_CONTACTS: DirectContact[] = [
  {
    label: 'Support',
    description: 'Bugs, account issues, and product help.',
    email: 'help@sim.ai',
  },
  {
    label: 'Sales',
    description: 'Enterprise plans, demos, and procurement.',
    email: 'enterprise@sim.ai',
  },
  {
    label: 'Privacy',
    description: 'Data requests and privacy questions.',
    email: 'privacy@sim.ai',
  },
  {
    label: 'Security',
    description: 'Vulnerability reports and security disclosures.',
    email: 'security@sim.ai',
  },
]

export default async function ContactPage() {
  const blogPosts = await getNavBlogPosts()

  return (
    <main className='min-h-screen bg-[var(--landing-bg)] font-[430] font-season text-[var(--landing-text)]'>
      <header>
        <Navbar blogPosts={blogPosts} />
      </header>

      <div className='mx-auto max-w-[1100px] px-6 pt-[72px] pb-24 sm:px-12'>
        <div className='max-w-2xl'>
          <span className='mb-4 block font-martian-mono text-[11px] text-[var(--landing-text-muted)] uppercase tracking-[0.12em]'>
            Contact us
          </span>
          <h1 className='mb-5 text-balance font-[500] text-4xl text-[var(--landing-text)] leading-[1.05] tracking-[-0.02em] md:text-5xl'>
            We're here to help
          </h1>
          <p className='text-[var(--landing-text-muted)] text-base leading-[1.7]'>
            Got a general question, integration request, or need help? Send us a message and our
            team will get back to you. For urgent issues, email the right team directly.
          </p>
        </div>

        <div className='mt-14 grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:gap-16'>
          <aside className='flex flex-col gap-6'>
            <div>
              <h2 className='mb-1 font-[500] text-[var(--landing-text)] text-lg tracking-[-0.01em]'>
                Other ways to reach us
              </h2>
              <p className='text-[var(--landing-text-muted)] text-sm leading-[1.6]'>
                Prefer email? Reach the right team directly.
              </p>
            </div>
            <ul className='flex flex-col gap-5'>
              {DIRECT_CONTACTS.map(({ label, description, email }) => (
                <li
                  key={email}
                  className='border-[var(--landing-bg-elevated)] border-t pt-5 first:border-t-0 first:pt-0'
                >
                  <p className='font-[500] text-[var(--landing-text)] text-sm'>{label}</p>
                  <p className='mt-1 text-[13px] text-[var(--landing-text-muted)] leading-[1.6]'>
                    {description}
                  </p>
                  <a
                    href={`mailto:${email}`}
                    className='mt-1.5 inline-block text-[13px] text-[var(--landing-text)] underline underline-offset-2 transition-opacity hover:opacity-80'
                  >
                    {email}
                  </a>
                </li>
              ))}
            </ul>
          </aside>

          <div className='dark'>
            <ContactForm />
          </div>
        </div>
      </div>

      {isHosted && <Footer hideCTA />}
    </main>
  )
}
