import Image from 'next/image'
import React from 'react'
import { Button } from '@/components/ui/button'

function Hero() {
  return (
    <div className="relative w-full flex flex-col items-center overflow-hidden min-h-screen px-4 sm:px-8 md:px-12 lg:px-20 xl:px-32 py-48 lg:py-64">
      <Image src="/static/enterprise_bg.png" className='absolute top-0 left-0 w-full h-full object-cover' alt="Sim" draggable={false} width={3000} height={3000} />
      <div className="flex flex-col items-center w-full gap-12 lg:gap-16 z-10">
        <div className='flex flex-col gap-8 items-center text-center'>
          <h1 className='text-5xl lg:text-6xl font-inter font-medium text-foreground tracking-[-0.04em] leading-tight'>
          Create AI Agents in seconds, <span className='bg-gradient-to-b from-[#6F3DFA] via-[#F05391] to-[#9664EB] bg-clip-text text-transparent'>not weeks.</span>
          </h1>
          <p className='text-base sm:text-lg md:text-xl leading-6 text-[#484848] max-w-2xl'>
            Sim is the AI workflow platform where teams move fast without stressing IT. Speed, security, and control, all in one.
          </p>
        </div>
        <Button className='bg-[#6F3DFA]'>
            Contact Sales
        </Button>
        <div className='relative w-full'>
            <div className='z-0 aspect-video w-full relative bg-background/80 shadow-sm border-border border rounded-[14px] flex p-2'>
                <div className='flex flex-col justify-end w-full h-full bg-background rounded-[6px]'>
                    {/* ADD CONTENT HERE */}
                </div>
            </div>
        </div>
      </div>
    </div>
  )
}

export default Hero
