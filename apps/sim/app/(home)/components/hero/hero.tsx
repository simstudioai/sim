'use client'

import dynamic from 'next/dynamic'
import Image from 'next/image'
import Link from 'next/link'
import { DemoRequestModal } from '@/app/(home)/components/demo-request/demo-request-modal'
import {
  BlocksLeftAnimated,
  BlocksRightAnimated,
  BlocksRightSideAnimated,
  BlocksTopLeftAnimated,
  BlocksTopRightAnimated,
  useBlockCycle,
} from '@/app/(home)/components/hero/components/animated-blocks'

const LandingPreview = dynamic(
  () =>
    import('@/app/(home)/components/landing-preview/landing-preview').then(
      (mod) => mod.LandingPreview
    ),
  {
    ssr: false,
    loading: () => <div className='aspect-[1116/549] w-full rounded bg-[#1b1b1b]' />,
  }
)

/** Shared base classes for CTA link buttons — matches Deploy/Run button styling in the preview panel. */
const CTA_BASE =
  'inline-flex items-center h-[32px] rounded-[5px] border px-[10px] font-[430] font-season text-[14px]'

export default function Hero() {
  const blockStates = useBlockCycle()

  return (
    <section
      id='hero'
      aria-labelledby='hero-heading'
      className='relative flex flex-col items-center overflow-hidden bg-[#1C1C1C] pt-[60px] pb-[12px] lg:pt-[100px]'
    >
      <p className='sr-only'>
        Sim is the open-source platform to build AI agents and run your agentic workforce. Connect
        1,000+ integrations and LLMs — including OpenAI, Claude, Gemini, Mistral, and xAI — to
        deploy and orchestrate agentic workflows. Create agents, workflows, knowledge bases, tables,
        and docs. Trusted by over 100,000 builders at startups and Fortune 500 companies. SOC2 and
        HIPAA compliant.
      </p>

      <div
        aria-hidden='true'
        className='pointer-events-none absolute top-[-0.7vw] left-[-2.8vw] z-0 aspect-[344/328] w-[23.9vw]'
      >
        <Image src='/landing/card-left.svg' alt='' fill className='object-contain' />
      </div>

      <div
        aria-hidden='true'
        className='pointer-events-none absolute top-[-2.8vw] right-[-4vw] z-0 aspect-[471/470] w-[32.7vw]'
      >
        <Image src='/landing/card-right.svg' alt='' fill className='object-contain' />
      </div>

      <div className='relative z-10 flex flex-col items-center gap-[12px]'>
        <h1
          id='hero-heading'
          className='font-[430] font-season text-[36px] text-white leading-[100%] tracking-[-0.02em] sm:text-[48px] lg:text-[72px]'
        >
          Build AI Agents
        </h1>
        <p className='font-[430] font-season text-[#F6F6F6]/60 text-[15px] leading-[125%] tracking-[0.02em] lg:text-[18px]'>
          Sim is the AI Workspace for Agent Builders.
        </p>

        <div className='mt-[12px] flex items-center gap-[8px]'>
          <DemoRequestModal>
            <button
              type='button'
              className={`${CTA_BASE} border-[#3d3d3d] bg-transparent text-[#ECECEC] transition-colors hover:bg-[#2A2A2A]`}
              aria-label='Get a demo'
            >
              Get a demo
            </button>
          </DemoRequestModal>
          <Link
            href='/signup'
            className={`${CTA_BASE} gap-[8px] border-[#FFFFFF] bg-[#FFFFFF] text-black transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]`}
            aria-label='Get started with Sim'
          >
            Get started
          </Link>
        </div>
      </div>

      <div
        aria-hidden='true'
        className='pointer-events-none absolute top-0 right-[13.1vw] z-20 w-[calc(140px_+_10.76vw)] max-w-[295px]'
      >
        <BlocksTopRightAnimated animState={blockStates.topRight} />
      </div>

      <div
        aria-hidden='true'
        className='pointer-events-none absolute top-0 left-[16vw] z-20 w-[calc(140px_+_10.76vw)] max-w-[295px]'
      >
        <BlocksTopLeftAnimated animState={blockStates.topLeft} />
      </div>

      <div className='relative z-10 mx-auto mt-[3.2vw] w-[78.9vw] px-[1.4vw]'>
        <div
          aria-hidden='true'
          className='-translate-y-1/2 pointer-events-none absolute top-[50%] right-[calc(100%-1.41vw)] z-20 w-[calc(16px_+_1.25vw)] max-w-[34px]'
        >
          <BlocksLeftAnimated animState={blockStates.left} />
        </div>

        <div
          aria-hidden='true'
          className='-translate-y-1/2 pointer-events-none absolute top-[50%] left-[calc(100%-1.41vw)] z-20 w-[calc(16px_+_1.25vw)] max-w-[34px] scale-x-[-1]'
        >
          <BlocksRightSideAnimated animState={blockStates.rightSide} />
        </div>

        <div className='relative z-10 overflow-hidden rounded border border-[#2A2A2A]'>
          <LandingPreview />
        </div>
      </div>

      <div
        aria-hidden='true'
        className='-translate-y-1/2 pointer-events-none absolute top-[50%] right-0 z-20 w-[calc(16px_+_1.25vw)] max-w-[34px]'
      >
        <BlocksRightAnimated animState={blockStates.rightEdge} />
      </div>
    </section>
  )
}
