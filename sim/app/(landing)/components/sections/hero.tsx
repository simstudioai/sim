'use client'

import React, { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Command, CornerDownLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GridPattern } from '../grid-pattern'
import HeroWorkflowProvider from '../hero-workflow'

function Hero() {
  const router = useRouter()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        router.push('/login')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [router])

  return (
    <section className="min-h-screen pt-36 sm:pt-48 md:pt-56 text-white relative border-b border-[#181818] overflow-hidden">
      <GridPattern
        x={-5}
        y={-5}
        className="stroke-[#ababab]/5 absolute inset-0 z-0"
        width={90}
        height={90}
      />

      {/* Centered black background behind text and button */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-w-4xl w-full">
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 800 500"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="xMidYMid meet"
        >
          <g filter="url(#filter0_f_0_1)">
            <rect x="50" y="50" width="700" height="400" rx="20" fill="#0C0C0C" />
          </g>
          <defs>
            <filter
              id="filter0_f_0_1"
              x="0"
              y="0"
              width="800"
              height="500"
              filterUnits="userSpaceOnUse"
              colorInterpolationFilters="sRGB"
            >
              <feFlood floodOpacity="0" result="BackgroundImageFix" />
              <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
              <feGaussianBlur stdDeviation="25" result="effect1_foregroundBlur_0_1" />
            </filter>
          </defs>
        </svg>
      </div>

      <div className="absolute inset-0 z-10 flex items-center justify-center h-full">
        <HeroWorkflowProvider />
      </div>

      <div className="text-center space-y-4 relative z-20 px-4">
        <h1 className="text-5xl md:text-[72px] leading-[1.10] font-semibold animate-fade-up [animation-delay:200ms] opacity-0">
          Build and Deploy
          <br />
          Agent Workflows
        </h1>

        <p className="text-base md:text-xl text-neutral-400/80 font-normal max-w-3xl mx-auto animate-fade-up leading-[1.5] tracking-normal [animation-delay:400ms] opacity-0">
          Launch agentic workflows with an open source, <br />
          user-friendly environment for devs and agents
        </p>

        <div className="animate-fade-up pt-4 [animation-delay:600ms] opacity-0 translate-y-[-10px]">
          <Button
            variant={'secondary'}
            onClick={() => router.push('/login')}
            className="bg-[#701ffc] font-geist-sans items-center px-7 py-6 text-lg text-neutral-100 font-[420] tracking-normal shadow-lg shadow-[#701ffc]/30 hover:bg-[#802FFF]"
          >
            <div className="text-[1.15rem]">Start now</div>

            <div className="flex items-center gap-1 pl-2 opacity-80">
              <Command size={24} />
              <CornerDownLeft />
            </div>
          </Button>
        </div>
      </div>
    </section>
  )
}

export default Hero
