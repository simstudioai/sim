"use client"

import React from 'react'
import AgentChatInput from '../agent-chat-input'
import Image from 'next/image'

function Hero() {
  return (
    <div className="relative w-full flex flex-col items-center justify-center overflow-hidden min-h-[calc(100vh-6rem)] px-4 sm:px-8 md:px-12 lg:px-20 xl:px-32 py-12 sm:py-16 lg:py-24">
      <Image src="/static/bg.png" className='absolute top-24 left-0 w-full h-full object-cover' alt="Sim Logo" width={2000} height={2000} draggable={false} />
      <div className="flex flex-col items-center w-full max-w-4xl gap-12 lg:gap-16 z-10">
        <div className='flex flex-col gap-4 items-center text-center'>
          <h1 className='text-5xl lg:text-6xl font-inter font-medium text-foreground tracking-[-0.04em] leading-tight'>
            Workflows for <span className='bg-gradient-to-b from-[#6F3DFA] via-[#F05391] to-[#9664EB] bg-clip-text text-transparent'>LLMs</span>
          </h1>
          <p className='text-base sm:text-lg md:text-xl leading-6 text-[#484848]'>
            Build and deploy AI agent workflows
          </p>
        </div>
        {/* CHAT WILL BE HERE */}
        <div className='chat w-full md:w-auto'>
          <AgentChatInput />
        </div>
      </div>
    </div>
  )
}

export default Hero
