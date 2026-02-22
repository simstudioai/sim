'use client'

import { useRef, useState } from 'react'
import { type MotionValue, motion, useScroll, useTransform } from 'framer-motion'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Badge, ChevronDown } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { TEMPLATE_WORKFLOWS } from '@/app/(home)/components/templates/template-workflows'

const LandingPreviewWorkflow = dynamic(
  () =>
    import(
      '@/app/(home)/components/landing-preview/components/landing-preview-workflow/landing-preview-workflow'
    ).then((mod) => mod.LandingPreviewWorkflow),
  {
    ssr: false,
    loading: () => <div className='h-full w-full bg-[#1b1b1b]' />,
  }
)

function hexToRgba(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

const LEFT_WALL_CLIP = 'polygon(0 8px, 100% 0, 100% 100%, 0 100%)'
const BOTTOM_WALL_CLIP = 'polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0 100%)'

interface DepthConfig {
  color: string
  segments: readonly (readonly [opacity: number, width: number])[]
}

/** Depth color and gradient segment pattern per template. Segments are `[opacity, width%]` tuples. */
const DEPTH_CONFIGS: Record<string, DepthConfig> = {
  'tpl-ocr-invoice': {
    color: '#2ABBF8',
    segments: [
      [0.3, 10],
      [0.5, 8],
      [0.8, 6],
      [1, 5],
      [0.4, 12],
      [0.7, 8],
      [1, 6],
      [0.5, 10],
      [0.9, 7],
      [0.6, 12],
      [1, 8],
      [0.35, 8],
    ],
  },
  'tpl-github-release': {
    color: '#00F701',
    segments: [
      [0.4, 8],
      [0.7, 6],
      [1, 5],
      [0.5, 14],
      [0.85, 8],
      [0.3, 12],
      [1, 6],
      [0.6, 10],
      [0.9, 7],
      [0.45, 8],
      [1, 8],
      [0.7, 8],
    ],
  },
  'tpl-meeting-followup': {
    color: '#FFCC02',
    segments: [
      [0.5, 12],
      [0.8, 6],
      [0.35, 10],
      [1, 5],
      [0.6, 8],
      [0.9, 7],
      [0.4, 14],
      [1, 6],
      [0.7, 10],
      [0.5, 8],
      [1, 6],
      [0.3, 8],
    ],
  },
  'tpl-cv-scanner': {
    color: '#FA4EDF',
    segments: [
      [0.35, 6],
      [0.6, 10],
      [0.9, 5],
      [1, 6],
      [0.4, 8],
      [0.75, 12],
      [0.5, 7],
      [1, 5],
      [0.3, 10],
      [0.8, 8],
      [0.6, 9],
      [1, 6],
      [0.45, 8],
    ],
  },
  'tpl-email-triage': {
    color: '#FF6B2C',
    segments: [
      [0.4, 10],
      [0.7, 8],
      [1, 5],
      [0.5, 12],
      [0.85, 6],
      [0.3, 10],
      [1, 6],
      [0.6, 8],
      [0.9, 7],
      [0.4, 12],
      [1, 8],
      [0.65, 8],
    ],
  },
  'tpl-competitor-monitor': {
    color: '#6366F1',
    segments: [
      [0.3, 8],
      [0.55, 10],
      [0.8, 6],
      [1, 5],
      [0.4, 12],
      [0.7, 7],
      [0.9, 8],
      [0.5, 10],
      [1, 6],
      [0.35, 8],
      [0.75, 6],
      [1, 6],
      [0.6, 8],
    ],
  },
  'tpl-social-listening': {
    color: '#F43F5E',
    segments: [
      [0.5, 10],
      [0.8, 6],
      [0.4, 8],
      [1, 5],
      [0.6, 12],
      [0.35, 8],
      [0.9, 7],
      [1, 6],
      [0.5, 10],
      [0.75, 8],
      [0.4, 6],
      [1, 6],
      [0.65, 8],
    ],
  },
  'tpl-data-enrichment': {
    color: '#14B8A6',
    segments: [
      [0.35, 8],
      [0.6, 6],
      [0.9, 5],
      [0.4, 12],
      [1, 6],
      [0.7, 10],
      [0.5, 7],
      [0.85, 8],
      [1, 5],
      [0.3, 10],
      [0.65, 8],
      [1, 7],
      [0.5, 8],
    ],
  },
  'tpl-feedback-digest': {
    color: '#F59E0B',
    segments: [
      [0.4, 10],
      [0.65, 6],
      [0.9, 5],
      [0.5, 12],
      [1, 6],
      [0.35, 8],
      [0.75, 7],
      [1, 5],
      [0.6, 10],
      [0.85, 8],
      [0.45, 6],
      [1, 8],
      [0.55, 9],
    ],
  },
  'tpl-pr-review': {
    color: '#06B6D4',
    segments: [
      [0.35, 8],
      [0.7, 7],
      [1, 5],
      [0.45, 10],
      [0.8, 6],
      [0.3, 12],
      [1, 6],
      [0.55, 8],
      [0.9, 7],
      [0.4, 10],
      [1, 6],
      [0.65, 8],
      [0.5, 7],
    ],
  },
  'tpl-knowledge-qa': {
    color: '#84CC16',
    segments: [
      [0.5, 8],
      [0.75, 6],
      [0.4, 10],
      [1, 5],
      [0.6, 8],
      [0.85, 7],
      [0.35, 12],
      [1, 6],
      [0.7, 8],
      [0.45, 10],
      [0.9, 6],
      [1, 6],
      [0.55, 8],
    ],
  },
}

const SCROLL_BLOCK_RX = '2.59574'

/**
 * Two-row horizontal block strip for the scroll-driven reveal in the templates section.
 * Same structural pattern as the hero's top-right blocks with matching colours:
 * blue (left) → pink (middle) → green (right).
 */
const SCROLL_BLOCK_RECTS = [
  { opacity: 0.6, x: '-34.24', y: '0', width: '34.24', height: '16.86', fill: '#2ABBF8' },
  { opacity: 1, x: '-17.38', y: '0', width: '16.86', height: '16.86', fill: '#2ABBF8' },
  { opacity: 1, x: '0', y: '0', width: '16.86', height: '33.73', fill: '#2ABBF8' },
  { opacity: 0.6, x: '0', y: '0', width: '85.34', height: '16.86', fill: '#2ABBF8' },
  { opacity: 1, x: '0', y: '0', width: '16.86', height: '16.86', fill: '#2ABBF8' },
  { opacity: 0.6, x: '34.24', y: '0', width: '34.24', height: '33.73', fill: '#2ABBF8' },
  { opacity: 1, x: '34.24', y: '0', width: '16.86', height: '16.86', fill: '#2ABBF8' },
  { opacity: 1, x: '51.62', y: '16.86', width: '16.86', height: '16.86', fill: '#2ABBF8' },
  { opacity: 1, x: '68.48', y: '0', width: '54.65', height: '16.86', fill: '#FA4EDF' },
  { opacity: 0.6, x: '106.27', y: '0', width: '34.24', height: '33.73', fill: '#FA4EDF' },
  { opacity: 0.6, x: '106.27', y: '0', width: '51.10', height: '16.86', fill: '#FA4EDF' },
  { opacity: 1, x: '123.65', y: '16.86', width: '16.86', height: '16.86', fill: '#FA4EDF' },
  { opacity: 0.6, x: '157.37', y: '0', width: '34.24', height: '16.86', fill: '#FA4EDF' },
  { opacity: 1, x: '157.37', y: '0', width: '16.86', height: '16.86', fill: '#FA4EDF' },
  { opacity: 0.6, x: '209.0', y: '0', width: '68.48', height: '16.86', fill: '#00F701' },
  { opacity: 0.6, x: '209.14', y: '0', width: '16.86', height: '33.73', fill: '#00F701' },
  { opacity: 0.6, x: '243.23', y: '0', width: '34.24', height: '33.73', fill: '#00F701' },
  { opacity: 1, x: '243.23', y: '0', width: '16.86', height: '16.86', fill: '#00F701' },
  { opacity: 0.6, x: '260.10', y: '0', width: '34.04', height: '16.86', fill: '#00F701' },
  { opacity: 1, x: '260.61', y: '16.86', width: '16.86', height: '16.86', fill: '#00F701' },
] as const

const SCROLL_BLOCK_MAX_X = Math.max(...SCROLL_BLOCK_RECTS.map((r) => Number.parseFloat(r.x)))
const SCROLL_REVEAL_START = 0.05
const SCROLL_REVEAL_SPAN = 0.7
const SCROLL_FADE_IN = 0.03

function getScrollBlockThreshold(x: string): number {
  const normalized = Number.parseFloat(x) / SCROLL_BLOCK_MAX_X
  return SCROLL_REVEAL_START + (1 - normalized) * SCROLL_REVEAL_SPAN
}

interface ScrollBlockRectProps {
  scrollYProgress: MotionValue<number>
  rect: (typeof SCROLL_BLOCK_RECTS)[number]
}

/** Renders a single SVG rect whose opacity is driven by scroll progress. */
function ScrollBlockRect({ scrollYProgress, rect }: ScrollBlockRectProps) {
  const threshold = getScrollBlockThreshold(rect.x)
  const opacity = useTransform(
    scrollYProgress,
    [threshold, threshold + SCROLL_FADE_IN],
    [0, rect.opacity]
  )

  return (
    <motion.rect
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      rx={SCROLL_BLOCK_RX}
      fill={rect.fill}
      style={{ opacity }}
    />
  )
}

function buildBottomWallStyle(config: DepthConfig) {
  let pos = 0
  const stops: string[] = []
  for (const [opacity, width] of config.segments) {
    const c = hexToRgba(config.color, opacity)
    stops.push(`${c} ${pos}%`, `${c} ${pos + width}%`)
    pos += width
  }
  return {
    clipPath: BOTTOM_WALL_CLIP,
    background: `linear-gradient(135deg, ${stops.join(', ')})`,
  }
}

interface DotGridProps {
  className?: string
  cols: number
  rows: number
  gap?: number
}

function DotGrid({ className, cols, rows, gap = 0 }: DotGridProps) {
  return (
    <div
      aria-hidden='true'
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap,
        placeItems: 'center',
      }}
    >
      {Array.from({ length: cols * rows }, (_, i) => (
        <div key={i} className='h-[2px] w-[2px] rounded-full bg-[#2A2A2A]' />
      ))}
    </div>
  )
}

const TEMPLATES_PANEL_ID = 'templates-panel'

export default function Templates() {
  const sectionRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start 0.9', 'start 0.2'],
  })

  const activeWorkflow = TEMPLATE_WORKFLOWS[activeIndex]
  const activeDepth = DEPTH_CONFIGS[activeWorkflow.id]

  return (
    <section
      ref={sectionRef}
      id='templates'
      aria-labelledby='templates-heading'
      className='mt-[40px] mb-[80px]'
    >
      <p className='sr-only'>
        Sim includes {TEMPLATE_WORKFLOWS.length} pre-built workflow templates covering OCR
        processing, release management, meeting follow-ups, resume scanning, email triage,
        competitor monitoring, social listening, data enrichment, feedback analysis, code review,
        and knowledge base Q&amp;A. Each template connects real integrations and LLMs — pick one,
        customise it, and deploy in minutes.
      </p>

      <div className='bg-[#1C1C1C]'>
        <DotGrid
          className='border-[#2A2A2A] border-y bg-[#1C1C1C] p-[6px]'
          cols={120}
          rows={1}
          gap={6}
        />

        <div className='relative overflow-hidden'>
          <div
            aria-hidden='true'
            className='pointer-events-none absolute top-0 right-0 z-20 hidden lg:block'
          >
            <svg
              width={329}
              height={34}
              viewBox='-34 0 329 34'
              fill='none'
              xmlns='http://www.w3.org/2000/svg'
              className='h-auto w-full'
            >
              {SCROLL_BLOCK_RECTS.map((r, i) => (
                <ScrollBlockRect key={i} scrollYProgress={scrollYProgress} rect={r} />
              ))}
            </svg>
          </div>

          <div className='px-[80px] pt-[100px]'>
            <div className='flex flex-col items-start gap-[20px]'>
              <Badge
                variant='blue'
                size='md'
                dot
                className='font-season uppercase tracking-[0.02em] transition-colors duration-200'
                style={{
                  color: activeDepth.color,
                  backgroundColor: hexToRgba(activeDepth.color, 0.1),
                }}
              >
                Templates
              </Badge>

              <h2
                id='templates-heading'
                className='font-[430] font-season text-[40px] text-white leading-[100%] tracking-[-0.02em]'
              >
                Ship your agent in minutes
              </h2>

              <p className='font-[430] font-season text-[#F6F6F0]/50 text-[16px] leading-[125%] tracking-[0.02em]'>
                Pre-built templates for every use case—pick one, swap <br />
                models and tools to fit your stack, and deploy.
              </p>
            </div>
          </div>

          <div className='mt-[73px] flex border-[#2A2A2A] border-y'>
            <DotGrid
              className='w-[80px] shrink-0 overflow-hidden border-[#2A2A2A] border-r p-[6px]'
              cols={6}
              rows={55}
              gap={6}
            />

            <div className='flex min-w-0 flex-1'>
              <div
                role='tablist'
                aria-label='Workflow templates'
                className='flex w-[300px] shrink-0 flex-col border-[#2A2A2A] border-r'
              >
                {TEMPLATE_WORKFLOWS.map((workflow, index) => {
                  const isActive = index === activeIndex
                  return (
                    <button
                      key={workflow.id}
                      id={`template-tab-${index}`}
                      type='button'
                      role='tab'
                      aria-selected={isActive}
                      aria-controls={TEMPLATES_PANEL_ID}
                      onClick={() => setActiveIndex(index)}
                      className={cn(
                        'relative text-left',
                        isActive
                          ? 'z-10'
                          : 'flex items-center px-[12px] py-[10px] shadow-[inset_0_-1px_0_0_#2A2A2A] last:shadow-none hover:bg-[#232323]/50'
                      )}
                    >
                      {isActive ? (
                        (() => {
                          const depth = DEPTH_CONFIGS[workflow.id]
                          return (
                            <>
                              <div
                                className='absolute top-[-8px] bottom-0 left-0 w-2'
                                style={{
                                  clipPath: LEFT_WALL_CLIP,
                                  backgroundColor: hexToRgba(depth.color, 0.63),
                                }}
                              />
                              <div
                                className='absolute right-[-8px] bottom-0 left-2 h-2'
                                style={buildBottomWallStyle(depth)}
                              />
                              <div className='-translate-y-2 relative flex translate-x-2 items-center bg-[#242424] px-[12px] py-[10px] shadow-[inset_0_0_0_1.5px_#3E3E3E]'>
                                <span className='flex-1 font-[430] font-season text-[16px] text-white'>
                                  {workflow.name}
                                </span>
                                <ChevronDown
                                  className='-rotate-90 h-[11px] w-[11px] shrink-0'
                                  style={{ color: depth.color }}
                                />
                              </div>
                            </>
                          )
                        })()
                      ) : (
                        <span className='font-[430] font-season text-[#F6F6F0]/50 text-[16px]'>
                          {workflow.name}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              <div
                id={TEMPLATES_PANEL_ID}
                role='tabpanel'
                aria-labelledby={`template-tab-${activeIndex}`}
                className='relative hidden flex-1 lg:block'
              >
                <div aria-hidden='true' className='h-full'>
                  <LandingPreviewWorkflow
                    key={activeIndex}
                    workflow={activeWorkflow}
                    animate
                    fitViewOptions={{ padding: 0.15, maxZoom: 1.3 }}
                  />
                </div>
                <Link
                  href='/signup'
                  className='group/cta absolute top-[16px] right-[16px] z-10 inline-flex h-[32px] items-center gap-[6px] rounded-[5px] border border-[#33C482] bg-[#33C482] px-[10px] font-[430] font-season text-[14px] text-black transition-[filter] hover:brightness-110'
                >
                  Use template
                  <span className='relative h-[10px] w-[10px] shrink-0'>
                    <ChevronDown className='-rotate-90 absolute inset-0 h-[10px] w-[10px] transition-opacity duration-150 group-hover/cta:opacity-0' />
                    <svg
                      className='absolute inset-0 h-[10px] w-[10px] opacity-0 transition-opacity duration-150 group-hover/cta:opacity-100'
                      viewBox='0 0 10 10'
                      fill='none'
                      xmlns='http://www.w3.org/2000/svg'
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
            </div>

            <DotGrid
              className='w-[80px] shrink-0 overflow-hidden border-[#2A2A2A] border-l p-[6px]'
              cols={6}
              rows={55}
              gap={6}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
