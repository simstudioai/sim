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
    'Get in touch with Sim. Ask a general question, request an integration, or get help.',
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: '/contact' },
  openGraph: {
    title: 'Contact Us | Sim',
    description: 'Get in touch with the Sim team for questions, integrations, and support.',
    type: 'website',
  },
}

export default async function ContactPage() {
  const blogPosts = await getNavBlogPosts()

  return (
    <main className='min-h-screen bg-[var(--landing-bg)] font-[430] font-season text-[var(--landing-text)]'>
      <header>
        <Navbar blogPosts={blogPosts} />
      </header>

      <div className='mx-auto max-w-[640px] px-6 pt-[72px] pb-24 sm:px-12'>
        <span className='mb-4 block font-martian-mono text-[11px] text-[var(--landing-text-muted)] uppercase tracking-[0.12em]'>
          Contact us
        </span>
        <h1 className='mb-5 text-balance font-[500] text-4xl text-[var(--landing-text)] leading-[1.05] tracking-[-0.02em] md:text-5xl'>
          We're here to help
        </h1>
        <p className='text-pretty text-[var(--landing-text-muted)] text-base leading-[1.7]'>
          Got a general question, integration request, or need help? Send us a message and our team
          will get back to you.
        </p>

        <div className='dark mt-14'>
          <ContactForm />
        </div>
      </div>

      {isHosted && <Footer hideCTA />}
    </main>
  )
}
