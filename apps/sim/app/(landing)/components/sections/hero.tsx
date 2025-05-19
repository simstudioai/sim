'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Command, CornerDownLeft } from 'lucide-react'
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
      return <div className="h-[56px] md:h-[64px]" />
    }
    return (
      <Button
        variant={'secondary'}
        onClick={handleNavigate}
        className="bg-[#701ffc] font-geist-sans items-center px-7 py-6 text-lg text-neutral-100 font-[420] tracking-normal shadow-lg shadow-[#701ffc]/30 hover:bg-[#802FFF] animate-fade-in"
        aria-label="Start using the platform"
      >
        <div className="text-[1.15rem]">Start now</div>
        <div className="flex items-center gap-1 pl-2 opacity-80" aria-hidden="true">
          <Command size={24} />
          <CornerDownLeft />
        </div>
      </Button>
    )
  }

  return (
    <section
      className="min-h-screen pt-28 sm:pt-32 md:pt-40 text-white relative border-b border-[#181818] overflow-hidden will-change-[opacity,transform] animation-container"
      aria-label="Main hero section"
    >
      <GridPattern
        x={-5}
        y={-5}
        className="stroke-[#ababab]/5 absolute inset-0 z-0"
        width={90}
        height={90}
        aria-hidden="true"
      />

      {/* Centered black background behind text and button */}
      <div
        className="absolute left-1/2 top-[28%] md:top-[38%] -translate-x-1/2 -translate-y-1/2 w-[95%] md:w-[60%] lg:w-[50%]"
        aria-hidden="true"
      >
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 600 480"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
          className="h-auto aspect-[5/3] md:aspect-auto"
        >
          <g filter="url(#filter0_b_0_1)">
            <ellipse cx="300" cy="240" rx="290" ry="220" fill="#0C0C0C" />
          </g>
          <defs>
            <filter
              id="filter0_b_0_1"
              x="0"
              y="10"
              width="600"
              height="460"
              filterUnits="userSpaceOnUse"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur stdDeviation="5" />
            </filter>
          </defs>
        </svg>
      </div>

      <div
        className="absolute inset-0 z-10 flex items-center justify-center h-full"
        aria-hidden="true"
      >
        <HeroWorkflowProvider />
      </div>

      <div className="text-center space-y-4 relative z-20 px-4 animation-container">
        <h1 className="text-[42px] md:text-[68px] leading-[1.10] font-semibold animate-fade-up [animation-delay:200ms] opacity-0 will-change-[opacity,transform] animation-container">
          Build / Deploy
          <br />
          Agent Workflows
        </h1>

        <p className="text-base md:text-xl text-neutral-400/80 font-normal max-w-3xl mx-auto animate-fade-up leading-[1.5] tracking-normal [animation-delay:400ms] opacity-0 will-change-[opacity,transform] animation-container">
          Launch agentic workflows with an open source, <br />
          user-friendly environment for devs and agents
        </p>

        <div className="animate-fade-up pt-4 pb-10 [animation-delay:600ms] opacity-0 translate-y-[-10px] will-change-[opacity,transform] animation-container">
          {renderActionUI()}
        </div>
      </div>
    </section>
  )
}

export default Hero
