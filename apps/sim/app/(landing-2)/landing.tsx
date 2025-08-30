'use client'

import NavWrapper from '@/app/(landing-2)/components/nav-wrapper'
import Footer from '@/app/(landing-2)/components/sections/footer'
import Hero from '@/app/(landing-2)/components/sections/hero'
import Integrations from '@/app/(landing-2)/components/sections/integrations'
import Testimonials from '@/app/(landing-2)/components/sections/testimonials'

export default function Landing() {
  const handleOpenTypeformLink = () => {
    window.open('https://form.typeform.com/to/jqCO12pF', '_blank')
  }

  return (
    <main className='relative min-h-screen bg-[var(--brand-background-hex)] font-geist-sans'>
      <NavWrapper onOpenTypeformLink={handleOpenTypeformLink} />

      <Hero />
      <Testimonials />
      {/* <Features /> */}
      <Integrations />
      {/* <Blogs /> */}

      {/* Footer */}
      <Footer />
    </main>
  )
}
