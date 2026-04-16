import { getNavBlogPosts } from '@/lib/blog/registry'
import { SITE_URL } from '@/lib/core/utils/urls'
import Footer from '@/app/(landing)/components/footer/footer'
import Navbar from '@/app/(landing)/components/navbar/navbar'

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const blogPosts = await getNavBlogPosts()
  const orgJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Sim',
    url: SITE_URL,
    description:
      'Sim is the open-source AI workspace where teams build, deploy, and manage AI agents.',
    logo: `${SITE_URL}/logo/primary/small.png`,
    sameAs: [
      'https://x.com/simdotai',
      'https://github.com/simstudioai/sim',
      'https://www.linkedin.com/company/simdotai',
    ],
  }

  const websiteJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Sim',
    url: SITE_URL,
  }

  return (
    <div className='flex min-h-screen flex-col bg-[var(--landing-bg)] font-[430] font-season text-[var(--landing-text)]'>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
      />
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
      />
      <header>
        <Navbar blogPosts={blogPosts} />
      </header>
      <main className='relative flex-1'>{children}</main>
      <Footer />
    </div>
  )
}
