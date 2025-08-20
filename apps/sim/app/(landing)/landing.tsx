'use client'

import NavWrapper from '@/app/(landing)/components/nav-wrapper'
import Clients from '@/app/(landing)/components/sections/clients'
import CTA from '@/app/(landing)/components/sections/cta'
import Footer from '@/app/(landing)/components/sections/footer'
import Hero from '@/app/(landing)/components/sections/hero'
import Integrations from '@/app/(landing)/components/sections/integrations'
import Pricing from '@/app/(landing)/components/sections/pricing'
import Templates from '@/app/(landing)/components/sections/templates'
import Testimonials from '@/app/(landing)/components/sections/testimonials'

export default function Landing() {
  const handleOpenTypeformLink = () => {
    window.open('https://form.typeform.com/to/jqCO12pF', '_blank')
  }

  return (
    <main className='relative min-h-screen overflow-x-hidden scroll-smooth bg-white font-geist-sans'>
      <NavWrapper onOpenTypeformLink={handleOpenTypeformLink} />

      <Hero />
      <Templates />
      <Clients />
      <Integrations />
      <Testimonials />
      <Pricing />

      <CTA />
      <Footer />
    </main>
  )
}
