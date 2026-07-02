'use client'

import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '@sim/emcn'
import { WorkflowBlockContent } from '@/app/(landing)/components/hero/components/hero-visual/workflow-block-content'
import {
  ANSWER_TEXT,
  BLOCK_WIDTH,
  BLOCKS,
  HOME_GREETING,
  PROMPT_ATOMS,
  type PromptAtom,
  SEND_BUBBLE_ENTER_MS,
  SEND_BUBBLE_REVEAL_DELAY_MS,
  WORKFLOW_FOCUS_SCALE,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

/**
 * What the Mothership chat is showing right now. The travelling thinking loader
 * itself lives at the hero root (so it can outlive these layers and track its
 * target through the camera zoom + pan); this stage only lays out the card and
 * exposes the send button and reply slot as the loader's ref targets.
 *
 * - `compose` - greeting + prompt input (the typewriter).
 * - `morphing` - the instant after send: the disc morphs into the loader while
 *   the typed prompt fades. The card holds its compose height (the input stays in
 *   flow, just fading) so it never reshapes mid-morph - the disc just becomes the
 *   loader in place.
 * - `sending` - the morph is done; the prompt is now a user bubble that animates
 *   in above the loader, growing the card, while the camera holds zoomed in.
 * - `thinking` - conversation layout (user bubble + an empty reply slot whose
 *   height the loader will occupy), shown as the loader slides/docks there.
 * - `answering` - the typed reply fills the reply slot.
 * - `block` - the card morphs into the first workflow block (the chat shell
 *   resizes and its content becomes the block's), handing off to the workflow.
 */
export type HomeMode = 'compose' | 'morphing' | 'sending' | 'thinking' | 'answering' | 'block'

/** The first workflow block, shown inside the card during the morph. */
const FIRST_BLOCK = BLOCKS[0]
/** GitHub block content's natural (unscaled) height in px. */
const GH_CONTENT_HEIGHT = 77
/** The chat card's width (compose/conversation). */
const CHAT_CARD_WIDTH = 460
/**
 * Natural height of the compose card on first paint - `py-2` (16) + the input
 * row (32) + `gap-2` (8) + the action row (28). Seeds the card so it renders at
 * its true height immediately and never transitions/resizes on load; the
 * observer keeps it exact thereafter. Must track the content's padding/spacing.
 */
const COMPOSE_CARD_HEIGHT = 84
/**
 * Card width/height once morphed into the first block (block content × focus
 * scale). Deliberately smaller than the chat card so the morph reads as a
 * visible SHRINK + reshape, not a same-size content crossfade.
 */
const BLOCK_CARD_WIDTH = BLOCK_WIDTH * WORKFLOW_FOCUS_SCALE
const BLOCK_CARD_HEIGHT = GH_CONTENT_HEIGHT * WORKFLOW_FOCUS_SCALE

interface StageHomeProps {
  /** Which beat of the chat to render. */
  mode: HomeMode
  /** Prompt atoms the typewriter has revealed (compose mode). */
  typedCount: number
  /** Characters of the Mothership's reply revealed so far (answering mode). */
  answerTypedCount: number
  /** The prompt text region - the root cursor targets this for its "click in". */
  inputRef: RefObject<HTMLDivElement | null>
  /** The send button - the root cursor + travelling loader target this to "send". */
  sendRef: RefObject<HTMLDivElement | null>
  /** The dock - an invisible spot at the LEFT of the send-button row that the
   * loader slides to (same row, so the slide is purely horizontal and the card
   * never has to resize for it). */
  dockRef: RefObject<HTMLDivElement | null>
  /**
   * The white card element. The parent measures it and, during the send beat
   * (`sending`), drives its height per-frame via the `--hero-card-h` CSS variable
   * - in lockstep with the camera pan - so the grow-to-fit-the-bubble can't shake
   * the card the way a CSS height transition fighting the rAF loop would.
   */
  cardRef: RefObject<HTMLDivElement | null>
  /**
   * Reveal the greeting headline. Held back until the input is being composed,
   * then fades in on the `hero-stage-fade` keyframe, slowed to 1.2s (≈3× the
   * scene's stock 420ms) so the headline eases in gently. Its space is always
   * reserved, so revealing it never shifts the layout.
   */
  showGreeting?: boolean
  /** Press the send button (scale it down) - driven by the click beat. */
  pressed?: boolean
}

/** Staggered enter for a chat bubble - translateY + opacity + blur, interruptible. */
const ENTER_BASE = 'transition-[opacity,transform,filter] ease-[cubic-bezier(0.2,0,0,1)]'
const enterState = (shown: boolean) =>
  shown ? 'translate-y-0 opacity-100 blur-0' : 'translate-y-1.5 opacity-0 blur-[3px]'

const Caret = () => (
  <span
    className='ml-px inline-block h-[16px] w-px translate-y-[2px] animate-caret-blink bg-[var(--text-primary)]'
    aria-hidden='true'
  />
)

/** Renders prompt atoms (plain chars + inline `@mention` icon-chips). */
function PromptAtoms({ atoms }: { atoms: PromptAtom[] }) {
  return (
    <>
      {atoms.map((atom, i) =>
        atom.kind === 'char' ? (
          <span key={`${i}-${atom.char}`}>{atom.char}</span>
        ) : (
          <span key={`${i}-${atom.label}`}>
            <span className='relative'>
              <span className='invisible'>@</span>
              <atom.icon className='absolute inset-0 m-auto size-[12px] translate-y-[1.25px] text-[var(--text-icon)]' />
            </span>
            {atom.label}
          </span>
        )
      )}
    </>
  )
}

/**
 * The Mothership home stage - a single white card that morphs adaptively.
 *
 * Both content layers (the compose input and the conversation) are absolutely
 * stacked and TOP-anchored; the card measures whichever is active and animates
 * its own height to hug it (`transition-[height]`). This makes the card flexible
 * - it grows from the input to the reply, and from the thinking loader to the
 * typed answer - with no dead space and no fixed min-height. Top-anchoring keeps
 * the user bubble pinned, so the loader's label crossfade never shoves it; the
 * card `overflow-hidden`s any transient. Cursor is owned by the parent; this
 * stage only exposes the input and send button as ref targets. Decorative.
 */
export function StageHome({
  mode,
  typedCount,
  answerTypedCount,
  inputRef,
  sendRef,
  dockRef,
  cardRef,
  showGreeting = false,
  pressed = false,
}: StageHomeProps) {
  const isCompose = mode === 'compose'
  const isMorphing = mode === 'morphing'
  const isBlock = mode === 'block'
  const isAnswering = mode === 'answering'
  // The prompt input holds the card's compose height through the disc→loader morph
  // (`compose`/`morphing`), then fades to a right-aligned bubble once send lands.
  const inputInFlow = isCompose || isMorphing
  // The typed prompt is a right-aligned chat bubble from the moment send is hit
  // (`sending`) onward.
  const showBubble = !isCompose && !isMorphing && !isBlock
  // While the bubble first appears (`sending`), the PARENT drives the card height
  // per-frame (via `--hero-card-h`) in lockstep with the camera, so the grow can't
  // shake. Every other beat lets the card own + CSS-transition its own height.
  const growControlled = mode === 'sending'
  // Hold the card height steady - no CSS height-transition - through both the
  // parent-driven grow (`sending`) AND the loader slide + camera track
  // (`thinking`). The slide pans the camera by measuring the dock's live
  // position each frame and assumes the card holds its size; transitioning
  // height there makes the card resize under that measurement, so it jitters.
  const holdCardHeight = growControlled || mode === 'thinking'
  const contentRef = useRef<HTMLDivElement>(null)
  // Seeded at the natural compose height so the send button is never clipped on
  // the very first paint; the observer below keeps it exact from then on.
  const [cardHeight, setCardHeight] = useState(COMPOSE_CARD_HEIGHT)

  // Hug the chat column: measure its natural height and animate the card to it.
  // Guard against a collapsed/unpainted layout (width ~0) measuring a
  // wildly-wrapped height and poisoning the card size.
  const measure = useCallback(() => {
    const el = contentRef.current
    if (el && el.offsetWidth > 120) setCardHeight(el.offsetHeight)
  }, [])
  // Synchronous, pre-paint, on every beat that reshapes the content (prompt typing
  // out, input→bubble swap, reply filling in) - so the card grows in lockstep with
  // no lag. In block mode the card takes a fixed height (`isBlock` branch on the
  // style), so the measured value is simply ignored there.
  useLayoutEffect(() => {
    measure()
  }, [measure, mode, typedCount, answerTypedCount])
  // Robust backstop: also re-fit on first-paint layout, font load, or any other
  // reflow the beat-driven pass can't see - so the send button is never clipped.
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure])

  const visible = PROMPT_ATOMS.slice(0, typedCount)
  const isEmpty = typedCount === 0
  const answer = ANSWER_TEXT.slice(0, answerTypedCount)
  const bubbleTransitionStyle = {
    transitionDelay: mode === 'sending' ? `${SEND_BUBBLE_REVEAL_DELAY_MS}ms` : '0ms',
    transitionDuration: `${SEND_BUBBLE_ENTER_MS}ms`,
  } satisfies CSSProperties

  return (
    <div className='flex h-full w-full flex-col items-center justify-center px-10'>
      <div className='flex w-full max-w-[460px] flex-col gap-5'>
        {/* Greeting - visible while composing, then fades. Its SPACE is held
            through the sending/thinking scene so collapsing it never re-centres
            the column and shifts the card the camera is locked onto; it only
            truly collapses once the reply takes over (answering) or the card
            morphs to a block. */}
        <div
          className={cn(
            'overflow-hidden text-center transition-[height,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]',
            mode === 'compose'
              ? 'h-[40px] opacity-100'
              : mode === 'sending' || mode === 'thinking'
                ? 'h-[40px] opacity-0'
                : 'h-0 opacity-0'
          )}
        >
          {showGreeting ? (
            <p className='text-[30px] text-[var(--text-primary)] leading-[40px] [animation:hero-stage-fade_1200ms_cubic-bezier(0.23,1,0.32,1)_both]'>
              {HOME_GREETING}
            </p>
          ) : null}
        </div>

        {/* White card - the SAME shell throughout: it hugs the active chat content,
            then resizes and rounds down to become the first workflow block (the
            chat → workflow morph happens on this one continuous element). */}
        <div
          ref={cardRef}
          className={cn(
            // The chat input's aesthetic (rounded-2xl, border, soft shadow) is
            // kept THROUGHOUT - including once morphed into the workflow block -
            // so it stays the same white card, just resized.
            'relative mx-auto overflow-hidden rounded-2xl border border-[var(--border-1)] bg-[var(--surface-2)] shadow-sm',
            // While the height is held (the parent-driven send-bubble grow, and the
            // loader slide where the card keeps its size), do NOT CSS-transition
            // height - a transition would fight the per-frame camera/dock tracking
            // and read as jitter. Every other beat eases width/height/transform with
            // the shared curve.
            holdCardHeight
              ? 'transition-[width,transform] duration-[620ms] ease-[cubic-bezier(0.22,1,0.36,1)]'
              : 'transition-[width,height,transform] duration-[620ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
            // Nudge up to cancel the chat column's greeting+gap offset, so the
            // card centers exactly where the focused workflow block lands.
            isBlock && '-translate-y-[10px]'
          )}
          style={{
            width: isBlock ? BLOCK_CARD_WIDTH : CHAT_CARD_WIDTH,
            // During the grow, follow the parent-driven variable (seeded to the
            // compose height so there's never a collapsed first frame).
            height: isBlock
              ? BLOCK_CARD_HEIGHT
              : growControlled
                ? `var(--hero-card-h, ${COMPOSE_CARD_HEIGHT}px)`
                : cardHeight,
          }}
        >
          {/* Chat content - ONE column: the user message (the typewriter input,
              then the sent bubble) over an action row (the send button + the
              loader's dock, then the reply). The column stays anchored to the
              BOTTOM through the send-bubble grow AND the loader slide (the whole
              `holdCardHeight` window): during the grow the card expands UPWARD to
              reveal the bubble, and through the slide the bottom edge never moves -
              so the dock/send button the camera tracks can't shift as the height
              source switches. Re-anchoring there would nudge them a sub-pixel and
              the slide's camera would chase it (a visible jitter). Every other beat
              is top-anchored (content fills the card, so it reads the same either
              way), which keeps the block-morph and the reply grow behaving as before. */}
          <div
            ref={contentRef}
            className={cn(
              'absolute inset-x-0 flex flex-col gap-2 px-2.5 py-2 transition-opacity duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)]',
              holdCardHeight ? 'bottom-0' : 'top-0',
              isBlock && 'pointer-events-none opacity-0'
            )}
          >
            {/* Message: the typewriter input while composing + morphing, then it
                fades and a right-aligned user bubble animates in once `sending`
                begins. The input stays in flow (holding the compose height) right
                through the morph, so the card never reshapes as the disc becomes
                the loader; the bubble takes over the flow only after, growing the
                card in one clean transition. */}
            <div className='relative'>
              <div
                ref={inputRef}
                className={cn(
                  'min-h-[24px] px-1 py-1 font-body text-[15px] text-[var(--text-primary)] leading-[24px] tracking-[-0.015em] transition-opacity duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]',
                  isCompose ? 'opacity-100' : 'opacity-0',
                  !inputInFlow && 'pointer-events-none absolute inset-x-0 top-0'
                )}
              >
                {isEmpty ? (
                  <span className='font-[380] text-[var(--text-subtle)]'>
                    Ask Sim to build an agent…
                  </span>
                ) : (
                  <>
                    <PromptAtoms atoms={visible} />
                    <Caret />
                  </>
                )}
              </div>
              <div
                style={bubbleTransitionStyle}
                className={cn(
                  'ml-auto w-fit max-w-[82%] rounded-2xl bg-[var(--surface-5)] px-3.5 py-2 font-body text-[15px] text-[var(--text-primary)] leading-[22px] tracking-[-0.015em]',
                  ENTER_BASE,
                  showBubble
                    ? enterState(true)
                    : cn('pointer-events-none absolute top-0 right-0', enterState(false))
                )}
              >
                <PromptAtoms atoms={PROMPT_ATOMS} />
              </div>
            </div>

            {/* Action row: the loader's dock (left) and the send button (right).
                The dock is the loader's slide target; once answering, the reply
                types out from that same left edge as the loader fades, so the
                docked loader reads as the start of the reply. */}
            <div className='flex items-start justify-between gap-2'>
              <div className='min-w-0 flex-1'>
                {isAnswering ? (
                  <p className='px-1 font-body text-[15px] text-[var(--text-primary)] leading-[22px] tracking-[-0.015em]'>
                    {answer}
                    <Caret />
                  </p>
                ) : (
                  <div ref={dockRef} aria-hidden='true' className='size-[28px]' />
                )}
              </div>
              <div
                ref={sendRef}
                aria-hidden='true'
                className={cn(
                  'flex size-[28px] shrink-0 items-center justify-center rounded-full bg-[#383838] transition-[opacity,transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]',
                  // Visible only while composing; once send is hit the root loader's
                  // settled orb takes its place (it stays laid out as the loader's
                  // measure + slide-from target).
                  isCompose ? 'opacity-100' : 'opacity-0',
                  // Subtle interaction: lighten on hover, dip in size on press -
                  // both for a real cursor and for the animation's click beat.
                  isCompose && 'hover:bg-[#484848] active:scale-90',
                  pressed && 'scale-90'
                )}
              >
                {/* Up-arrow that draws itself on (shaft then head) via
                    stroke-dashoffset - `pathLength={1}` normalizes the dash so
                    one offset value covers the whole glyph. Retracts as send is
                    hit so the disc is clean when the loader takes it over. */}
                <svg viewBox='0 0 24 24' fill='none' className='size-4' aria-hidden='true'>
                  <path
                    d='M12 19V5M5 12l7-7 7 7'
                    pathLength={1}
                    stroke='var(--surface-2)'
                    strokeWidth={2}
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    className={cn(
                      'transition-[stroke-dashoffset] duration-[520ms] ease-[cubic-bezier(0.23,1,0.32,1)] [stroke-dasharray:1]',
                      isCompose ? '[stroke-dashoffset:0]' : '[stroke-dashoffset:1]'
                    )}
                  />
                </svg>
              </div>
            </div>
          </div>

          {/* Block layer: the card has morphed into the first workflow block.
              Same content as the workflow stage's focused block, at the focus
              scale, so handing off to the canvas is seamless. Top-anchored to
              match the workflow block's origin. */}
          <div
            aria-hidden='true'
            className={cn(
              'absolute inset-x-0 top-0 transition-opacity duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]',
              // Hold off until the chat content (≈220ms fade) is gone, then fade in.
              isBlock ? 'opacity-100 [transition-delay:280ms]' : 'pointer-events-none opacity-0'
            )}
          >
            <div
              className='relative'
              style={{
                width: BLOCK_WIDTH,
                transform: `scale(${WORKFLOW_FOCUS_SCALE})`,
                transformOrigin: 'top left',
              }}
            >
              <WorkflowBlockContent block={FIRST_BLOCK} />
              <span
                aria-hidden
                className='-translate-y-1/2 absolute top-5 right-[-7px] h-5 w-[7px] rounded-r-[2px] bg-[var(--workflow-edge)]'
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
