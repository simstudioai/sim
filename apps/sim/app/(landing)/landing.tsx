import {
  Background,
  Footer,
  Hero,
  Integrations,
  LandingPricing,
  Nav,
  Testimonials,
} from '@/app/(landing)/components'

export default function Landing() {
  return (
    <Background>
      <Nav />
      <main className='relative'>
        <Hero />
        {/* <LandingTemplates /> */}
        <LandingPricing />
        <Integrations />
        <Testimonials />
      </main>
      <Footer />
    </Background>
  )
}
