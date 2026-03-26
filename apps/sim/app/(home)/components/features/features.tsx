'use client'

import { useRef, useState } from 'react'
import { type MotionValue, motion, useScroll, useTransform } from 'framer-motion'
import Image from 'next/image'
import Link from 'next/link'
import { Badge, ChevronDown } from '@/components/emcn'
import { FeaturesPreview } from '@/app/(home)/components/features/components/features-preview'

function hexToRgba(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

const FEATURE_TABS = [
  {
    label: 'Mothership',
    color: '#FA4EDF',
    title: 'Your AI command center',
    description:
      'Direct your entire AI workforce from one place. Build agents, spin up workflows, query tables, and manage every resource across your workspace — in natural language.',
    cta: 'Explore mothership',
    segments: [
      [0.3, 8],
      [0.25, 10],
      [0.45, 12],
      [0.5, 8],
      [0.65, 10],
      [0.8, 12],
      [0.75, 8],
      [0.95, 10],
      [1, 12],
      [0.85, 10],
    ],
  },
  {
    label: 'Tables',
    color: '#2ABBF8',
    title: 'A database, built in',
    description:
      'Filter, sort, and edit data inline, then wire it directly into your workflows. Agents query, insert, and update rows on every run — no external database needed.',
    cta: 'Explore tables',
    segments: [
      [0.25, 12],
      [0.4, 10],
      [0.35, 8],
      [0.55, 12],
      [0.7, 10],
      [0.85, 8],
      [1, 14],
      [0.9, 12],
      [1, 14],
    ],
  },
  {
    label: 'Files',
    color: '#FFCC02',
    badgeColor: '#EAB308',
    title: 'Upload, create, and share',
    description:
      'Create or upload documents, spreadsheets, and media that agents can read, write, and reference across workflows. One shared store your entire team and every agent can pull from.',
    cta: 'Explore files',
    segments: [
      [0.25, 10],
      [0.4, 8],
      [0.35, 12],
      [0.5, 10],
      [0.65, 8],
      [0.75, 10],
      [0.9, 12],
      [1, 10],
      [0.85, 10],
      [1, 10],
    ],
  },
  {
    label: 'Knowledge Base',
    mobileLabel: 'Knowledge',
    color: '#8B5CF6',
    title: 'Your context engine',
    description:
      'Sync institutional knowledge from 30+ live connectors — Notion, Drive, Slack, Confluence, and more — so every agent draws from the same truth across your entire organization.',
    cta: 'Explore knowledge base',
    segments: [
      [0.3, 10],
      [0.25, 8],
      [0.4, 10],
      [0.5, 10],
      [0.65, 10],
      [0.8, 10],
      [0.9, 12],
      [1, 10],
      [0.95, 10],
      [1, 10],
    ],
  },
  {
    label: 'Logs',
    hideOnMobile: true,
    color: '#FF6B35',
    title: 'Full visibility, every run',
    description:
      'Trace every execution block by block — inputs, outputs, cost, and duration. Filter by status or workflow, replay snapshots, and export reports to keep your team accountable.',
    cta: 'Explore logs',
    segments: [
      [0.25, 10],
      [0.35, 8],
      [0.3, 10],
      [0.5, 10],
      [0.65, 8],
      [0.8, 12],
      [0.9, 10],
      [1, 10],
      [0.85, 12],
      [1, 10],
    ],
  },
]

const HEADING_TEXT = 'Everything you need to build, deploy, and manage AI agents. '
const HEADING_LETTERS = HEADING_TEXT.split('')

const LETTER_REVEAL_SPAN = 0.85
const LETTER_FADE_IN = 0.04

interface ScrollLetterProps {
  scrollYProgress: MotionValue<number>
  charIndex: number
  children: string
}

function ScrollLetter({ scrollYProgress, charIndex, children }: ScrollLetterProps) {
  const threshold = (charIndex / HEADING_LETTERS.length) * LETTER_REVEAL_SPAN
  const opacity = useTransform(scrollYProgress, [threshold, threshold + LETTER_FADE_IN], [0.4, 1])

  return <motion.span style={{ opacity }}>{children}</motion.span>
}

function DotGrid({
  cols,
  rows,
  width,
  borderLeft,
}: {
  cols: number
  rows: number
  width?: number
  borderLeft?: boolean
}) {
  return (
    <div
      aria-hidden='true'
      className={`h-full shrink-0 bg-[var(--landing-bg-section)] p-1.5 ${borderLeft ? 'border-[var(--divider)] border-l' : ''}`}
      style={{
        width: width ? `${width}px` : undefined,
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 4,
        placeItems: 'center',
      }}
    >
      {Array.from({ length: cols * rows }, (_, i) => (
        <div key={i} className='h-[1.5px] w-[1.5px] rounded-full bg-[#DEDEDE]' />
      ))}
    </div>
  )
}

export default function Features() {
  const sectionRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState(0)

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start 0.9', 'start 0.2'],
  })

  return (
    <section
      id='features'
      aria-labelledby='features-heading'
      className='relative overflow-hidden bg-[var(--landing-bg-section)]'
    >
      <div aria-hidden='true' className='absolute top-0 left-0 w-full'>
        <Image
          src='/landing/features-transition.svg'
          alt=''
          width={1440}
          height={366}
          className='h-auto w-full'
          priority
        />
      </div>

      <div className='relative z-10 pt-[60px] lg:pt-[100px]'>
        <div ref={sectionRef} className='flex flex-col items-start gap-5 px-6 lg:px-20'>
          <Badge
            variant='blue'
            size='md'
            dot
            className='font-season uppercase tracking-[0.02em] transition-colors duration-200'
            style={{
              color: FEATURE_TABS[activeTab].badgeColor ?? FEATURE_TABS[activeTab].color,
              backgroundColor: hexToRgba(
                FEATURE_TABS[activeTab].badgeColor ?? FEATURE_TABS[activeTab].color,
                0.1
              ),
            }}
          >
            Workspace
          </Badge>
          <h2
            id='features-heading'
            className='max-w-[900px] text-balance font-[430] font-season text-[28px] text-[var(--landing-text-dark)] leading-[110%] tracking-[-0.02em] md:text-[40px]'
          >
            {HEADING_LETTERS.map((char, i) => (
              <ScrollLetter key={i} scrollYProgress={scrollYProgress} charIndex={i}>
                {char}
              </ScrollLetter>
            ))}
            <span className='text-[color-mix(in_srgb,var(--landing-text-dark)_40%,transparent)]'>
              Design powerful workflows, connect your data, and monitor every run — all in one
              platform.
            </span>
          </h2>
        </div>

        <div className='relative mt-10 pb-10 lg:mt-[73px] lg:pb-20'>
          <div
            aria-hidden='true'
            className='absolute top-0 bottom-0 left-[80px] z-20 hidden w-px bg-[var(--divider)] lg:block'
          />
          <div
            aria-hidden='true'
            className='absolute top-0 right-[80px] bottom-0 z-20 hidden w-px bg-[var(--divider)] lg:block'
          />

          <div className='flex h-[68px] border border-[var(--divider)] lg:overflow-hidden'>
            <div className='h-full shrink-0'>
              <div className='h-full lg:hidden'>
                <DotGrid cols={3} rows={8} width={24} />
              </div>
              <div className='hidden h-full lg:block'>
                <DotGrid cols={10} rows={8} width={80} />
              </div>
            </div>

            <div role='tablist' aria-label='Feature categories' className='flex flex-1'>
              {FEATURE_TABS.map((tab, index) => (
                <button
                  key={tab.label}
                  type='button'
                  role='tab'
                  aria-selected={index === activeTab}
                  onClick={() => setActiveTab(index)}
                  className={`relative h-full flex-1 items-center justify-center whitespace-nowrap px-3 font-medium font-season text-[var(--landing-text-dark)] text-caption uppercase lg:px-0 lg:text-sm${tab.hideOnMobile ? ' hidden lg:flex' : ' flex'}${index > 0 ? ' border-[var(--divider)] border-l' : ''}`}
                  style={{ backgroundColor: index === activeTab ? '#FDFDFD' : '#F6F6F6' }}
                >
                  {tab.mobileLabel ? (
                    <>
                      <span className='lg:hidden'>{tab.mobileLabel}</span>
                      <span className='hidden lg:inline'>{tab.label}</span>
                    </>
                  ) : (
                    tab.label
                  )}
                  {index === activeTab && (
                    <div className='absolute right-0 bottom-0 left-0 flex h-[6px]'>
                      {tab.segments.map(([opacity, width], i) => (
                        <div
                          key={i}
                          className='h-full shrink-0'
                          style={{
                            width: `${width}%`,
                            backgroundColor: tab.color,
                            opacity,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>

            <div className='h-full shrink-0'>
              <div className='h-full lg:hidden'>
                <DotGrid cols={3} rows={8} width={24} />
              </div>
              <div className='hidden h-full lg:block'>
                <DotGrid cols={10} rows={8} width={80} />
              </div>
            </div>
          </div>

          <div className='mt-8 flex flex-col gap-6 px-6 lg:mt-[60px] lg:grid lg:grid-cols-[1fr_2.8fr] lg:gap-[60px] lg:px-[120px]'>
            <div className='flex flex-col items-start justify-between gap-6 pt-5 lg:h-[560px] lg:gap-0'>
              <div className='flex flex-col items-start gap-4'>
                <h3 className='font-[430] font-season text-[24px] text-[var(--landing-text-dark)] leading-[120%] tracking-[-0.02em] lg:text-[28px]'>
                  {FEATURE_TABS[activeTab].title}
                </h3>
                <p className='font-[430] font-season text-[color-mix(in_srgb,var(--landing-text-dark)_50%,transparent)] text-md leading-[150%] tracking-[0.02em] lg:text-lg'>
                  {FEATURE_TABS[activeTab].description}
                </p>
              </div>
              <Link
                href='/signup'
                className='group/cta inline-flex h-[32px] items-center gap-1.5 rounded-[5px] border border-[#1D1D1D] bg-[#1D1D1D] px-2.5 font-[430] font-season text-sm text-white transition-colors hover:border-[var(--landing-bg-elevated)] hover:bg-[var(--landing-bg-elevated)]'
              >
                {FEATURE_TABS[activeTab].cta}
                <span className='relative h-[10px] w-[10px] shrink-0'>
                  <ChevronDown className='-rotate-90 absolute inset-0 h-[10px] w-[10px] transition-opacity duration-150 group-hover/cta:opacity-0' />
                  <svg
                    className='absolute inset-0 h-[10px] w-[10px] opacity-0 transition-opacity duration-150 group-hover/cta:opacity-100'
                    viewBox='0 0 10 10'
                    fill='none'
                  >
                    <path
                      d='M1 5H8M5.5 2L8.5 5L5.5 8'
                      stroke='currentColor'
                      strokeWidth='1.33'
                      strokeLinecap='square'
                      strokeLinejoin='miter'
                      fill='none'
                    />
                  </svg>
                </span>
              </Link>
            </div>

            <FeaturesPreview activeTab={activeTab} />
          </div>

          <div aria-hidden='true' className='mt-[60px] hidden h-px bg-[var(--divider)] lg:block' />
        </div>
      </div>
    </section>
  )
}
