import React from 'react'
import { GridPattern } from '../grid-pattern'
import { Button } from '@/components/ui/button'
import { Command, CornerDownLeft } from 'lucide-react'
import HeroWorkflowProvider from '../hero-workflow'

function Hero() {
  return (
    <section className="min-h-screen pt-36 sm:pt-48 md:pt-56 text-white relative">
        <GridPattern 
          x={-5}
          y={-5}
          className='stroke-[#ababab]/5 absolute inset-0 z-0'
          width={90}
          height={90}
        />

        <div className="absolute inset-0 z-10 flex items-center justify-center">
           <HeroWorkflowProvider />
        </div>

        <div className="text-center space-y-4 relative z-20 px-4">
          <h1 className="text-5xl md:text-[80px] leading-[1.10] tracking-tight font-semibold animate-fade-up [animation-delay:200ms] opacity-0">
            Build and Deploy
            <br/>
            Agent Workflows
          </h1>

          <p className="text-base md:text-xl text-neutral-400/80 font-normal max-w-3xl mx-auto animate-fade-up leading-[1.5] tracking-normal [animation-delay:400ms] opacity-0">
            Launch agentic workflows with an open source, <br />
            user-friendly environment for devs and agents
          </p>

          <div className="animate-fade-up pt-4 [animation-delay:600ms] opacity-0 translate-y-[-10px]">
            <Button variant={"secondary"} className='bg-[#802fff] font-geist-sans items-center px-7 py-6 text-lg text-neutral-100 font-normal tracking-normal shadow-lg shadow-[#802fff]/30 hover:bg-[#701ffc]'>
              Start now

              <div className='flex items-center gap-1 pl-2 opacity-80'>
                <Command size={24}/>
                <CornerDownLeft/>
              </div>
            </Button>
          </div>
        </div>
      </section>
  )
}

export default Hero