'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { DemoRequestModal } from '@/app/(landing)/components/demo-request/demo-request-modal'

const LandingPreview = dynamic(
  () =>
    import('@/app/(landing)/components/landing-preview/landing-preview').then(
      (mod) => mod.LandingPreview
    ),
  {
    ssr: false,
    loading: () => <div className='aspect-[1116/615] w-full rounded bg-[var(--landing-bg)]' />,
  }
)

/** Shared base classes for CTA link buttons — matches Deploy/Run button styling in the preview panel. */
const CTA_BASE =
  'inline-flex items-center h-[32px] rounded-[5px] border px-2.5 font-[430] font-season text-sm'

export default function Hero() {
  return (
    <section
      id='hero'
      aria-labelledby='hero-heading'
      itemScope
      itemType='https://schema.org/WebApplication'
      className='relative flex flex-col items-center overflow-hidden bg-[var(--landing-bg)] pt-[60px] lg:pt-[100px]'
    >
      <p className='sr-only'>
        Sim is an open-source AI agent platform. Sim lets teams build AI agents and run an agentic
        workforce by connecting 1,000+ integrations and LLMs — including OpenAI, Anthropic Claude,
        Google Gemini, Mistral, and xAI Grok — to deploy and orchestrate agentic workflows. Users
        create agents, workflows, knowledge bases, tables, and docs. Sim is trusted by over 100,000
        builders at startups and Fortune 500 companies. Sim is SOC2 compliant.
      </p>

      <div className='relative z-10 flex flex-col items-center gap-3'>
        <h1
          id='hero-heading'
          itemProp='name'
          className='text-balance font-[430] font-season text-[36px] text-white leading-[100%] tracking-[-0.02em] sm:text-[48px] lg:text-[72px]'
        >
          Build AI Agents
        </h1>
        <p
          itemProp='description'
          className='whitespace-nowrap text-center font-[430] font-season text-[4.4vw] text-[color-mix(in_srgb,var(--landing-text-subtle)_60%,transparent)] leading-[125%] tracking-[0.02em] sm:whitespace-normal sm:text-lg lg:text-xl'
        >
          Sim is the AI Workspace for Agent Builders
        </p>

        <div className='mt-3 flex items-center gap-2'>
          <DemoRequestModal theme='light'>
            <button
              type='button'
              className={`${CTA_BASE} border-[var(--landing-border-strong)] bg-transparent text-[var(--landing-text)] transition-colors hover:bg-[var(--landing-bg-elevated)]`}
              aria-label='Get a demo'
            >
              Get a demo
            </button>
          </DemoRequestModal>
          <Link
            href='/signup'
            className={`${CTA_BASE} gap-2 border-white bg-white text-black transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]`}
            aria-label='Get started with Sim'
          >
            Get started
          </Link>
        </div>
      </div>

      <div className='relative z-10 mx-auto mt-6 w-[92vw] px-[1.6vw] lg:mt-[3.2vw] lg:w-full lg:px-16'>
        <div
          aria-hidden='true'
          className='absolute top-0 left-0 z-20 hidden h-px w-[calc(4rem+4px)] bg-[var(--landing-bg-elevated)] lg:block'
        />
        <div
          aria-hidden='true'
          className='absolute top-0 right-0 z-20 hidden h-px w-[calc(4rem+4px)] bg-[var(--landing-bg-elevated)] lg:block'
        />
        <div
          aria-hidden='true'
          className='absolute bottom-0 left-0 z-20 hidden h-px w-[calc(4rem+4px)] bg-[var(--landing-bg-elevated)] lg:block'
        />
        <div
          aria-hidden='true'
          className='absolute right-0 bottom-0 z-20 hidden h-px w-[calc(4rem+4px)] bg-[var(--landing-bg-elevated)] lg:block'
        />
        <div className='relative z-10 overflow-hidden rounded border border-[var(--landing-bg-elevated)]'>
          <LandingPreview />
        </div>
      </div>
    </section>
  )
}
