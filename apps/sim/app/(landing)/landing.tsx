import {
  Background,
  Footer,
  Hero,
  Integrations,
  LandingEnterprise,
  LandingPricing,
  Nav,
} from '@/app/(landing)/components'

export default function Landing() {
  return (
    <Background>
      <Nav />
      <main className='relative'>
        <Hero />
        {/* <LandingTemplates /> */}
        <LandingEnterprise />
        <Integrations />
        <LandingPricing />
      </main>
      <Footer />
    </Background>
  )
}
