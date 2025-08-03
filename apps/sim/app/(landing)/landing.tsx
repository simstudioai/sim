'use client'

import NavWrapper from '@/app/(landing)/components/nav-wrapper'
import Footer from '@/app/(landing)/components/sections/footer'
import Hero from '@/app/(landing)/components/sections/hero'
import Clients from '@/app/(landing)/components/sections/clients'
import Testimonials from '@/app/(landing)/components/sections/testimonials'
import Templates from '@/app/(landing)/components/sections/templates'
import Pricing from '@/app/(landing)/components/sections/pricing'
import CTA from '@/app/(landing)/components/sections/cta'
import Integrations from '@/app/(landing)/components/sections/integrations'

export default function Landing() {
  const handleOpenTypeformLink = () => {
    window.open('https://form.typeform.com/to/jqCO12pF', '_blank')
  }

  return (
    <main className='relative min-h-screen bg-white font-geist-sans scroll-smooth overflow-x-hidden'>
      <NavWrapper onOpenTypeformLink={handleOpenTypeformLink} />

      <Hero />
      <Templates />
      <Clients />
      <Integrations />
      <Testimonials />
      <Pricing />
      <CTA />
      {/* <Features /> */}
      {/* <Blogs /> */}

      {/* Footer */}
      <Footer />
    </main>
  )
}
