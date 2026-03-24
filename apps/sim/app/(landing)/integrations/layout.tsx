import { getNavBlogPosts } from '@/lib/blog/registry'
import Footer from '@/app/(home)/components/footer/footer'
import Navbar from '@/app/(home)/components/navbar/navbar'

export default async function IntegrationsLayout({ children }: { children: React.ReactNode }) {
  const blogPosts = await getNavBlogPosts()
  const orgJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Sim',
    url: 'https://sim.ai',
    logo: 'https://sim.ai/logo/primary/small.png',
    sameAs: ['https://x.com/simdotai'],
  }

  const websiteJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Sim',
    url: 'https://sim.ai',
    potentialAction: {
      '@type': 'SearchAction',
      target: 'https://sim.ai/search?q={search_term_string}',
      'query-input': 'required name=search_term_string',
    },
  }

  return (
    <div className='dark flex min-h-screen flex-col bg-[#1C1C1C] font-[430] font-season text-[#ECECEC]'>
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
