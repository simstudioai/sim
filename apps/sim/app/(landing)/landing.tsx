import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { Background, Footer, Nav, StructuredData } from '@/app/(landing)/components'

// Lazy load heavy components for better initial load performance
const Hero = dynamic(() => import('@/app/(landing)/components/hero/hero'), {
  loading: () => <div className='h-[600px] animate-pulse bg-gray-50' />,
})

const LandingPricing = dynamic(
  () => import('@/app/(landing)/components/landing-pricing/landing-pricing'),
  {
    loading: () => <div className='h-[400px] animate-pulse bg-gray-50' />,
  }
)

const Integrations = dynamic(() => import('@/app/(landing)/components/integrations/integrations'), {
  loading: () => <div className='h-[300px] animate-pulse bg-gray-50' />,
})

const Testimonials = dynamic(() => import('@/app/(landing)/components/testimonials/testimonials'), {
  loading: () => <div className='h-[150px] animate-pulse bg-gray-50' />,
})

export default function Landing() {
  return (
    <>
      <StructuredData />
      <Background>
        <header>
          <Nav />
        </header>
        <main className='relative'>
          <Suspense
            fallback={
              <div
                className='h-[600px] animate-pulse bg-gray-50'
                aria-label='Loading hero section'
              />
            }
          >
            <Hero />
          </Suspense>
          <Suspense
            fallback={
              <div
                className='h-[400px] animate-pulse bg-gray-50'
                aria-label='Loading pricing section'
              />
            }
          >
            <LandingPricing />
          </Suspense>
          <Suspense
            fallback={
              <div
                className='h-[300px] animate-pulse bg-gray-50'
                aria-label='Loading integrations section'
              />
            }
          >
            <Integrations />
          </Suspense>
          <Suspense
            fallback={
              <div
                className='h-[150px] animate-pulse bg-gray-50'
                aria-label='Loading testimonials section'
              />
            }
          >
            <Testimonials />
          </Suspense>
        </main>
        <Footer />
      </Background>
    </>
  )
}
