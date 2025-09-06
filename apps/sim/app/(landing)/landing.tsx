import {
  Background,
  Hero,
  Integrations,
  LandingEnterprise,
  LandingPricing,
  LandingTemplates,
  Nav,
} from '@/app/(landing)/components'

export default function Landing() {
  return (
    <main className='relative'>
      <Background>
        <Nav />
        <Hero />
        <LandingTemplates />
        <LandingEnterprise />
        <Integrations />
        <LandingPricing />
      </Background>

      {/* Pricing Section */}
      {/* TODO: Add Pricing component */}

      {/* Footer Section */}
      {/* TODO: Add Footer component */}
    </main>
  )
}
