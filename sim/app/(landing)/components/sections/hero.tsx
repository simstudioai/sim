'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Command, CornerDownLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GridPattern } from '../grid-pattern'
import HeroWorkflowProvider from '../hero-workflow'

function Hero() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        router.push('/login')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('idle')

    // Simple email validation
    if (!email.includes('@') || email.trim().length < 5) {
      setStatus('error')
      return
    }

    try {
      setIsSubmitting(true)
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      })

      // Always show success for valid emails, regardless of API response
      setStatus('success')
      setEmail('')
    } catch (error) {
      // Don't show error to user, just log it
      console.error('Error submitting email:', error)
      setStatus('success')
    } finally {
      setIsSubmitting(false)
    }
  }

  const getButtonText = () => {
    if (isSubmitting) return 'Joining...'
    if (status === 'success') return 'Joined!'
    if (status === 'error') return 'Try again'
    return 'Join waitlist'
  }

  const getButtonStyle = () => {
    switch (status) {
      case 'success':
        return 'bg-green-500 hover:bg-green-600 text-white'
      case 'error':
        return 'bg-red-500 hover:bg-red-600 text-white'
      default:
        return 'bg-[#701ffc] hover:bg-[#802FFF] text-white'
    }
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

        {/* <div className="animate-fade-up pt-4 pb-10 [animation-delay:600ms] opacity-0 translate-y-[-10px] will-change-[opacity,transform] animation-container">
          <Button
            variant={'secondary'}
            onClick={() => router.push('/login')}
            className="bg-[#701ffc] font-geist-sans items-center px-7 py-6 text-lg text-neutral-100 font-[420] tracking-normal shadow-lg shadow-[#701ffc]/30 hover:bg-[#802FFF]"
            aria-label="Start using the platform"
          >
            <div className="text-[1.15rem]">Start now</div>

            <div className="flex items-center gap-1 pl-2 opacity-80" aria-hidden="true">
              <Command size={24} />
              <CornerDownLeft />
            </div>
          </Button>
        </div> */}

        <div className="animate-fade-up pb-10 [animation-delay:600ms] opacity-0 translate-y-[-10px] will-change-[opacity,transform] animation-container">
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-3 items-center w-full mx-auto mt-1 md:mt-2 px-4 sm:px-0"
          >
            <div className="flex w-full max-w-xs sm:max-w-sm md:max-w-md gap-2 sm:gap-3">
              <Input
                type="email"
                placeholder="you@example.com"
                className="flex-1 min-w-0 h-[48px] bg-[#121212]/60 border-[rgba(255,255,255,0.08)] focus:border-[rgba(255,255,255,0.15)] text-white placeholder:text-neutral-500 text-sm sm:text-base font-medium rounded-md shadow-inner"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
              />
              <Button
                type="submit"
                className={`h-[47px] font-medium px-6 rounded-md shadow-lg ${getButtonStyle()} shadow-[#701ffc]/20`}
                disabled={isSubmitting}
              >
                {getButtonText()}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </section>
  )
}

export default Hero
