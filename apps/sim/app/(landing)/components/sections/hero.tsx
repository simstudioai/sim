'use client'

import { useEffect, useState } from 'react'
import { Command, CornerDownLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useSession } from '@/lib/auth-client'
import { GridPattern } from '../grid-pattern'
import HeroWorkflowProvider from '../hero-workflow'

function Hero() {
  const router = useRouter()
  const [isTransitioning, setIsTransitioning] = useState(true)
  const { data: session, isPending } = useSession()
  const isAuthenticated = !isPending && !!session?.user

  const handleNavigate = () => {
    if (typeof window !== 'undefined') {
      // Check if user has an active session
      if (isAuthenticated) {
        router.push('/w')
      } else {
        // Check if user has logged in before
        const hasLoggedInBefore =
          localStorage.getItem('has_logged_in_before') === 'true' ||
          document.cookie.includes('has_logged_in_before=true')

        if (hasLoggedInBefore) {
          // User has logged in before but doesn't have an active session
          router.push('/login')
        } else {
          // User has never logged in before
          router.push('/signup')
        }
      }
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        handleNavigate()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isAuthenticated])

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsTransitioning(false)
    }, 300) // Reduced delay for faster button appearance
    return () => clearTimeout(timer)
  }, [])

  const renderActionUI = () => {
    if (isTransitioning || isPending) {
      return <div className='h-[56px] md:h-[64px]' />
    }
    return (
      <Button
        variant={'secondary'}
        onClick={handleNavigate}
        className='animate-fade-in items-center bg-[#701ffc] px-7 py-6 font-[420] font-geist-sans text-lg text-neutral-100 tracking-normal shadow-[#701ffc]/30 shadow-lg hover:bg-[#802FFF]'
        aria-label='Start using the platform'
      >
        <div className='text-[1.15rem]'>Start now</div>
        <div className='flex items-center gap-1 pl-2 opacity-80' aria-hidden='true'>
          <Command size={24} />
          <CornerDownLeft />
        </div>
      </Button>
    )
  }

  return (
    <section
      className='animation-container relative min-h-screen overflow-hidden border-[#181818] border-b pt-28 text-white will-change-[opacity,transform] sm:pt-32 md:pt-40'
      aria-label='Main hero section'
    >
      <GridPattern
        x={-5}
        y={-5}
        className='absolute inset-0 z-0 stroke-[#ababab]/5'
        width={90}
        height={90}
        aria-hidden='true'
      />

      {/* Centered black background behind text and button */}
      <div
        className='-translate-x-1/2 -translate-y-1/2 absolute top-[28%] left-1/2 w-[95%] md:top-[38%] md:w-[60%] lg:w-[50%]'
        aria-hidden='true'
      >
        <svg
          width='100%'
          height='100%'
          viewBox='0 0 600 480'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
          preserveAspectRatio='xMidYMid meet'
          aria-hidden='true'
          className='aspect-[5/3] h-auto md:aspect-auto'
        >
          <g filter='url(#filter0_b_0_1)'>
            <ellipse cx='300' cy='240' rx='290' ry='220' fill='#0C0C0C' />
          </g>
          <defs>
            <filter
              id='filter0_b_0_1'
              x='0'
              y='10'
              width='600'
              height='460'
              filterUnits='userSpaceOnUse'
              colorInterpolationFilters='sRGB'
            >
              <feGaussianBlur stdDeviation='5' />
            </filter>
          </defs>
        </svg>
      </div>

      <div
        className='absolute inset-0 z-10 flex h-full items-center justify-center'
        aria-hidden='true'
      >
        <HeroWorkflowProvider />
      </div>

      <div className='animation-container relative z-20 space-y-4 px-4 text-center'>
        <h1 className='animation-container animate-fade-up font-semibold text-[42px] leading-[1.10] opacity-0 will-change-[opacity,transform] [animation-delay:200ms] md:text-[68px]'>
          Build / Deploy
          <br />
          Agent Workflows
        </h1>

        <p className='animation-container mx-auto max-w-3xl animate-fade-up font-normal text-base text-neutral-400/80 leading-[1.5] tracking-normal opacity-0 will-change-[opacity,transform] [animation-delay:400ms] md:text-xl'>
          Launch agentic workflows with an open source, <br />
          user-friendly environment for devs and agents
        </p>

        <div className='animation-container translate-y-[-10px] animate-fade-up pt-4 pb-10 opacity-0 will-change-[opacity,transform] [animation-delay:600ms]'>
          {renderActionUI()}
        </div>
      </div>
    </section>
  )
}

export default Hero
