'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/core/utils/cn'
import styles from '@/app/(landing)/components/hero/components/hero-visual/hero-visual.module.css'
import { StageHome } from '@/app/(landing)/components/hero/components/hero-visual/stage-home'
import {
  type KbStage,
  StageKb,
} from '@/app/(landing)/components/hero/components/hero-visual/stage-kb'
import { StageWorkflow } from '@/app/(landing)/components/hero/components/hero-visual/stage-workflow'
import {
  PROMPT_ATOMS,
  TYPE_MS_PER_ATOM,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

/**
 * Animated hero visual — the only client island in the hero, decorative and
 * `aria-hidden`. A single pointer cursor drives a looping product demo:
 *
 * it glides into the input and clicks; the prompt types itself out
 * (`@github`/`@Jira` as inline icon-chips); it moves to send and clicks; a
 * GitHub → Agent → Jira workflow rises in (the cursor hides while the agent
 * works); then a Knowledge Base create modal opens, files drop in from "Finder",
 * the cursor returns to click Create, and an embedding map builds itself —
 * before the whole thing loops.
 *
 * The cursor is one persistent element at this root. Each beat it measures its
 * real DOM target (the input, the send button, the Create button) relative to
 * this container and tweens there along a quadratic Bézier (control point lifted
 * perpendicular to the path) with `easeInOutCubic` — so it arcs like a hand
 * rather than sliding in a straight line. The tween is driven by
 * `requestAnimationFrame`, writing the transform imperatively to avoid per-frame
 * React renders. `prefers-reduced-motion` skips the timeline and shows a static
 * built-workflow frame.
 */

type Phase =
  | 'intro'
  | 'home'
  | 'clickInput'
  | 'typing'
  | 'toSend'
  | 'clickSend'
  | 'submit'
  | 'workflow'
  | 'workflowHold'
  | 'kbOpen'
  | 'kbDrop'
  | 'kbToCreate'
  | 'kbClickCreate'
  | 'kbEmbeddings'
  | 'kbHold'

const STEPS: Array<[Phase, number]> = [
  ['intro', 500],
  ['home', 650],
  ['clickInput', 360],
  ['typing', PROMPT_ATOMS.length * TYPE_MS_PER_ATOM + 300],
  ['toSend', 700],
  ['clickSend', 360],
  ['submit', 550],
  ['workflow', 1500],
  ['workflowHold', 1100],
  ['kbOpen', 1000],
  ['kbDrop', 1500],
  ['kbToCreate', 850],
  ['kbClickCreate', 420],
  ['kbEmbeddings', 2600],
  ['kbHold', 1400],
]

const HOME_PHASES = new Set<Phase>([
  'intro',
  'home',
  'clickInput',
  'typing',
  'toSend',
  'clickSend',
  'submit',
])
const WORKFLOW_PHASES = new Set<Phase>(['workflow', 'workflowHold'])
const KB_PHASES = new Set<Phase>([
  'kbOpen',
  'kbDrop',
  'kbToCreate',
  'kbClickCreate',
  'kbEmbeddings',
  'kbHold',
])
const CLICK_PHASES = new Set<Phase>(['clickInput', 'clickSend', 'kbClickCreate'])
/** The cursor steps off-screen while the agent builds and files drop. */
const HIDE_CURSOR_PHASES = new Set<Phase>(['workflow', 'workflowHold', 'kbOpen', 'kbDrop'])

/** Cursor hotspot offset within its SVG (the arrow tip), in px at the rendered size. */
const TIP_X = 6
const TIP_Y = 3

function kbStageFor(phase: Phase): KbStage {
  if (phase === 'kbOpen') return 'empty'
  if (phase === 'kbEmbeddings' || phase === 'kbHold') return 'embeddings'
  return 'files'
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

export function HeroVisual() {
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLDivElement>(null)
  const sendRef = useRef<HTMLDivElement>(null)
  const createRef = useRef<HTMLSpanElement>(null)
  const cursorElRef = useRef<HTMLDivElement>(null)
  const cursorPosRef = useRef({ x: 0, y: 0 })
  const rafRef = useRef<number | undefined>(undefined)

  const [phase, setPhase] = useState<Phase>('intro')
  const [typedCount, setTypedCount] = useState(0)
  const [ready, setReady] = useState(false)

  const animateCursorTo = useCallback((tx: number, ty: number, snap: boolean) => {
    const el = cursorElRef.current
    if (!el) return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    const start = cursorPosRef.current
    const dx = tx - start.x
    const dy = ty - start.y
    const distance = Math.hypot(dx, dy)

    const writeTransform = (x: number, y: number) => {
      el.style.transform = `translate(${x - TIP_X}px, ${y - TIP_Y}px)`
    }

    if (snap || distance < 1) {
      cursorPosRef.current = { x: tx, y: ty }
      writeTransform(tx, ty)
      return
    }

    const duration = Math.min(1000, Math.max(380, distance * 1.05))
    const mx = (start.x + tx) / 2
    const my = (start.y + ty) / 2
    const lift = Math.min(distance * 0.22, 70)
    let cx = mx + (-dy / distance) * lift
    let cy = my + (dx / distance) * lift
    if (cy > my) {
      cx = mx - (-dy / distance) * lift
      cy = my - (dx / distance) * lift
    }

    const startTime = performance.now()
    const frame = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1)
      const e = easeInOutCubic(t)
      const m = 1 - e
      const x = m * m * start.x + 2 * m * e * cx + e * e * tx
      const y = m * m * start.y + 2 * m * e * cy + e * e * ty
      cursorPosRef.current = { x, y }
      writeTransform(x, y)
      rafRef.current = t < 1 ? requestAnimationFrame(frame) : undefined
    }
    rafRef.current = requestAnimationFrame(frame)
  }, [])

  const positionCursor = useCallback(
    (target: Phase, snap: boolean) => {
      const container = containerRef.current
      if (!container) return
      const cr = container.getBoundingClientRect()

      let point: { x: number; y: number } | null = null
      if (target === 'intro') {
        point = { x: cr.width * 0.44, y: cr.height * 0.64 }
      } else if (target === 'home' || target === 'clickInput' || target === 'typing') {
        const r = inputRef.current?.getBoundingClientRect()
        if (r) point = { x: r.left - cr.left + 46, y: r.top - cr.top + r.height / 2 }
      } else if (target === 'toSend' || target === 'clickSend' || target === 'submit') {
        const r = sendRef.current?.getBoundingClientRect()
        if (r) point = { x: r.left - cr.left + r.width / 2, y: r.top - cr.top + r.height / 2 }
      } else if (
        target === 'kbToCreate' ||
        target === 'kbClickCreate' ||
        target === 'kbEmbeddings' ||
        target === 'kbHold'
      ) {
        const r = createRef.current?.getBoundingClientRect()
        if (r) point = { x: r.left - cr.left + r.width / 2, y: r.top - cr.top + r.height / 2 }
      }

      if (point) animateCursorTo(point.x, point.y, snap)
    },
    [animateCursorTo]
  )

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) {
      setTypedCount(PROMPT_ATOMS.length)
      setPhase('workflowHold')
      return
    }

    let stepIndex = 0
    let stepTimeout: ReturnType<typeof setTimeout>
    let typeInterval: ReturnType<typeof setInterval> | undefined

    const clearTyping = () => {
      if (typeInterval) {
        clearInterval(typeInterval)
        typeInterval = undefined
      }
    }

    const runStep = () => {
      const [nextPhase, duration] = STEPS[stepIndex]
      setPhase(nextPhase)
      clearTyping()

      if (nextPhase === 'intro' || nextPhase === 'home' || nextPhase === 'clickInput') {
        setTypedCount(0)
      } else if (nextPhase === 'typing') {
        setTypedCount(0)
        let typed = 0
        typeInterval = setInterval(() => {
          typed += 1
          setTypedCount(typed)
          if (typed >= PROMPT_ATOMS.length) clearTyping()
        }, TYPE_MS_PER_ATOM)
      }

      stepTimeout = setTimeout(() => {
        stepIndex = (stepIndex + 1) % STEPS.length
        runStep()
      }, duration)
    }

    runStep()

    return () => {
      clearTimeout(stepTimeout)
      clearTyping()
    }
  }, [])

  useLayoutEffect(() => {
    positionCursor(phase, phase === 'intro')
    if (!ready) setReady(true)
  }, [phase, positionCursor, ready])

  useEffect(() => {
    const onResize = () => positionCursor(phase, true)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [phase, positionCursor])

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    },
    []
  )

  const showHome = HOME_PHASES.has(phase)
  const showWorkflow = WORKFLOW_PHASES.has(phase)
  const showKb = KB_PHASES.has(phase)
  const showCursor = ready && !HIDE_CURSOR_PHASES.has(phase)
  const clicking = CLICK_PHASES.has(phase)

  return (
    <div ref={containerRef} aria-hidden='true' className='relative h-full w-full overflow-hidden'>
      {showHome && (
        <div
          className={cn(
            'absolute inset-0 transition-all duration-500 ease-out',
            phase === 'submit' ? '-translate-y-3 opacity-0' : 'translate-y-0 opacity-100'
          )}
        >
          <StageHome typedCount={typedCount} inputRef={inputRef} sendRef={sendRef} />
        </div>
      )}

      {showWorkflow && (
        <div className='absolute inset-0'>
          <StageWorkflow />
        </div>
      )}

      {showKb && (
        <div className='absolute inset-0'>
          <StageKb stage={kbStageFor(phase)} createRef={createRef} />
        </div>
      )}

      <div
        ref={cursorElRef}
        className='pointer-events-none absolute top-0 left-0 z-30 transition-opacity duration-200 ease-out'
        style={{ opacity: showCursor ? 1 : 0 }}
      >
        {clicking && (
          <span
            key={phase}
            className={cn(
              '-translate-x-1/2 -translate-y-1/2 absolute size-7 rounded-full border border-[var(--text-primary)]',
              styles.clickRing
            )}
            style={{ left: TIP_X, top: TIP_Y }}
          />
        )}
        <svg width='30' height='30' viewBox='0 0 24 24' fill='none'>
          <title>cursor</title>
          <path
            d='M4 2 L4 18 L8.2 13.8 L11 19.6 L13.4 18.5 L10.6 12.8 L16.4 12.8 Z'
            fill='var(--surface-2)'
            stroke='var(--text-primary)'
            strokeWidth='1.5'
            strokeLinejoin='round'
          />
        </svg>
      </div>
    </div>
  )
}
