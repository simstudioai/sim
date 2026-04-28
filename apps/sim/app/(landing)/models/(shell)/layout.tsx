import { getNavBlogPosts } from '@/lib/blog/registry'
import { SITE_URL } from '@/lib/core/utils/urls'
import Footer from '@/app/(landing)/components/footer/footer'
import Navbar from '@/app/(landing)/components/navbar/navbar'

export default async function ModelsLayout({ children }: { children: React.ReactNode }) {
  const blogPosts = await getNavBlogPosts()
  const url = SITE_URL
  const orgJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Sim',
    url,
    logo: `${url}/logo/primary/small.png`,
    sameAs: ['https://x.com/simdotai'],
  }

  const websiteJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Sim',
    url,
  }

  return (
    <div className='dark flex min-h-screen flex-col bg-[var(--landing-bg)] font-[430] font-season text-[var(--landing-text)]'>
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
