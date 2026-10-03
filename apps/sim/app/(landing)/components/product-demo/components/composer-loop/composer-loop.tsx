'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { cn, usePrefersReducedMotion } from '@sim/emcn'
import { Blimp } from '@sim/emcn/icons'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { ThinkingLoader } from '@/components/ui'
import {
  ProductionWorkflowStage,
  type ScriptedWorkflowState,
} from '@/app/(landing)/components/hero/components/hero-platform-loop/production-workflow-stage'
import { DemoComposer } from '@/app/(landing)/components/product-demo/components/composer-loop/demo-composer'
import {
  DEMO_BLOCKS,
  DEMO_CANVAS,
  DEMO_EDGES,
} from '@/app/(landing)/components/product-demo/components/composer-loop/demo-workflow-data'
import type { DemoBeatId } from '@/app/(landing)/components/product-demo/components/product-demo-caption'

/**
 * The composer loop from the design studio's "Mothership input" iteration,
 * ported for the homepage stage, light theme.
 *
 * The interaction: after a beat, a prompt types itself into the composer and
 * sends, and a chat box rises out of the composer:
 * born narrow and tucked behind the composer's top edge, it lifts clear and
 * flares to full width on critically damped springs, wearing the product's
 * chrome (hairline, radius, white fill). For the first beat that chrome is
 * liquid: a goo filter fuses the box with the composer's body and draws the
 * box - white fill, hairline rim, and the meniscus where it pours out of the
 * composer - so its edges go gooey and settle crisp. The composer keeps its
 * own chrome throughout, and the box's CSS chrome takes over only once the
 * blur is gone, when the two are identical, so the handover is never seen.
 * Sim thinks with the goo cycle loader, streams a reply beside it, hands off to the Blimp, and holds. Then the chat
 * hands over to the product: the composer group fades away, and only once it
 * is gone the real workflow canvas fades in on its Start block at full size, and the workflow
 * the prompt described builds out node by node - each card landing already
 * selected, ring and action-menu swell on the newest one, the camera easing
 * out to keep the growing graph in view - then the whole graph holds before
 * the stage resets to the resting composer for the next pass.
 *
 * The composer group is stage-centred: as the chat box opens the composer
 * pushes down and the combined UI stays centred to the frame. Each pass is a
 * fresh mount, so its springs and keyframes always start from rest, and passes
 * only run while the stage is in view. Frames narrower than 1024px skip the
 * workflow act - seven cards cannot fit legibly - and loop the chat alone.
 */

/** The composer's design width; the stage scales the whole group from here. */
const WIDTH = 560
/**
 * On wide frames the composer spans this share of the frame's width by scaling
 * the whole design, so type, radii, and motion all grow together - large
 * enough to read as the section's subject, well short of filling the stage.
 */
const STAGE_FILL = 0.36
const MAX_SCALE = 1.15
const MIN_SCALE = 0.8
/**
 * The open group's design height (chat box, gap, composer) plus breathing
 * room. The scale also fits this into the frame's height - less any clearance
 * the frame owes to copy overlaid on it - so a short viewport never clips the
 * open chat or runs it into the heading.
 */
const GROUP_FIT_HEIGHT = 360
/** Below this frame width the design is not scaled; the composer shrinks to fit instead. */
const NARROW_FRAME = 640
/** Below this frame width the workflow act is skipped: seven cards cannot fit legibly. */
const WORKFLOW_MIN_FRAME = 1024
/** Breathing room the composer keeps from the frame's sides on narrow frames. */
const FRAME_INSET = 32
const MIN_WIDTH = 260
/** The product composer's radius (`rounded-2xl`), shared by the chat bloc that emerges from it. */
const BOX_RADIUS = 16
/** The sent prompt's bubble, on the platform's standard radius. */
const BUBBLE_RADIUS = 16
/** The hairline both surfaces carry; the chat box's height compensates for it. */
const HAIRLINE_PX = 1
/** Resting gap between the chat box and the composer. */
const GAP = 10
/** How far the chat box starts tucked behind the composer's top edge. */
const BIRTH_Y = 20
/**
 * How much narrower than the composer the chat box is born - well inside the
 * composer's footprint, so it reads as squeezed out of the composer rather
 * than dropped onto it. It flares to full width only after lifting clear.
 */
const BIRTH_INSET = 108
/**
 * The opening window: the box's lift and flare springs have settled enough by
 * here that later content growth (the thinking row, the wrapping reply) rides
 * the quick grow spring instead.
 */
const OPEN_MS = 850
/**
 * The goo: the blur that fuses the two blocs' silhouettes while the box is
 * born. It rises as the box's lip emerges, holds through the narrow touch
 * window, then clears as the box flares wide and lifts clear - by which point
 * the springs have carried the box past the blur's reach, so the neck thins
 * and snaps. It runs over the opening window.
 */
const GOO_MS = OPEN_MS
const GOO_MAX = 16
const openGooAt = (t: number) => {
  if (t < 0.16) return GOO_MAX * (t / 0.16) ** 2
  if (t < 0.36) return GOO_MAX
  if (t < 0.58) return GOO_MAX * (1 - (t - 0.36) / 0.22) ** 2
  return 0
}
/**
 * The alpha threshold that turns the blur back into a silhouette. Steep, so
 * edges stay crisp (the studio's gentle slope was the feather), but sitting
 * at 42% coverage like the studio's, so the bodies swell a hair under the
 * blur and merge generously - that swell and the early merge are what read
 * as liquid.
 */
const GOO_THRESHOLD = '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 60 -25'
/**
 * How far the composer's goo body is inset from the real composer. Under the
 * blur a thresholded silhouette swells by a few px per side; keeping the body
 * this much inside means the swell lands under the crisp composer painted
 * over it, so no white lip escapes any edge - only the top, where the box
 * pours in, is reached by the neck.
 */
const GHOST_INSET = { x: 24, y: 6 } as const
/**
 * The composer's top hairline would cut across the neck, so for as long as
 * the goo is live a white bar the box's width (plus the fillets' reach, which
 * grows with the blur) covers it, fading with the blur so it is gone the
 * moment the neck is.
 */
const FILLET_REACH = 1.1
const BAR_FADE_SIGMA = 6
/** The meniscus outline: one device pixel, like the surfaces' hairline. */
const hairlineRadius = () =>
  typeof window === 'undefined' ? 0.5 : Math.max(0.5, 1 / (window.devicePixelRatio || 1))
/** Cycle-loader glyph size in the chat (thinking + reply rows, and the Blimp). */
const LOADER_SIZE = 26
/** The answer row reserves one glyph line so the box holds steady while thinking. */
const ROW_MIN = LOADER_SIZE
/** Resting height of the one-line composer before it is measured. */
const COMPOSER_BASE_HEIGHT = 78
/** The reply text size, expressed for the loader's phase label. */
const THINKING_LABEL_RATIO = 15 / LOADER_SIZE

/**
 * Every geometry property rides a critically damped spring - bounce 0 - so
 * the box eases in and settles like a viscous blob instead of overshooting.
 */
const OPEN_SPRING = { type: 'spring', duration: 0.9, bounce: 0 } as const
/** Height spring for content growth after the box has opened (a wrapping reply). */
const GROW_SPRING = { type: 'spring', duration: 0.35, bounce: 0 } as const
const MORPH_SPRING = { type: 'spring', duration: 0.3, bounce: 0 } as const
/**
 * Width shapes the emergence: opening holds the narrow birth width while the
 * box is still tucked, then flares quickly once it lifts clear.
 */
const WIDTH_OPEN = { type: 'spring', duration: 0.42, bounce: 0, delay: 0.26 } as const
const EASE_OUT_STRONG = [0.23, 1, 0.32, 1] as const
const EASE_ENTRANCE = [0.25, 0.46, 0.45, 0.94] as const
const EASE_EXIT = [0.45, 0, 0.55, 1] as const

/** The product composer's resting `shadow-xs`; it drops once the conversation opens. */
const SHELL_SHADOW = '0 1px 2px 0 rgba(0,0,0,0.05)'

/**
 * The chat surface - the box, the seam bar, the goo bodies, and the goo
 * filter's flood all read this one property, so the liquid opening beat fuses
 * bodies of exactly the surface's colour. White on the light ground, the
 * product's elevated dark surface (the same one the composer takes) on the
 * dark ground. It is set on both the scene root and the filter's `<svg>`,
 * which are siblings, so the flood inherits it too.
 */
const CHAT_SURFACE_VARS = '[--chat-surface:var(--white)] dark:[--chat-surface:var(--surface-4)]'
const EMPTY_SHELL_SHADOW = '0 1px 2px 0 rgba(0,0,0,0)'

const TYPED =
  'Triage new Zendesk tickets: pull the runbook, classify severity, page on-call for P1s, and draft replies for approval.'
const REPLY =
  'On it — I’ll search your runbooks for each new ticket, classify its severity, page on-call and open a Jira incident for P1s, and route every other reply through approval before it posts back to Zendesk.'
const REPLY_WORDS = REPLY.split(' ')

/** Timeline beats (ms). */
const T = {
  typeStep: 34,
  /** Let the cycle loader + status phrase breathe before the answer types. */
  streamDelay: 1400,
  streamStep: 95,
} as const
/** Send → reply: how long Sim thinks. */
const THINK_MS = 2200
/**
 * How long after send the thinking loader appears - just past the box's
 * open-spring settle, so it never mounts under a still-growing (clipping) box
 * and starts its shape cycle from the top once visible.
 */
const THINK_APPEAR = 900
/** The composer rests for a beat before the prompt starts typing. */
const TYPE_START_MS = 900
const SEND_AT = TYPE_START_MS + TYPED.length * T.typeStep + 340
const RESPOND_AT = SEND_AT + THINK_MS
const STREAM_DONE_AT = RESPOND_AT + T.streamDelay + REPLY_WORDS.length * T.streamStep
/** Hold on the finished reply before the chat hands over to the workflow. */
const HANDOFF_AT = STREAM_DONE_AT + 1450

/**
 * The workflow act, in ms from its start: the canvas fades in, cards land one
 * by one, each landing selected, then the whole graph holds.
 */
const WORKFLOW_FADE_MS = 500
/**
 * The composer group's fade-out. The workflow canvas mounts only after it, so
 * the two never share a frame - no canvas flashing in behind a still-visible
 * composer.
 */
const COMPOSER_FADE_MS = 500
const BUILD_START_MS = 600
const BUILD_STEP_MS = 640
/**
 * Cards on the canvas before Sim builds anything: the Start block every new
 * workflow opens with, which is why it leads `DEMO_BLOCKS`.
 */
const PREBUILT_COUNT = 1
/** The last card stays selected for a beat before the selection clears. */
const BUILD_SETTLE_MS = 900
/** The finished graph holds in view before the stage resets. */
const BUILD_HOLD_MS = 2_000

type DemoPhase = 'chat' | 'handoff' | 'workflow' | 'reset'

interface DemoScript extends ScriptedWorkflowState {
  builtCount: number
}

const IDLE_SCRIPT: DemoScript = {
  builtCount: 0,
  selectedId: null,
  isWorkflowRunning: false,
  runningId: null,
  completedIds: new Set(),
}

const FINISHED_SCRIPT: DemoScript = { ...IDLE_SCRIPT, builtCount: DEMO_BLOCKS.length }

interface ComposerPassProps {
  /** The composer's design width for this frame. */
  width: number
  /** Uniform scale the stage applies to the whole group. */
  scale: number
  /** Called the instant the prompt is sent, when Sim starts to think. */
  onSend: () => void
  /** Called once the reply has finished and held, so the parent can hand over to the workflow. */
  onReplyHold: () => void
}

/** The chat act. Mounted fresh per pass so every spring starts at rest. */
function ComposerPass({ width, scale, onSend, onReplyHold }: ComposerPassProps) {
  const birthWidth = Math.max(160, width - BIRTH_INSET)
  const gooFilterId = `${useId().replace(/[^a-zA-Z0-9-]/g, '')}-goo`
  const blurRef = useRef<SVGFEGaussianBlurElement>(null)
  const [ringRadius] = useState(hairlineRadius)
  const barRef = useRef<HTMLDivElement>(null)

  const [prompt, setPrompt] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [messages, setMessages] = useState<string[]>([])
  const [thinking, setThinking] = useState(false)
  const [replying, setReplying] = useState(false)
  const [replyDone, setReplyDone] = useState(false)
  const [streamed, setStreamed] = useState('')
  const [opening, setOpening] = useState(false)
  const [gooLive, setGooLive] = useState(false)
  /**
   * The timeline runs exactly once per pass. The parent recreates its callback
   * on every render (build steps, layout fits), so it is read through a ref:
   * a dependency on it would restart the whole timeline mid-flight - retyping
   * the prompt and re-firing the send against an already-open box.
   */
  const onSendRef = useRef(onSend)
  const onReplyHoldRef = useRef(onReplyHold)
  useEffect(() => {
    onSendRef.current = onSend
    onReplyHoldRef.current = onReplyHold
  }, [onSend, onReplyHold])
  const [composerH, setComposerH] = useState(COMPOSER_BASE_HEIGHT)
  const [chatH, setChatH] = useState(0)
  const composerWrapRef = useRef<HTMLDivElement>(null)
  const chatContentRef = useRef<HTMLDivElement>(null)

  const expanded = messages.length > 0

  useEffect(() => {
    const el = composerWrapRef.current?.firstElementChild as HTMLElement | null
    if (!el) return
    const measure = () => setComposerH(el.offsetHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const el = chatContentRef.current
    if (!el) return
    const measure = () => setChatH(el.offsetHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!opening) return
    const timer = setTimeout(() => setOpening(false), OPEN_MS)
    return () => clearTimeout(timer)
  }, [opening])

  useEffect(() => {
    if (!opening) return
    const blur = blurRef.current
    if (!blur) return
    setGooLive(true)
    const start = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min((now - start) / GOO_MS, 1)
      const goo = openGooAt(t)
      blur.setAttribute('stdDeviation', String(goo))
      const bar = barRef.current
      if (bar) {
        bar.style.setProperty('--fillet', `${FILLET_REACH * goo}px`)
        bar.style.opacity = String(Math.min(1, goo / BAR_FADE_SIGMA))
      }
      if (goo === 0 && t > 0.5) {
        setGooLive(false)
        return
      }
      frame = requestAnimationFrame(tick)
    })
    return () => {
      cancelAnimationFrame(frame)
      blur.setAttribute('stdDeviation', '0')
      setGooLive(false)
    }
  }, [opening])

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))

    for (let i = 0; i < TYPED.length; i++) {
      at(TYPE_START_MS + i * T.typeStep, () => setPrompt(TYPED.slice(0, i + 1)))
    }
    at(SEND_AT, () => {
      setPrompt('')
      setMessages([TYPED])
      setIsSending(true)
      setOpening(true)
      onSendRef.current()
    })
    at(SEND_AT + THINK_APPEAR, () => setThinking(true))
    const streamStart = RESPOND_AT + T.streamDelay
    at(streamStart, () => {
      setThinking(false)
      setReplying(true)
    })
    for (let i = 1; i <= REPLY_WORDS.length; i++) {
      at(streamStart + (i - 1) * T.streamStep, () => setStreamed(REPLY_WORDS.slice(0, i).join(' ')))
    }
    at(STREAM_DONE_AT, () => {
      setReplyDone(true)
      setIsSending(false)
    })
    at(HANDOFF_AT, () => onReplyHoldRef.current())

    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [])

  return (
    <MotionConfig reducedMotion='user'>
      <svg width='0' height='0' aria-hidden='true' className={cn('absolute', CHAT_SURFACE_VARS)}>
        <defs>
          {/* The studio's goo, crisp: blur the bodies, threshold them back
              into one swollen silhouette, then fill it in the surfaces' own
              colour and rim it with their hairline at one device pixel. */}
          <filter
            id={gooFilterId}
            colorInterpolationFilters='sRGB'
            x='-10%'
            y='-10%'
            width='120%'
            height='120%'
          >
            <feGaussianBlur ref={blurRef} in='SourceGraphic' stdDeviation='0' result='blur' />
            <feColorMatrix in='blur' type='matrix' values={GOO_THRESHOLD} result='body' />
            <feMorphology in='body' operator='erode' radius={ringRadius} result='inner' />
            <feComposite in='body' in2='inner' operator='out' result='rim' />
            <feFlood style={{ floodColor: 'var(--chat-surface)' }} result='white' />
            <feComposite in='white' in2='body' operator='in' result='fill' />
            <feFlood style={{ floodColor: 'var(--border)' }} result='ink' />
            <feComposite in='ink' in2='rim' operator='in' result='outline' />
            <feMerge>
              <feMergeNode in='fill' />
              <feMergeNode in='outline' />
            </feMerge>
          </filter>
        </defs>
      </svg>
      <div
        className={cn('relative', CHAT_SURFACE_VARS)}
        style={{ width, transform: `scale(${scale})`, transformOrigin: 'center' }}
      >
        <div className='relative isolate w-full'>
          {/* CHAT BOX - born tucked behind the composer's top edge, it rises
              clear. For the opening beat its chrome is the goo body beneath
              it (see GOO) and its own is transparent; the two coincide exactly
              whenever the blur is zero, which is the only time they swap, so
              the swap is never seen. */}
          <motion.div
            initial={false}
            className='relative z-20'
            animate={{
              y: expanded ? 0 : BIRTH_Y,
              marginBottom: expanded ? GAP : 0,
              opacity: messages.length > 0 ? 1 : 0,
            }}
            transition={{
              y: OPEN_SPRING,
              marginBottom: OPEN_SPRING,
              opacity: { duration: 0.2, ease: EASE_OUT_STRONG },
            }}
          >
            <motion.div
              initial={false}
              animate={{
                width: expanded ? width : birthWidth,
                height: expanded ? chatH + 2 * HAIRLINE_PX : 0,
              }}
              transition={{
                width: WIDTH_OPEN,
                height: opening ? OPEN_SPRING : GROW_SPRING,
              }}
              className={cn(
                'mx-auto flex flex-col overflow-hidden border',
                gooLive
                  ? 'border-transparent bg-transparent'
                  : 'border-[var(--border)] bg-[var(--chat-surface)]'
              )}
              style={{ borderRadius: BOX_RADIUS }}
            >
              <div
                ref={chatContentRef}
                className='box-border flex flex-col gap-4 p-4'
                style={{ width }}
              >
                {messages.map((text) => (
                  <div key={text} className='flex justify-end'>
                    <motion.div
                      initial={{ opacity: 0, y: 10, filter: 'blur(3px)' }}
                      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                      transition={{ duration: 0.4, delay: 0.15, ease: EASE_OUT_STRONG }}
                      className='max-w-[70%] overflow-hidden bg-[var(--surface-5)] px-3.5 py-2 text-[15px] text-[var(--text-primary)] leading-[22px]'
                      style={{ borderRadius: BUBBLE_RADIUS }}
                    >
                      {text}
                    </motion.div>
                  </div>
                ))}
                <div style={{ minHeight: ROW_MIN }}>
                  <AnimatePresence initial={false}>
                    {(thinking || replying) && (
                      <motion.div
                        key='answer'
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, transition: { duration: 0.25, ease: EASE_OUT_STRONG } }}
                        transition={{ duration: 0.3, ease: EASE_OUT_STRONG }}
                        className='relative z-[2] flex min-h-[24px] items-start gap-2.5'
                      >
                        {/* ONE persistent cycle loader from thinking through the
                            reply; it hands off to the Blimp once the answer completes. */}
                        <span
                          className='relative shrink-0'
                          style={{ width: LOADER_SIZE, height: LOADER_SIZE }}
                        >
                          <AnimatePresence mode='popLayout' initial={false}>
                            {replyDone ? (
                              <motion.span
                                key='blimp'
                                initial={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
                                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                                transition={MORPH_SPRING}
                                className='absolute inset-0 grid place-items-center'
                              >
                                <Blimp
                                  className='text-[var(--text-icon)]'
                                  style={{ width: LOADER_SIZE, height: LOADER_SIZE }}
                                />
                              </motion.span>
                            ) : (
                              <motion.span
                                key='goo'
                                exit={{ opacity: 0, filter: 'blur(3px)' }}
                                transition={{ duration: 0.3, ease: EASE_OUT_STRONG }}
                                className='absolute inset-0'
                              >
                                <ThinkingLoader size={LOADER_SIZE} startVariant='corners' />
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </span>
                        <span className='relative z-[2] block min-h-[24px] min-w-0 flex-1 text-[15px] leading-[24px]'>
                          {streamed.length > 0 ? (
                            <span className='block text-[var(--text-primary)]'>{streamed}</span>
                          ) : (
                            <ThinkingLoader
                              size={LOADER_SIZE}
                              startVariant='corners'
                              phase
                              labelRatio={THINKING_LABEL_RATIO}
                              className='h-[24px] [&>svg]:hidden [&_*]:leading-[24px]'
                            />
                          )}
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          </motion.div>

          {/* COMPOSER - the product's own chrome, unchanged through the
              emergence; its resting shadow-xs fades once the conversation
              opens, as in the product. */}
          <div className='relative'>
            <motion.div
              ref={composerWrapRef}
              initial={false}
              animate={{
                height: composerH,
                boxShadow: expanded ? EMPTY_SHELL_SHADOW : SHELL_SHADOW,
              }}
              transition={{
                height: GROW_SPRING,
                boxShadow: {
                  duration: opening ? 0.3 : 0.7,
                  ease: opening ? EASE_EXIT : EASE_ENTRANCE,
                },
              }}
              className='relative z-30 overflow-hidden rounded-2xl [&>div]:shadow-none'
            >
              <DemoComposer prompt={prompt} isSending={isSending} isInitialView={!expanded} />
              {opening && (
                <motion.div
                  aria-hidden='true'
                  initial={{ width: birthWidth, x: '-50%' }}
                  animate={{ width: expanded ? width : birthWidth, x: '-50%' }}
                  transition={{ width: WIDTH_OPEN }}
                  className='pointer-events-none absolute top-0 left-1/2 z-10 h-px'
                >
                  <div
                    ref={barRef}
                    className='absolute inset-y-0 bg-[var(--chat-surface)] opacity-0'
                    style={{
                      left: 'calc(-1 * var(--fillet, 0px))',
                      right: 'calc(-1 * var(--fillet, 0px))',
                    }}
                  />
                </motion.div>
              )}
            </motion.div>
          </div>

          {/* GOO - the studio's arrangement: beneath the content, this layer
              IS the chat box's body for the opening beat. It holds a copy of
              the box on the same springs (tuck included) and the composer's
              body inset from the real one, both in the chat surface; the filter
              fuses them into one swollen silhouette with a hairline rim, so
              the box's edges go liquid and it pours out of the composer with
              a neck that thins and snaps as it lifts clear. The column is
              anchored to the top, like the real one, so the copies track the
              visible surfaces while the composer wrap's height springs. */}
          {opening && (
            <div
              className='pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-start'
              style={{ filter: `url(#${gooFilterId})` }}
            >
              <motion.div
                initial={{ width: birthWidth, height: 0, y: BIRTH_Y, marginBottom: 0 }}
                animate={{
                  width: expanded ? width : birthWidth,
                  height: expanded ? chatH + 2 * HAIRLINE_PX : 0,
                  y: expanded ? 0 : BIRTH_Y,
                  marginBottom: expanded ? GAP : 0,
                }}
                transition={{
                  height: OPEN_SPRING,
                  y: OPEN_SPRING,
                  marginBottom: OPEN_SPRING,
                  width: WIDTH_OPEN,
                }}
                className='bg-[var(--chat-surface)]'
                style={{ borderRadius: BOX_RADIUS }}
              />
              <div
                className='bg-[var(--chat-surface)]'
                style={{
                  width: width - 2 * GHOST_INSET.x,
                  height: composerH - 2 * GHOST_INSET.y,
                  marginTop: GHOST_INSET.y,
                  borderRadius: BOX_RADIUS,
                }}
              />
            </div>
          )}
        </div>
      </div>
    </MotionConfig>
  )
}

interface ComposerLoopProps {
  /**
   * Px at the top of the frame that copy overlays, mirrored at the bottom so
   * the group stays centred: the height fit subtracts both.
   */
  clearance?: number
  /**
   * Reports the act the scene is in - the prompt being described, Sim
   * planning its reply, the workflow being built - so the section's caption
   * can follow it.
   */
  onBeat?: (beat: DemoBeatId) => void
}

/**
 * The stage: fills the product-demo frame, centres the composer group, sizes
 * it to the frame, and runs the two acts - chat, then the workflow building,
 * each card landing selected - in a loop while the frame is in
 * view. Decorative and `aria-hidden`; nothing here is interactive.
 */
export function ComposerLoop({ clearance = 0, onBeat }: ComposerLoopProps) {
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    if (reducedMotion) onBeat?.('build')
  }, [reducedMotion, onBeat])

  if (reducedMotion) {
    return (
      <div
        aria-hidden='true'
        inert
        className='pointer-events-none absolute inset-0 overflow-hidden'
      >
        <ProductionWorkflowStage
          builtCount={FINISHED_SCRIPT.builtCount}
          blocks={DEMO_BLOCKS}
          edges={DEMO_EDGES}
          canvas={DEMO_CANVAS}
          scripted={FINISHED_SCRIPT}
          viewportInset={{ top: clearance, bottom: clearance }}
        />
      </div>
    )
  }

  return <AnimatedComposerLoop clearance={clearance} onBeat={onBeat} />
}

/** Mounted only while motion is allowed, so preference changes cancel every pending act. */
function AnimatedComposerLoop({ clearance = 0, onBeat }: ComposerLoopProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const onBeatRef = useRef(onBeat)
  const [layout, setLayout] = useState({ width: WIDTH, scale: 1, workflow: true })
  const [visible, setVisible] = useState(false)
  const [passKey, setPassKey] = useState(0)
  const [phase, setPhase] = useState<DemoPhase>('chat')
  const [script, setScript] = useState<DemoScript>(IDLE_SCRIPT)

  useEffect(() => {
    onBeatRef.current = onBeat
  }, [onBeat])

  useEffect(() => {
    if (phase === 'chat') onBeatRef.current?.('describe')
    else if (phase === 'workflow') onBeatRef.current?.('build')
  }, [phase])

  useEffect(() => {
    if (phase !== 'workflow') return
    const timers: ReturnType<typeof setTimeout>[] = []
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))

    setScript({ ...IDLE_SCRIPT, builtCount: PREBUILT_COUNT, selectedId: DEMO_BLOCKS[0].id })
    DEMO_BLOCKS.slice(PREBUILT_COUNT).forEach((block, index) => {
      at(BUILD_START_MS + index * BUILD_STEP_MS, () =>
        setScript((current) => ({
          ...current,
          builtCount: PREBUILT_COUNT + index + 1,
          selectedId: block.id,
        }))
      )
    })
    const buildEnd = BUILD_START_MS + (DEMO_BLOCKS.length - PREBUILT_COUNT) * BUILD_STEP_MS
    const settled = buildEnd + BUILD_SETTLE_MS
    at(settled, () => setScript((current) => ({ ...current, selectedId: null })))
    at(settled + BUILD_HOLD_MS, () => setPhase('reset'))

    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [phase])

  useEffect(() => {
    if (phase !== 'handoff') return
    const timer = setTimeout(() => setPhase('workflow'), COMPOSER_FADE_MS)
    return () => clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    if (phase !== 'reset') return
    const timer = setTimeout(() => {
      setScript(IDLE_SCRIPT)
      setPassKey((key) => key + 1)
      setPhase('chat')
    }, WORKFLOW_FADE_MS + 100)
    return () => clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const fitStage = () => {
      const frame = stage.clientWidth
      const room = stage.clientHeight - 2 * clearance
      const byHeight = stage.clientHeight > 0 ? Math.max(0, room) / GROUP_FIT_HEIGHT : MAX_SCALE
      const workflow = frame >= WORKFLOW_MIN_FRAME
      if (frame < NARROW_FRAME) {
        const width = Math.max(MIN_WIDTH, Math.min(WIDTH, frame - FRAME_INSET * 2))
        const scale = Math.min(1, Math.max(MIN_SCALE, byHeight))
        setLayout((current) =>
          current.width === width && current.scale === scale && current.workflow === workflow
            ? current
            : { width, scale, workflow }
        )
        return
      }
      const byWidth = (frame * STAGE_FILL) / WIDTH
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(byWidth, byHeight)))
      setLayout((current) =>
        current.width === WIDTH && current.scale === scale && current.workflow === workflow
          ? current
          : { width: WIDTH, scale, workflow }
      )
    }
    fitStage()
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fitStage)
    resize?.observe(stage)

    let intersection: IntersectionObserver | undefined
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
    } else {
      intersection = new IntersectionObserver(([entry]) => {
        setVisible(entry.isIntersecting)
        if (!entry.isIntersecting) {
          setScript(IDLE_SCRIPT)
          setPhase('chat')
          setPassKey((key) => key + 1)
        }
      })
      intersection.observe(stage)
    }

    return () => {
      resize?.disconnect()
      intersection?.disconnect()
    }
  }, [clearance])

  return (
    <div
      ref={stageRef}
      aria-hidden='true'
      className={cn(
        'absolute inset-0 grid place-items-center overflow-hidden',
        'pointer-events-none'
      )}
    >
      {visible && (
        <>
          <div
            className={cn(
              'col-start-1 row-start-1 transition-[opacity,transform] duration-500 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]',
              phase === 'chat' ? 'scale-100 opacity-100' : 'scale-[0.97] opacity-0'
            )}
          >
            <ComposerPass
              key={passKey}
              width={layout.width}
              scale={layout.scale}
              onSend={() => onBeatRef.current?.('plan')}
              onReplyHold={() => setPhase(layout.workflow ? 'handoff' : 'reset')}
            />
          </div>
          {(phase === 'workflow' || phase === 'reset') && (
            <div
              className={cn(
                'absolute inset-0 animate-[hero-stage-fade_500ms_cubic-bezier(0.23,1,0.32,1)_both] transition-opacity duration-500',
                phase === 'workflow' ? 'opacity-100' : 'opacity-0'
              )}
            >
              <ProductionWorkflowStage
                builtCount={script.builtCount}
                blocks={DEMO_BLOCKS}
                edges={DEMO_EDGES}
                canvas={DEMO_CANVAS}
                scripted={script}
                viewportInset={{ top: clearance, bottom: clearance }}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
