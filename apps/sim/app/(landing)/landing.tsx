import {
  Background,
  Footer,
  Hero,
  Integrations,
  LandingEnterprise,
  LandingPricing,
  LandingTemplates,
  Nav,
} from '@/app/(landing)/components'

export default function Landing() {
  return (
    <Background>
      <Nav />
      <main className='relative'>
        <Hero />
        <LandingTemplates />
        <LandingEnterprise />
        <Integrations />
        <LandingPricing />
      </main>
      <Footer />
    </Background>
  )
}
