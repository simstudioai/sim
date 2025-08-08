"use client"

import React from 'react'
import NavWrapper from '../../components/nav-wrapper'
import Clients from '../../components/sections/clients'
import CTA from '../../components/sections/cta'
import Footer from '../../components/sections/footer'
import Hero from '../../components/sections/enterprise/hero'
import Security from '../../components/sections/enterprise/security'
import Showcase from '../../components/sections/enterprise/showcase'


function Enterprise() {
    return (
        <main className='relative min-h-screen bg-white font-geist-sans scroll-smooth overflow-x-hidden'>
          <NavWrapper onOpenTypeformLink={() => {}}/>
    
          <Hero />
          <Clients />
          <Security />
          <Showcase />
    
          <CTA/>
    
          {/* Footer */}
          <Footer />
        </main>
      )
}

export default Enterprise
