'use client'

import NavWrapper from '@/app/(landing)/components/nav-wrapper'
import Footer from '@/app/(landing)/components/sections/footer'
import Hero from '@/app/(landing)/components/sections/hero'
import Integrations from '@/app/(landing)/components/sections/integrations'
import Testimonials from '@/app/(landing)/components/sections/testimonials'

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
