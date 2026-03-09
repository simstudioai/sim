import { Footer, Nav } from '@/app/(landing)/components'

export default function StudioLayout({ children }: { children: React.ReactNode }) {
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
    <div className='flex min-h-screen flex-col'>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
      />
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
      />
      <Nav hideAuthButtons={false} variant='landing' />
      <main className='relative flex-1'>{children}</main>
      <Footer fullWidth={true} />
    </div>
  )
}
