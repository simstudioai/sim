'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Badge } from '@/components/emcn'

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
        <div key={i} className='h-[1.5px] w-[1.5px] rounded-full bg-[var(--landing-bg-elevated)]' />
      ))}
    </div>
  )
}

const CURSOR_KEYFRAMES = `
  @keyframes cursorVikhyath {
    0% { transform: translate(0, 0); }
    12% { transform: translate(120px, 10px); }
    24% { transform: translate(80px, 80px); }
    36% { transform: translate(-10px, 60px); }
    48% { transform: translate(-15px, -20px); }
    60% { transform: translate(100px, -40px); }
    72% { transform: translate(180px, 30px); }
    84% { transform: translate(50px, 50px); }
    100% { transform: translate(0, 0); }
  }
  @keyframes cursorAlexa {
    0% { transform: translate(0, 0); }
    14% { transform: translate(45px, -35px); }
    28% { transform: translate(-75px, 20px); }
    42% { transform: translate(25px, -50px); }
    57% { transform: translate(-65px, 15px); }
    71% { transform: translate(35px, -30px); }
    85% { transform: translate(-30px, -10px); }
    100% { transform: translate(0, 0); }
  }
  @media (prefers-reduced-motion: reduce) {
    @keyframes cursorVikhyath { 0%, 100% { transform: none; } }
    @keyframes cursorAlexa { 0%, 100% { transform: none; } }
  }
`

const CURSOR_ARROW_PATH =
  'M17.135 2.198L12.978 14.821C12.478 16.339 10.275 16.16 10.028 14.581L9.106 8.703C9.01 8.092 8.554 7.599 7.952 7.457L1.591 5.953C0 5.577 0.039 3.299 1.642 2.978L15.39 0.229C16.534 0 17.499 1.09 17.135 2.198Z'

const CURSOR_ARROW_MIRRORED_PATH =
  'M0.365 2.198L4.522 14.821C5.022 16.339 7.225 16.16 7.472 14.58L8.394 8.702C8.49 8.091 8.946 7.599 9.548 7.456L15.909 5.953C17.5 5.577 17.461 3.299 15.857 2.978L2.11 0.228C0.966 0 0.001 1.09 0.365 2.198Z'

function CursorArrow({ fill }: { fill: string }) {
  return (
    <svg width='23.15' height='21.1' viewBox='0 0 17.5 16.4' fill='none'>
      <path d={fill === '#2ABBF8' ? CURSOR_ARROW_PATH : CURSOR_ARROW_MIRRORED_PATH} fill={fill} />
    </svg>
  )
}

function VikhyathCursor() {
  return (
    <div
      aria-hidden='true'
      className='pointer-events-none absolute'
      style={{
        top: '27.47%',
        left: '25%',
        animation: 'cursorVikhyath 16s ease-in-out infinite',
        willChange: 'transform',
      }}
    >
      <div className='relative h-[37.14px] w-[79.18px]'>
        <div className='absolute top-0 left-[56.02px]'>
          <CursorArrow fill='#2ABBF8' />
        </div>
        <div className='-left-[4px] absolute top-4.5 flex items-center rounded bg-[#2ABBF8] px-[5px] py-[3px] font-[420] font-season text-[var(--landing-text-dark)] text-sm leading-[100%] tracking-[-0.02em]'>
          Vikhyath
        </div>
      </div>
    </div>
  )
}

function AlexaCursor() {
  return (
    <div
      aria-hidden='true'
      className='pointer-events-none absolute'
      style={{
        top: '66.80%',
        left: '49%',
        animation: 'cursorAlexa 13s ease-in-out infinite',
        willChange: 'transform',
      }}
    >
      <div className='relative h-[35.09px] w-[62.16px]'>
        <div className='absolute top-0 left-0'>
          <CursorArrow fill='#FFCC02' />
        </div>
        <div className='absolute top-4 left-[23px] flex items-center rounded bg-[#FFCC02] px-[5px] py-[3px] font-[420] font-season text-[var(--landing-text-dark)] text-sm leading-[100%] tracking-[-0.02em]'>
          Alexa
        </div>
      </div>
    </div>
  )
}

interface YouCursorProps {
  x: number
  y: number
  visible: boolean
}

function YouCursor({ x, y, visible }: YouCursorProps) {
  if (!visible) return null

  return (
    <div
      aria-hidden='true'
      className='pointer-events-none fixed z-50'
      style={{
        left: x,
        top: y,
        transform: 'translate(-2px, -2px)',
      }}
    >
      <svg width='23.15' height='21.1' viewBox='0 0 17.5 16.4' fill='none'>
        <path d={CURSOR_ARROW_MIRRORED_PATH} fill='#33C482' />
      </svg>
      <div className='absolute top-4 left-[23px] flex items-center rounded bg-[var(--brand-accent)] px-[5px] py-[3px] font-[420] font-season text-[var(--landing-text-dark)] text-sm leading-[100%] tracking-[-0.02em]'>
        You
      </div>
    </div>
  )
}

/**
 * Collaboration section — team workflows and real-time collaboration.
 *
 * SEO:
 * - `<section id="collaboration" aria-labelledby="collaboration-heading">`.
 * - `<h2 id="collaboration-heading">` for the section title.
 * - Product visuals use `<figure>` with `<figcaption>` and descriptive `alt` text.
 *
 * GEO:
 * - Name specific capabilities (version control, shared workspaces, RBAC, audit logs).
 * - Lead with a summary so AI can answer "Does Sim support team collaboration?".
 * - Reference "Sim" by name per capability ("Sim's real-time collaboration").
 */

const CURSOR_LERP_FACTOR = 0.3

export default function Collaboration() {
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 })
  const [isHovering, setIsHovering] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const targetPos = useRef({ x: 0, y: 0 })
  const animationRef = useRef<number>(0)

  useEffect(() => {
    const animate = () => {
      setCursorPos((prev) => ({
        x: prev.x + (targetPos.current.x - prev.x) * CURSOR_LERP_FACTOR,
        y: prev.y + (targetPos.current.y - prev.y) * CURSOR_LERP_FACTOR,
      }))
      animationRef.current = requestAnimationFrame(animate)
    }

    if (isHovering) {
      animationRef.current = requestAnimationFrame(animate)
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isHovering])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    targetPos.current = { x: e.clientX, y: e.clientY }
  }, [])

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    targetPos.current = { x: e.clientX, y: e.clientY }
    setCursorPos({ x: e.clientX, y: e.clientY })
    setIsHovering(true)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false)
  }, [])

  return (
    <section
      ref={sectionRef}
      id='collaboration'
      aria-labelledby='collaboration-heading'
      className='bg-[var(--landing-bg)]'
      style={{ cursor: isHovering ? 'none' : 'auto' }}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <YouCursor x={cursorPos.x} y={cursorPos.y} visible={isHovering} />
      <style dangerouslySetInnerHTML={{ __html: CURSOR_KEYFRAMES }} />

      <DotGrid
        className='overflow-hidden border-[var(--landing-bg-elevated)] border-y bg-[var(--landing-bg)] p-1.5'
        cols={120}
        rows={1}
        gap={6}
      />

      <div className='relative overflow-hidden'>
        <div className='grid grid-cols-1 md:grid-cols-[auto_1fr]'>
          <div className='flex flex-col items-start gap-3 px-4 pt-[60px] pb-8 sm:gap-4 sm:px-8 md:gap-5 md:px-16 md:pt-[100px]'>
            <Badge
              variant='blue'
              size='md'
              dot
              className='bg-[color-mix(in_srgb,var(--brand-accent)_10%,transparent)] font-season text-[var(--brand-accent)] uppercase tracking-[0.02em]'
            >
              Teams
            </Badge>

            <h2
              id='collaboration-heading'
              className='text-balance font-[430] font-season text-[32px] text-white leading-[100%] tracking-[-0.02em] sm:text-[36px] md:text-[40px]'
            >
              Realtime
              <br />
              collaboration
            </h2>

            <p className='sr-only'>
              Sim supports real-time multiplayer collaboration. Teams can build AI agents together
              in a shared workspace with live cursors, presence indicators, and concurrent editing.
              Features include role-based access control, shared workflows, and team workspace
              management.
            </p>

            <p className='font-[430] font-season text-[#F6F6F0]/50 text-base leading-[150%] tracking-[0.02em] md:text-lg'>
              Grab your team. Build agents together <br className='hidden md:block' />
              in real-time inside your workspace.
            </p>

            <Link
              href='/signup'
              className='group/cta mt-3 inline-flex h-[32px] cursor-none items-center gap-1.5 rounded-[5px] border border-white bg-white px-2.5 font-[430] font-season text-black text-sm transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]'
            >
              Build together
              <svg
                className='h-[10px] w-[10px] shrink-0'
                viewBox='0 0 10 10'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
              >
                <line
                  x1='0'
                  y1='5'
                  x2='9'
                  y2='5'
                  stroke='currentColor'
                  strokeWidth='1.33'
                  strokeLinecap='square'
                  className='origin-left scale-x-0 transition-transform duration-200 ease-out [transform-box:fill-box] group-hover/cta:scale-x-100'
                />
                <path
                  d='M3.5 2L6.5 5L3.5 8'
                  stroke='currentColor'
                  strokeWidth='1.33'
                  strokeLinecap='square'
                  strokeLinejoin='miter'
                  fill='none'
                  className='transition-transform duration-200 ease-out group-hover/cta:translate-x-[30%]'
                />
              </svg>
            </Link>
          </div>

          <figure className='pointer-events-none relative h-[220px] w-full md:h-[600px]'>
            <div className='md:-left-[18%] -top-[10%] absolute inset-y-0 left-[7%] min-w-full md:top-0'>
              <Image
                src='/landing/collaboration-visual.svg'
                alt='Collaboration visual showing team workflows with real-time editing, shared cursors, and version control interface'
                width={876}
                height={480}
                className='h-full w-auto object-left md:min-w-[100vw]'
              />
            </div>
            <div className='hidden lg:block'>
              <VikhyathCursor />
              <AlexaCursor />
            </div>
            <figcaption className='sr-only'>
              Sim collaboration interface with real-time cursors, shared workspace, and team
              presence indicators
            </figcaption>
          </figure>
        </div>

        <Link
          href='/blog/multiplayer'
          target='_blank'
          rel='noopener noreferrer'
          className='relative mx-4 mb-6 flex cursor-none items-center gap-3.5 rounded-[5px] border border-[var(--landing-bg-elevated)] bg-[var(--landing-bg)] px-3 py-2.5 transition-colors hover:border-[var(--landing-border-strong)] hover:bg-[var(--landing-bg-card)] sm:mx-8 md:absolute md:bottom-10 md:left-16 md:z-20 md:mx-0 md:mb-0'
        >
          <div className='relative h-7 w-11 shrink-0'>
            <Image src='/landing/multiplayer-cursors.svg' alt='' fill className='object-contain' />
          </div>
          <div className='flex flex-col gap-0.5'>
            <span className='font-[430] font-season text-[#F6F6F0]/50 text-caption uppercase leading-[100%] tracking-[0.08em]'>
              Blog
            </span>
            <span className='font-[430] font-season text-[#F6F6F0] text-sm leading-[125%] tracking-[0.02em]'>
              How we built realtime collaboration
            </span>
          </div>
        </Link>
      </div>

      <DotGrid
        className='overflow-hidden border-[var(--landing-bg-elevated)] border-y bg-[var(--landing-bg)] p-1.5'
        cols={120}
        rows={1}
        gap={6}
      />
    </section>
  )
}
