'use client'

import NavWrapper from './components/nav-wrapper'
import Footer from './components/sections/footer'
import Hero from './components/sections/hero'

export default function Landing() {
  const handleOpenTypeformLink = () => {
    window.open('https://form.typeform.com/to/jqCO12pF', '_blank')
  }

  return (
    <main className='relative min-h-screen bg-[#0C0C0C] font-geist-sans'>
      <NavWrapper onOpenTypeformLink={handleOpenTypeformLink} />
      <Hero />
    </main>
  )
}
