'use client'

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { ThinkingLoader } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import styles from '@/app/(landing)/components/hero/components/hero-visual/hero-visual.module.css'
import {
  type HomeMode,
  StageHome,
} from '@/app/(landing)/components/hero/components/hero-visual/stage-home'
import {
  type KbStage,
  StageKb,
} from '@/app/(landing)/components/hero/components/hero-visual/stage-kb'
import { WorkflowBlock } from '@/app/(landing)/components/hero/components/hero-visual/workflow-block'
import {
  ANSWER_MS_PER_CHAR,
  ANSWER_TEXT,
  BLOCK_WIDTH,
  PROMPT_ATOMS,
  SCENE_EDGES,
  SCENE_OVERVIEW_SCALE,
  SCENE_OVERVIEW_TRANSLATE,
  SCENE_SATELLITES,
  TYPE_MS_PER_ATOM,
  WORKFLOW_FOCUS_SCALE,
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
  | 'boot'
  | 'bootSettle'
  | 'zoomReveal'
  | 'zoomArrow'
  | 'zoomOut'
  | 'home'
  | 'clickInput'
  | 'typing'
  | 'toSend'
  | 'clickSend'
  | 'submit'
  | 'thinking'
  | 'answer'
  | 'answerHold'
  | 'morph'
  | 'blockFocus'
  | 'cameraOut'
  | 'workflowHold'
  | 'kbOpen'
  | 'kbDrop'
  | 'kbToCreate'
  | 'kbClickCreate'
  | 'kbEmbeddings'
  | 'kbHold'

const STEPS: Array<[Phase, number]> = [
  ['boot', 2000],
  ['bootSettle', 650],
  ['zoomReveal', 500],
  ['zoomArrow', 600],
  ['zoomOut', 700],
  ['home', 650],
  ['clickInput', 360],
  ['typing', PROMPT_ATOMS.length * TYPE_MS_PER_ATOM + 300],
  ['toSend', 700],
  ['clickSend', 360],
  ['submit', 620],
  ['thinking', 1700],
  ['answer', ANSWER_TEXT.length * ANSWER_MS_PER_CHAR + 500],
  ['answerHold', 700],
  ['morph', 900],
  ['blockFocus', 1200],
  ['cameraOut', 1900],
  ['workflowHold', 1100],
  ['kbOpen', 1000],
  ['kbDrop', 1500],
  ['kbToCreate', 850],
  ['kbClickCreate', 420],
  ['kbEmbeddings', 2600],
  ['kbHold', 1400],
]

const HOME_PHASES = new Set<Phase>([
  'boot',
  'bootSettle',
  'zoomReveal',
  'zoomArrow',
  'zoomOut',
  'home',
  'clickInput',
  'typing',
  'toSend',
  'clickSend',
  'submit',
  'thinking',
  'answer',
  'answerHold',
  'morph',
])
/** Compose beats where the greeting headline is shown — after the boot zoom has
 * fully settled the input, never during boot/zoom. */
const GREETING_PHASES = new Set<Phase>([
  'home',
  'clickInput',
  'typing',
  'toSend',
  'clickSend',
])
const WORKFLOW_PHASES = new Set<Phase>(['blockFocus', 'cameraOut', 'workflowHold'])
const KB_PHASES = new Set<Phase>([
  'kbOpen',
  'kbDrop',
  'kbToCreate',
  'kbClickCreate',
  'kbEmbeddings',
  'kbHold',
])
const CLICK_PHASES = new Set<Phase>(['clickInput', 'clickSend', 'kbClickCreate'])
/** The cursor steps off-screen while the Mothership thinks, replies, and builds. */
const HIDE_CURSOR_PHASES = new Set<Phase>([
  'boot',
  'bootSettle',
  'zoomReveal',
  'zoomArrow',
  'zoomOut',
  'submit',
  'thinking',
  'answer',
  'answerHold',
  'morph',
  'blockFocus',
  'cameraOut',
  'workflowHold',
  'kbOpen',
  'kbDrop',
])

/** Cursor hotspot offset within its SVG (the arrow tip), in px at the rendered size. */
const TIP_X = 6
const TIP_Y = 3

/** How far the boot sequence zooms into the send button before zooming out. */
const ZOOM_SCALE = 2.6

/**
 * Flat `#383838` ink with no glow — the chat send button's fill. Applied to the
 * boot loader only once it settles, so its brand gradient melts into the send
 * button's color exactly as it morphs into that circle (the loader's CSS tweens
 * `stop-color`/`flood-color`). The cycling boot loader keeps its gradient.
 */
const SEND_BUTTON_INK = {
  '--tl-grad-inner': '#383838',
  '--tl-grad-outer': '#383838',
  '--tl-glow': 'transparent',
} as CSSProperties

function kbStageFor(phase: Phase): KbStage {
  if (phase === 'kbOpen') return 'empty'
  if (phase === 'kbEmbeddings' || phase === 'kbHold') return 'embeddings'
  return 'files'
}

function homeModeFor(phase: Phase): HomeMode {
  if (phase === 'submit' || phase === 'thinking') return 'thinking'
  if (phase === 'answer' || phase === 'answerHold') return 'answering'
  // The card stays the GitHub block through the whole workflow pull-out — it IS
  // block 1 of the scene, never unmounting.
  if (
    phase === 'morph' ||
    phase === 'blockFocus' ||
    phase === 'cameraOut' ||
    phase === 'workflowHold'
  ) {
    return 'block'
  }
  return 'compose'
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
  const zoomOriginRef = useRef('50% 50%')

  const [phase, setPhase] = useState<Phase>('boot')
  const [typedCount, setTypedCount] = useState(0)
  const [answerTypedCount, setAnswerTypedCount] = useState(0)
  const [zoomStyle, setZoomStyle] = useState<CSSProperties | undefined>(undefined)
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
      if (target === 'boot' || target === 'bootSettle' || target === 'zoomOut') {
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

      if (nextPhase === 'boot' || nextPhase === 'home' || nextPhase === 'clickInput') {
        setTypedCount(0)
        setAnswerTypedCount(0)
      } else if (nextPhase === 'typing') {
        setTypedCount(0)
        let typed = 0
        typeInterval = setInterval(() => {
          typed += 1
          setTypedCount(typed)
          if (typed >= PROMPT_ATOMS.length) clearTyping()
        }, TYPE_MS_PER_ATOM)
      } else if (nextPhase === 'thinking') {
        setAnswerTypedCount(0)
      } else if (nextPhase === 'answer') {
        let typed = 0
        typeInterval = setInterval(() => {
          typed += 1
          setAnswerTypedCount(typed)
          if (typed >= ANSWER_TEXT.length) clearTyping()
        }, ANSWER_MS_PER_CHAR)
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
    positionCursor(phase, phase === 'boot')
    if (!ready) setReady(true)
  }, [phase, positionCursor, ready])

  // Boot zoom: hold the chat card zoomed into its send button, then zoom out to
  // the full card. Measured ONCE at `zoomReveal` — the card is already mounted
  // (rendered hidden during `boot`), so the send button's geometry is settled
  // and un-zoomed at this point. `zoomArrow` keeps that same zoom (no remeasure
  // off the already-transformed button); `zoomOut` animates back to identity
  // about the same origin so the send button stays put as the card unfolds.
  useLayoutEffect(() => {
    if (phase === 'zoomReveal') {
      const container = containerRef.current
      const sendEl = sendRef.current
      if (!container || !sendEl) return
      const cr = container.getBoundingClientRect()
      const sr = sendEl.getBoundingClientRect()
      // Guard an unpainted/collapsed layout (width ~0) from poisoning the zoom.
      if (cr.width < 120) return
      const px = sr.left - cr.left + sr.width / 2
      const py = sr.top - cr.top + sr.height / 2
      const origin = `${px}px ${py}px`
      zoomOriginRef.current = origin
      setZoomStyle({
        transform: `translate(${cr.width / 2 - px}px, ${cr.height / 2 - py}px) scale(${ZOOM_SCALE})`,
        transformOrigin: origin,
      })
    } else if (phase === 'zoomOut') {
      setZoomStyle({
        transform: 'translate(0px, 0px) scale(1)',
        transformOrigin: zoomOriginRef.current,
      })
    } else if (phase !== 'zoomArrow') {
      setZoomStyle(undefined)
    }
  }, [phase])

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

  const showBoot =
    phase === 'boot' ||
    phase === 'bootSettle' ||
    phase === 'zoomReveal' ||
    phase === 'zoomArrow'
  // The card (block 1) is mounted through the chat AND the whole workflow — it
  // never unmounts, so it continuously becomes the GitHub block.
  const showCard = HOME_PHASES.has(phase) || WORKFLOW_PHASES.has(phase)
  // Satellites only during the pull-out — at focus the first block stands alone
  // (they'd otherwise peek in at this zoom), then the camera reveals them.
  const showSatellites = phase === 'cameraOut' || phase === 'workflowHold'
  const showKb = KB_PHASES.has(phase)
  const showCursor = ready && !HIDE_CURSOR_PHASES.has(phase)
  const clicking = CLICK_PHASES.has(phase)

  // The scene "camera": identity while focused on the first block (chat/morph/
  // focus), then a single scale+translate that pulls back to the whole workflow.
  const sceneOverview = phase === 'cameraOut' || phase === 'workflowHold'
  const sceneTransform = sceneOverview
    ? `translate(${SCENE_OVERVIEW_TRANSLATE.x}px, ${SCENE_OVERVIEW_TRANSLATE.y}px) scale(${SCENE_OVERVIEW_SCALE})`
    : undefined
  const edgesDrawn = sceneOverview

  return (
    <div ref={containerRef} aria-hidden='true' className='relative h-full w-full overflow-hidden'>
      {showBoot && (
        <div
          className={cn(
            'absolute inset-0 z-20 flex items-center justify-center transition-opacity duration-[400ms] ease-[cubic-bezier(0.23,1,0.32,1)]',
            // Hold the loader through the zoomed-in reveal, then dissolve it at
            // zoomArrow so the identical send-button disc underneath takes over.
            phase === 'zoomArrow' ? 'opacity-0' : 'opacity-100'
          )}
        >
          <ThinkingLoader
            size={80}
            startVariant='corners'
            settle={phase !== 'boot'}
            // Keep the brand gradient while cycling; once it settles, melt the
            // ink into the send button's flat color as it morphs into that disc.
            style={phase === 'boot' ? undefined : SEND_BUTTON_INK}
          />
        </div>
      )}

      {/* The scene: ONE coordinate space holding block 1 (the persistent chat
          card) plus the workflow satellites + edges. The "camera" pull-out is a
          single transform on this whole scene, so the card is continuously the
          GitHub block. FOCUS is the identity transform (block 1 centered); only
          the pull-out animates. */}
      <div
        className='absolute inset-0 transition-transform duration-[1700ms] ease-[cubic-bezier(0.22,1,0.36,1)]'
        style={{ transform: sceneTransform, transformOrigin: 'center' }}
      >
        {showCard && (
          <div
            className={cn(
              'absolute inset-0 transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]',
              // Stays visible through answer → morph → workflow: the card itself
              // becomes block 1 (no fade-out), so don't hide it here.
              phase === 'boot' || phase === 'bootSettle'
                ? 'opacity-0'
                : 'translate-y-0 scale-100 opacity-100'
            )}
          >
            <div
              className={cn(
                'h-full w-full',
                phase === 'zoomOut' &&
                  'transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]'
              )}
              style={zoomStyle}
            >
              <StageHome
                mode={homeModeFor(phase)}
                typedCount={typedCount}
                answerTypedCount={answerTypedCount}
                inputRef={inputRef}
                sendRef={sendRef}
                arrowHidden={
                  phase === 'boot' || phase === 'bootSettle' || phase === 'zoomReveal'
                }
                showGreeting={GREETING_PHASES.has(phase)}
              />
            </div>
          </div>
        )}

        {showSatellites && (
          <>
            {/* Edges (scene space, origin = panel center). Drawn as the camera
                pulls out, so the line appears to lead to each revealed block. */}
            <svg
              className='absolute top-1/2 left-1/2 overflow-visible'
              width='1'
              height='1'
              fill='none'
              aria-hidden='true'
            >
              {SCENE_EDGES.map((edge, i) => (
                <path
                  key={edge.id}
                  d={edge.d}
                  pathLength={1}
                  stroke='var(--workflow-edge)'
                  strokeWidth={2 * WORKFLOW_FOCUS_SCALE}
                  strokeLinecap='round'
                  className='[stroke-dasharray:1] transition-[stroke-dashoffset] duration-[700ms] ease-[cubic-bezier(0.22,1,0.36,1)]'
                  style={
                    {
                      strokeDashoffset: edgesDrawn ? 0 : 1,
                      transitionDelay: `${i * 700}ms`,
                    } as CSSProperties
                  }
                />
              ))}
            </svg>

            {/* Satellite blocks (2…N), placed relative to the centered block 1
                at FOCUS scale; off-screen until the camera pulls back. */}
            {SCENE_SATELLITES.map(({ block, left, top }) => (
              <div
                key={block.id}
                className='absolute'
                style={{
                  left: `calc(50% + ${left}px)`,
                  top: `calc(50% + ${top}px)`,
                  width: BLOCK_WIDTH,
                  transform: `scale(${WORKFLOW_FOCUS_SCALE})`,
                  transformOrigin: 'top left',
                }}
              >
                <WorkflowBlock block={block} />
              </div>
            ))}
          </>
        )}
      </div>

      {showKb && (
        <div className={cn('absolute inset-0', styles.stageFade)}>
          <StageKb stage={kbStageFor(phase)} createRef={createRef} />
        </div>
      )}

      <div
        ref={cursorElRef}
        className='pointer-events-none absolute top-0 left-0 z-30 transition-opacity duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]'
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
