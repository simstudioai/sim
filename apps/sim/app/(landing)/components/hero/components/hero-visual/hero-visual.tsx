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
 * (`@github`/`@Jira` as inline icon-chips); it moves to send and clicks; the
 * camera smoothly zooms into the send button and HOLDS there while the disc
 * morphs into the gooey thinking loader and cycles through several shapes; then —
 * still zoomed — the loader slides to the reply slot on the left with the camera
 * panning to follow it (no zoom-out), docks, and calls out the world phrases;
 * only once the Mothership starts typing its reply does the camera zoom back out
 * to the full chat. The card then morphs into a GitHub → Agent → Jira workflow
 * (the cursor hides while the agent works); then a Knowledge Base create modal
 * opens, files drop in from "Finder", the cursor returns to click Create, and an
 * embedding map builds itself — before the whole thing loops.
 *
 * Two elements are driven imperatively (writing transforms per `requestAnimation
 * Frame` to avoid per-frame React renders):
 * - The cursor measures its real DOM target (input, send button, Create button)
 *   and arcs there along a quadratic Bézier (control point lifted perpendicular)
 *   eased with `easeInOutCubic`, so it moves like a hand, not a slide.
 * - The thinking loader lives at THIS root (not in the card) so it can outlive the
 *   chat layers and stay glued to its target — the send button, then the reply
 *   slot — through the camera zoom, pan, and zoom-out, regardless of how the card
 *   reshapes beneath it. Each frame it measures its target's on-screen rect and
 *   matches its position and size; during the slide it lerps between the two.
 *
 * `prefers-reduced-motion` skips the timeline and shows a static built-workflow
 * frame.
 */

type Phase =
  | 'home'
  | 'clickInput'
  | 'typing'
  | 'toSend'
  | 'zoomSend'
  | 'clickSend'
  | 'discMorph'
  | 'cycleHold'
  | 'loaderSlide'
  | 'phrases'
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

/** Duration of the loader's send→reply slide; the camera pan + lerp share it. */
const LOADER_SLIDE_MS = 1200

const STEPS: Array<[Phase, number]> = [
  ['home', 900],
  ['clickInput', 360],
  ['typing', PROMPT_ATOMS.length * TYPE_MS_PER_ATOM + 400],
  ['toSend', 700],
  ['zoomSend', 900],
  ['clickSend', 480],
  ['discMorph', 640],
  ['cycleHold', 2200],
  ['loaderSlide', LOADER_SLIDE_MS],
  ['phrases', 2400],
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
  'home',
  'clickInput',
  'typing',
  'toSend',
  'zoomSend',
  'clickSend',
  'discMorph',
  'cycleHold',
  'loaderSlide',
  'phrases',
  'answer',
  'answerHold',
  'morph',
])
/** Compose beats where the greeting headline is shown — while the prompt is
 * being composed and sent, never once the conversation/loader takes over. */
const GREETING_PHASES = new Set<Phase>([
  'home',
  'clickInput',
  'typing',
  'toSend',
  'zoomSend',
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
/** The cursor steps off-screen while the camera pushes into the send button and
 * while the Mothership thinks, replies, and builds. */
const HIDE_CURSOR_PHASES = new Set<Phase>([
  'zoomSend',
  'discMorph',
  'cycleHold',
  'loaderSlide',
  'phrases',
  'answer',
  'answerHold',
  'morph',
  'blockFocus',
  'cameraOut',
  'workflowHold',
  'kbOpen',
  'kbDrop',
])
/** Beats the root thinking loader is mounted for — from the disc morph through
 * the slide and phrases, fading out as the reply types. */
const LOADER_PHASES = new Set<Phase>(['discMorph', 'cycleHold', 'loaderSlide', 'phrases', 'answer'])
/** Beats where the camera + loader are driven imperatively per frame (the held +
 * slide beats). `answer` is excluded — there the camera pulls out via state and
 * the loader is frozen, fading. */
const LOADER_PAINT_PHASES = new Set<Phase>(['discMorph', 'cycleHold', 'loaderSlide', 'phrases'])

/** Cursor hotspot offset within its SVG (the arrow tip), in px at the rendered size. */
const TIP_X = 6
const TIP_Y = 3

/** How far the camera zooms into the send button before the morph + zoom-out. */
const ZOOM_SCALE = 2.4

/** Base render size of the root loader, in px; the tracker scales it to its target. */
const LOADER_BASE = 28
/** Loader scale once it docks with its phrase — smaller than the disc-matched
 * zoom so the phrase text reads as a secondary indicator, not a headline. */
const LOADER_PHRASE_SCALE = 1.35

/**
 * Flat `#383838` ink with no glow — the chat send button's fill. Applied to the
 * root loader while it sits settled on the send button, so its orb reads as that
 * exact dark disc; dropped once it unsettles, and the loader's CSS tweens
 * `stop-color`/`flood-color` back to the brand gradient as it starts cycling.
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
  // `sending` (disc morph + cycle hold): compose layout, the send button hidden
  // under the root loader, card NOT reshaping while the camera holds on it.
  if (phase === 'discMorph' || phase === 'cycleHold') return 'sending'
  // The conversation appears as the loader leaves for the reply slot.
  if (phase === 'loaderSlide' || phase === 'phrases') return 'thinking'
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
  const dockRef = useRef<HTMLDivElement>(null)
  const createRef = useRef<HTMLSpanElement>(null)
  const cursorElRef = useRef<HTMLDivElement>(null)
  const cursorPosRef = useRef({ x: 0, y: 0 })
  const rafRef = useRef<number | undefined>(undefined)
  const initedRef = useRef(false)
  // Camera: the chat's zoom wrapper. `zoomSend`/`answer` drive it with React state
  // + a CSS transition (smooth push / pull); the held + slide beats in between
  // drive it imperatively (see `paintFrame`), locked frame-for-frame to the loader
  // so the camera can never outrun it. The origin (un-zoomed send center) and the
  // live translate are shared between the two regimes for a seamless handoff.
  const cameraElRef = useRef<HTMLDivElement>(null)
  const zoomOriginRef = useRef('50% 50%')
  const zoomOriginPxRef = useRef({ x: 0, y: 0 })
  const zoomTranslateRef = useRef({ x: 0, y: 0 })
  // The root loader, its per-frame target, and the on-screen anchors the slide
  // tweens between (captured when the slide begins).
  const loaderElRef = useRef<HTMLDivElement>(null)
  const loaderTrackRef = useRef<{ kind: 'send' | 'slide' | 'reply'; start: number }>({
    kind: 'send',
    start: 0,
  })
  const slideAnchorRef = useRef({ from: { x: 0, y: 0 }, to: { x: 0, y: 0 } })

  const [phase, setPhase] = useState<Phase>('home')
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
      if (target === 'home' || target === 'clickInput' || target === 'typing') {
        const r = inputRef.current?.getBoundingClientRect()
        if (r) point = { x: r.left - cr.left + 46, y: r.top - cr.top + r.height / 2 }
      } else if (target === 'toSend' || target === 'zoomSend' || target === 'clickSend') {
        // Measured live, so once the camera has zoomed the send button the cursor
        // lands on it at its enlarged on-screen position.
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

  // One frame of the held/slide camera + loader. The loader is placed at an
  // on-screen ANCHOR that tweens along a smooth path (its morph spot → a
  // below-centre spot, where the reply sits under the bubble); the camera is then
  // nudged so the loader's card target (the disc → the reply slot) sits under that
  // anchor — so the camera follows the loader, never leading it. Because the
  // loader rides the smooth anchor path directly, its motion never jerks even as
  // the card grows beneath it. Measure-and-write only; called every frame and once
  // synchronously per phase change (no first-frame flash).
  const paintFrame = useCallback(() => {
    const loaderEl = loaderElRef.current
    const cameraEl = cameraElRef.current
    const container = containerRef.current
    if (!loaderEl || !cameraEl || !container) return
    const cr = container.getBoundingClientRect()
    const O = zoomOriginPxRef.current
    const Ts = zoomTranslateRef.current

    const sendEl = sendRef.current?.getBoundingClientRect()
    const sendTarget = sendEl
      ? { x: sendEl.left - cr.left + sendEl.width / 2, y: sendEl.top - cr.top + sendEl.height / 2 }
      : null

    const write = (anchorX: number, anchorY: number, scale: number) => {
      cameraEl.style.transformOrigin = `${O.x}px ${O.y}px`
      cameraEl.style.transform = `translate(${Ts.x}px, ${Ts.y}px) scale(${ZOOM_SCALE})`
      loaderEl.style.transform = `translate(${anchorX}px, ${anchorY}px) scale(${scale})`
    }

    const track = loaderTrackRef.current

    // Held on the disc: loader sits on it at the disc-matched zoom; camera unchanged.
    if (track.kind === 'send') {
      if (!sendTarget) return
      write(sendTarget.x, sendTarget.y, ZOOM_SCALE)
      return
    }

    // Slide / docked: traverse to the dock at the LEFT of the same row (so the
    // move is purely horizontal — the card holds its size), the loader shrinking
    // from the disc size to its phrase size.
    const dockEl = dockRef.current?.getBoundingClientRect()
    if (!sendTarget || !dockEl) return
    const dockTarget = {
      x: dockEl.left - cr.left + dockEl.width / 2,
      y: dockEl.top - cr.top + dockEl.height / 2,
    }
    const { from, to } = slideAnchorRef.current
    const t =
      track.kind === 'reply'
        ? 1
        : easeInOutCubic(Math.min((performance.now() - track.start) / LOADER_SLIDE_MS, 1))

    const anchorX = from.x + (to.x - from.x) * t
    const anchorY = from.y + (to.y - from.y) * t
    const targetX = sendTarget.x + (dockTarget.x - sendTarget.x) * t
    const targetY = sendTarget.y + (dockTarget.y - sendTarget.y) * t
    const scale = ZOOM_SCALE + (LOADER_PHRASE_SCALE - ZOOM_SCALE) * t

    // Pan so the loader's card target sits under its anchor — the camera follows.
    Ts.x += anchorX - targetX
    Ts.y += anchorY - targetY
    write(anchorX, anchorY, scale)
  }, [])

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

      if (nextPhase === 'home' || nextPhase === 'clickInput') {
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
    // Snap the cursor into place on the very first paint (so it doesn't swoop in
    // from the corner); animate every beat after.
    positionCursor(phase, !initedRef.current)
    initedRef.current = true
    if (!ready) setReady(true)
  }, [phase, positionCursor, ready])

  // The camera's two STATE-driven beats: a smooth CSS-transitioned push into the
  // send button (`zoomSend`) and pull back out (`answer`). Everything in between
  // (the hold + slide) is driven imperatively by `paintFrame`, so here we hand
  // off by leaving the transform to the imperative writes (`undefined`).
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const cr = container.getBoundingClientRect()
    if (cr.width < 120) return

    if (phase === 'zoomSend') {
      const sr = sendRef.current?.getBoundingClientRect()
      if (!sr) return
      const px = sr.left - cr.left + sr.width / 2
      const py = sr.top - cr.top + sr.height / 2
      zoomOriginRef.current = `${px}px ${py}px`
      zoomOriginPxRef.current = { x: px, y: py }
      const tx = cr.width / 2 - px
      const ty = cr.height / 2 - py
      zoomTranslateRef.current = { x: tx, y: ty }
      setZoomStyle({
        transform: `translate(${tx}px, ${ty}px) scale(${ZOOM_SCALE})`,
        transformOrigin: zoomOriginRef.current,
      })
    } else if (phase === 'answer') {
      setZoomStyle({
        transform: 'translate(0px, 0px) scale(1)',
        transformOrigin: zoomOriginRef.current,
      })
    }
    // Held + slide beats: leave `zoomStyle` as-is (last applied at zoomSend). The
    // per-frame `paintFrame` writes overwrite the camera transform directly, and
    // there's no re-render within a beat to re-assert the stale inline style.
  }, [phase])

  // Aim the loader for the phase; on the slide, capture the on-screen anchors it
  // tweens between (its current spot → a left-of-centre spot). Paint once
  // synchronously so the camera + loader never flash before the rAF loop starts.
  useLayoutEffect(() => {
    if (phase === 'discMorph' || phase === 'cycleHold') {
      loaderTrackRef.current = { kind: 'send', start: 0 }
    } else if (phase === 'loaderSlide') {
      const container = containerRef.current
      const sr = sendRef.current?.getBoundingClientRect()
      if (container && sr) {
        const cr = container.getBoundingClientRect()
        const from = {
          x: sr.left - cr.left + sr.width / 2,
          y: sr.top - cr.top + sr.height / 2,
        }
        // Dock left-of-centre at the SAME height it morphed (the send row) — a
        // straight sideways slide, no vertical drift.
        slideAnchorRef.current = { from, to: { x: cr.width * 0.34, y: from.y } }
      }
      loaderTrackRef.current = { kind: 'slide', start: performance.now() }
    } else if (phase === 'phrases') {
      loaderTrackRef.current = { kind: 'reply', start: 0 }
    }
    if (LOADER_PAINT_PHASES.has(phase)) paintFrame()
  }, [phase, paintFrame])

  // Run the camera+loader tracker only through the held/slide beats. At `answer`
  // the loader is frozen at its last spot and fades while the camera (state) pulls
  // back out.
  const loaderPainting = LOADER_PAINT_PHASES.has(phase)
  useEffect(() => {
    if (!loaderPainting) return
    let raf = 0
    const loop = () => {
      paintFrame()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [loaderPainting, paintFrame])

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

  // The card (block 1) is mounted through the chat AND the whole workflow — it
  // never unmounts, so it continuously becomes the GitHub block.
  const showCard = HOME_PHASES.has(phase) || WORKFLOW_PHASES.has(phase)
  // Satellites only during the pull-out — at focus the first block stands alone
  // (they'd otherwise peek in at this zoom), then the camera reveals them.
  const showSatellites = phase === 'cameraOut' || phase === 'workflowHold'
  const showKb = KB_PHASES.has(phase)
  const showCursor = ready && !HIDE_CURSOR_PHASES.has(phase)
  const clicking = CLICK_PHASES.has(phase)

  // Root loader material per beat: a settled dark orb on the disc (`discMorph`),
  // then the morph cycle with the brand gradient; phrases reveal once docked; it
  // fades as the reply types in.
  const loaderShown = LOADER_PHASES.has(phase)
  const loaderSettled = phase === 'discMorph'
  const loaderPhrases = phase === 'phrases' || phase === 'answer'
  const loaderFading = phase === 'answer'

  // The scene "camera": identity while focused on the first block (chat/morph/
  // focus), then a single scale+translate that pulls back to the whole workflow.
  const sceneOverview = phase === 'cameraOut' || phase === 'workflowHold'
  const sceneTransform = sceneOverview
    ? `translate(${SCENE_OVERVIEW_TRANSLATE.x}px, ${SCENE_OVERVIEW_TRANSLATE.y}px) scale(${SCENE_OVERVIEW_SCALE})`
    : undefined
  const edgesDrawn = sceneOverview

  return (
    <div ref={containerRef} aria-hidden='true' className='relative h-full w-full overflow-hidden'>
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
          <div className='absolute inset-0 translate-y-0 scale-100 opacity-100'>
            <div
              ref={cameraElRef}
              className={cn(
                'h-full w-full',
                // Only the push-in and pull-out ride a CSS transition; the held +
                // slide beats are written imperatively (a transition here would
                // fight the per-frame writes).
                (phase === 'zoomSend' || phase === 'answer') &&
                  'transition-transform duration-[850ms] ease-[cubic-bezier(0.65,0,0.35,1)]'
              )}
              style={zoomStyle}
            >
              <StageHome
                mode={homeModeFor(phase)}
                typedCount={typedCount}
                answerTypedCount={answerTypedCount}
                inputRef={inputRef}
                sendRef={sendRef}
                dockRef={dockRef}
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

      {/* Root thinking loader — positioned imperatively (transform written each
          frame by `paintFrame`) so it stays glued to the send button, then the
          reply slot, through the camera pan. The outer element carries the anchor
          transform + scale; the inner shifts the loader by half a GLYPH (not half
          the label row) so the GLYPH — not the phrase — centers on the anchor, and
          the phrase flows out to its right inside the card. The fixed px offset
          scales with the outer transform. */}
      {loaderShown && (
        <div
          ref={loaderElRef}
          aria-hidden='true'
          className={cn(
            'pointer-events-none absolute top-0 left-0 z-20 transition-opacity duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]',
            loaderFading ? 'opacity-0' : 'opacity-100'
          )}
          style={{ transformOrigin: '0 0' }}
        >
          <div style={{ transform: `translate(-${LOADER_BASE / 2}px, -${LOADER_BASE / 2}px)` }}>
            <ThinkingLoader
              size={LOADER_BASE}
              startVariant='corners'
              settle={loaderSettled}
              phase={loaderPhrases}
              style={loaderSettled ? SEND_BUTTON_INK : undefined}
            />
          </div>
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
