'use client'

import NavWrapper from '../../components/nav-wrapper'
import Clients from '../../components/sections/clients'
import CTA from '../../components/sections/cta'
import Hero from '../../components/sections/enterprise/hero'
import Security from '../../components/sections/enterprise/security'
import Showcase from '../../components/sections/enterprise/showcase'
import Footer from '../../components/sections/footer'

function Enterprise() {
  return (
    <main className='relative min-h-screen overflow-x-hidden scroll-smooth bg-white font-geist-sans'>
      <NavWrapper onOpenTypeformLink={() => {}} />

      <Hero />
      <Clients />
      <Security />
      <Showcase />

      <CTA />

      {/* Footer */}
      <Footer />
    </main>
  )
}

export default Enterprise
