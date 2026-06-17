'use client'

import { type RefObject, useLayoutEffect, useRef, useState } from 'react'
import { ThinkingLoader } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { WorkflowBlockContent } from '@/app/(landing)/components/hero/components/hero-visual/workflow-block'
import {
  ANSWER_TEXT,
  BLOCK_WIDTH,
  BLOCKS,
  HOME_GREETING,
  PROMPT_ATOMS,
  type PromptAtom,
  WORKFLOW_FOCUS_SCALE,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

/**
 * What the Mothership chat is showing right now. `block` is the terminal beat:
 * the card morphs into the first workflow block (the chat shell resizes and its
 * content becomes the block's), handing off seamlessly to the workflow stage.
 */
export type HomeMode = 'compose' | 'thinking' | 'answering' | 'block'

/** The first workflow block, shown inside the card during the morph. */
const FIRST_BLOCK = BLOCKS[0]
/** GitHub block content's natural (unscaled) height in px. */
const GH_CONTENT_HEIGHT = 77
/** The chat card's width (compose/conversation). */
const CHAT_CARD_WIDTH = 460
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
  /** The prompt text region — the root cursor targets this for its "click in". */
  inputRef: RefObject<HTMLDivElement | null>
  /** The send button — the root cursor targets this to "send". */
  sendRef: RefObject<HTMLDivElement | null>
  /** Hide the send button's arrow (used during the zoom-reveal beat). */
  arrowHidden?: boolean
  /**
   * Reveal the greeting headline. Held back during the boot zoom-in/out so it
   * doesn't show prematurely, then shimmers in once the input has settled. Its
   * space is always reserved, so revealing it never shifts the layout.
   */
  showGreeting?: boolean
}

/** Staggered enter for a chat bubble — translateY + opacity + blur, interruptible. */
const ENTER_BASE =
  'transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.2,0,0,1)]'
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
          <span key={i}>{atom.char}</span>
        ) : (
          <span key={i}>
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
 * The Mothership home stage — a single white card that morphs adaptively.
 *
 * Both content layers (the compose input and the conversation) are absolutely
 * stacked and TOP-anchored; the card measures whichever is active and animates
 * its own height to hug it (`transition-[height]`). This makes the card flexible
 * — it grows from the input to the reply, and from the thinking loader to the
 * typed answer — with no dead space and no fixed min-height. Top-anchoring keeps
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
  arrowHidden = false,
  showGreeting = false,
}: StageHomeProps) {
  const isCompose = mode === 'compose'
  const isBlock = mode === 'block'
  const convoShown = mode === 'thinking' || mode === 'answering'
  const composeRef = useRef<HTMLDivElement>(null)
  const convoRef = useRef<HTMLDivElement>(null)
  const [cardHeight, setCardHeight] = useState(80)

  // Hug the active layer: measure its natural height and animate the card to it.
  // Re-runs as the prompt/answer type out, so the card grows line by line. In
  // block mode the card takes a fixed height (matching the focused workflow
  // block), so skip measuring there.
  useLayoutEffect(() => {
    if (isBlock) return
    const active = isCompose ? composeRef.current : convoRef.current
    // Guard against a collapsed/unpainted layout (width ~0) measuring a
    // wildly-wrapped height and poisoning the card size.
    if (active && active.offsetWidth > 120) setCardHeight(active.offsetHeight)
  }, [isBlock, isCompose, mode, typedCount, answerTypedCount])

  const visible = PROMPT_ATOMS.slice(0, typedCount)
  const isEmpty = typedCount === 0
  const answer = ANSWER_TEXT.slice(0, answerTypedCount)

  return (
    <div className='flex h-full w-full flex-col items-center justify-center px-10'>
      <div className='flex w-full max-w-[460px] flex-col gap-5'>
        {/* Greeting — collapses as the conversation takes over. */}
        <div
          className={cn(
            'overflow-hidden text-center transition-[height,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]',
            isCompose ? 'h-[40px] opacity-100' : 'h-0 opacity-0'
          )}
        >
          {showGreeting ? (
            <p
              className={cn(
                'font-season text-[30px] leading-[40px]',
                '[-webkit-background-clip:text] bg-clip-text text-transparent [background-image:linear-gradient(90deg,var(--text-primary)_40%,var(--text-subtle)_50%,var(--text-primary)_60%)] [background-size:200%_100%] animate-hero-greeting-reveal motion-reduce:animate-none motion-reduce:[-webkit-background-clip:border-box] motion-reduce:bg-clip-border motion-reduce:[background-image:none] motion-reduce:text-[var(--text-primary)]'
              )}
            >
              {HOME_GREETING}
            </p>
          ) : null}
        </div>

        {/* White card — the SAME shell throughout: it hugs the active chat layer,
            then resizes and rounds down to become the first workflow block (the
            chat → workflow morph happens on this one continuous element). */}
        <div
          className={cn(
            // The chat input's aesthetic (rounded-2xl, border, soft shadow) is
            // kept THROUGHOUT — including once morphed into the workflow block —
            // so it stays the same white card, just resized.
            'relative mx-auto overflow-hidden rounded-2xl border border-[var(--border-1)] bg-[var(--surface-2)] shadow-sm transition-[width,height,transform] duration-[620ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
            // Nudge up to cancel the chat column's greeting+gap offset, so the
            // card centers exactly where the focused workflow block lands.
            isBlock && '-translate-y-[10px]'
          )}
          style={{
            width: isBlock ? BLOCK_CARD_WIDTH : CHAT_CARD_WIDTH,
            height: isBlock ? BLOCK_CARD_HEIGHT : cardHeight,
          }}
        >
          {/* Compose layer: the prompt input + send button. */}
          <div
            ref={composeRef}
            className={cn(
              'absolute inset-x-0 top-0 px-2.5 py-2 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]',
              isCompose ? 'opacity-100' : 'pointer-events-none opacity-0'
            )}
          >
            <div
              ref={inputRef}
              className='min-h-[24px] px-1 py-1 font-body text-[15px] text-[var(--text-primary)] leading-[24px] tracking-[-0.015em]'
            >
              {isEmpty ? (
                <span className='text-[var(--text-subtle)]'>Ask Sim to build an agent…</span>
              ) : (
                <>
                  <PromptAtoms atoms={visible} />
                  <Caret />
                </>
              )}
            </div>
            <div className='mt-1 flex items-center justify-end'>
              <div
                ref={sendRef}
                aria-hidden='true'
                className='flex size-[28px] items-center justify-center rounded-full bg-[#383838]'
              >
                {/* Up-arrow that draws itself on (shaft then head) via
                    stroke-dashoffset — `pathLength={1}` normalizes the dash so
                    one offset value covers the whole glyph. Reveals as the orb
                    settles into this button, instead of a flat fade. */}
                <svg viewBox='0 0 24 24' fill='none' className='size-4' aria-hidden='true'>
                  <path
                    d='M12 19V5M5 12l7-7 7 7'
                    pathLength={1}
                    stroke='#ffffff'
                    strokeWidth={2}
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    className={cn(
                      '[stroke-dasharray:1] transition-[stroke-dashoffset] duration-[520ms] ease-[cubic-bezier(0.23,1,0.32,1)]',
                      arrowHidden ? '[stroke-dashoffset:1]' : '[stroke-dashoffset:0]'
                    )}
                  />
                </svg>
              </div>
            </div>
          </div>

          {/* Conversation layer: user bubble + Mothership reply, top-anchored.
              On morph it fades out FIRST (fast), so the block content fades in
              only once the chat content is gone — a clean swap, not a crossfade. */}
          <div
            ref={convoRef}
            className={cn(
              'pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-2 p-3.5 transition-opacity duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)]',
              isBlock && 'opacity-0'
            )}
          >
            <div
              className={cn(
                'max-w-[82%] self-end rounded-2xl bg-[var(--surface-6)] px-3.5 py-2 font-body text-[15px] text-[var(--text-primary)] leading-[22px] tracking-[-0.015em] [transition-delay:80ms]',
                ENTER_BASE,
                enterState(convoShown)
              )}
            >
              <PromptAtoms atoms={PROMPT_ATOMS} />
            </div>
            <div
              className={cn(
                'max-w-[88%] self-start px-1 font-body text-[15px] text-[var(--text-primary)] leading-[22px] tracking-[-0.015em] [transition-delay:160ms]',
                ENTER_BASE,
                enterState(convoShown)
              )}
            >
              {mode === 'thinking' ? (
                <ThinkingLoader phase startVariant='corners' size={22} />
              ) : (
                <p>
                  {answer}
                  <Caret />
                </p>
              )}
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
              style={{
                width: BLOCK_WIDTH,
                transform: `scale(${WORKFLOW_FOCUS_SCALE})`,
                transformOrigin: 'top left',
              }}
            >
              <WorkflowBlockContent block={FIRST_BLOCK} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
