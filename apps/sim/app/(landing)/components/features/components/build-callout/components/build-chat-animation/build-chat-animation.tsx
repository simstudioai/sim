'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import { Blimp } from '@sim/emcn/icons'
import { ArrowUp, Mic, Paperclip, Plus, Slash } from 'lucide-react'
import { ThinkingLoader } from '@/components/ui'

const PROMPT = 'Build a workflow to schedule and publish posts to my X account.'
const REPLY =
  'On it. Building a workflow with a schedule trigger, a drafting agent, and an X publish step.'
const REPLY_WORDS = REPLY.split(' ')

const TYPE_START_MS = 900
const TYPE_CHAR_MS = 40
const SEND_MS = 3800
const THINKING_DONE_MS = 6000
const REPLY_START_DELAY_MS = 420
const REPLY_WORD_MS = 95
const MERGE_MS = 9000
const LOOP_MS = 10400

/** Resting gap between the chat surface and the composer once the split settles. */
const SPLIT_GAP_PX = 10
/** Goo blur decay window — the liquid neck between the boxes thins and snaps over this span. */
const GOO_DECAY_MS = 850
/** Peak feGaussianBlur stdDeviation at the send beat. */
const GOO_MAX_BLUR = 16
/** Blur decay tick; stepped so the blur eases out on a (1-t)^2 curve. */
const GOO_STEP_MS = 40

/**
 * Chat-surface transition set while opening: geometry travels with the goo
 * split (500ms), the surface itself fades in fast (250ms), and the hairline
 * ring + elevation crisp in only after the liquid split settles (300ms fade,
 * 550ms delay).
 */
const CHAT_SURFACE_TRANSITION_OPEN =
  '[transition:height_500ms_ease-out,transform_500ms_ease-out,margin-bottom_500ms_ease-out,opacity_250ms_ease-out,box-shadow_300ms_ease-out_550ms]'

/**
 * Chat-surface transition set while merging back: same geometry travel, but
 * the ring + elevation drop immediately and the surface fades out fast so the
 * goo ghost carries the collapse into the composer.
 */
const CHAT_SURFACE_TRANSITION_MERGE =
  '[transition:height_500ms_ease-out,transform_500ms_ease-out,margin-bottom_500ms_ease-out,opacity_250ms_ease-out,box-shadow_200ms_ease-out]'

type BuildChatPhase =
  | 'idle'
  | 'typing'
  | 'thinking'
  | 'replyPreparing'
  | 'replying'
  | 'complete'
  | 'merging'

/**
 * Decorative Build-card Mothership loop. It mirrors the studio choreography
 * with local timers and CSS transitions so the landing page avoids motion
 * dependencies while preserving the product-window feel.
 *
 * The composer is a permanent fixture; the send beat gooey-morphs the chat
 * surface out of it, and the loop's final beat gooey-merges it back down in.
 * An SVG goo filter (state-driven blur → alpha-contrast matrix → atop
 * composite) is applied to an aria-hidden ghost layer of two solid white
 * rects mirroring the real boxes (both measured with a ResizeObserver) —
 * never to the real UI, which stays crisp above it. The filtered silhouette
 * renders a liquid meniscus that necks and snaps as the boxes separate (and
 * re-welds as they merge); each morph's blur decays on a (1-t)^2 curve over
 * 850ms. The chat surface's ring + shadow crisp in only after the split and
 * drop instantly at the merge, so the ghost carries the collapse.
 */
export function BuildChatAnimation() {
  const [phase, setPhase] = useState<BuildChatPhase>('idle')
  const [typedChars, setTypedChars] = useState(0)
  const [revealedWords, setRevealedWords] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [morphing, setMorphing] = useState(false)
  const [gooBlur, setGooBlur] = useState(0)
  const [chatContentH, setChatContentH] = useState(0)
  const [composerH, setComposerH] = useState(94)
  const chatContentRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const content = chatContentRef.current
    const composer = composerRef.current
    if (!content || !composer) return
    const measure = () => {
      setChatContentH(content.offsetHeight)
      setComposerH(composer.offsetHeight)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    observer.observe(composer)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!morphing) return
    let progress = 0
    const interval = setInterval(() => {
      progress += GOO_STEP_MS / GOO_DECAY_MS
      if (progress >= 1) {
        setGooBlur(0)
        setMorphing(false)
        clearInterval(interval)
        return
      }
      setGooBlur(GOO_MAX_BLUR * (1 - progress) ** 2)
    }, GOO_STEP_MS)
    return () => clearInterval(interval)
  }, [morphing])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const timeouts: ReturnType<typeof setTimeout>[] = []
    const intervals: ReturnType<typeof setInterval>[] = []

    const clearScheduled = () => {
      for (const timeout of timeouts) clearTimeout(timeout)
      for (const interval of intervals) clearInterval(interval)
      timeouts.length = 0
      intervals.length = 0
    }

    const showFinished = () => {
      setReducedMotion(true)
      setPhase('complete')
      setTypedChars(0)
      setRevealedWords(REPLY_WORDS.length)
      setMorphing(false)
      setGooBlur(0)
    }

    const startTyping = () => {
      setPhase('typing')
      const startedAt = performance.now()
      const interval = setInterval(() => {
        const elapsed = performance.now() - startedAt
        const nextChars = Math.min(Math.floor(elapsed / TYPE_CHAR_MS) + 1, PROMPT.length)
        setTypedChars(nextChars)
        if (nextChars >= PROMPT.length) clearInterval(interval)
      }, TYPE_CHAR_MS)
      intervals.push(interval)
    }

    const startReply = () => {
      setPhase('replying')
      const startedAt = performance.now()
      const interval = setInterval(() => {
        const elapsed = performance.now() - startedAt
        const nextWords = Math.min(Math.floor(elapsed / REPLY_WORD_MS) + 1, REPLY_WORDS.length)
        setRevealedWords(nextWords)
        if (nextWords >= REPLY_WORDS.length) {
          clearInterval(interval)
          setPhase('complete')
        }
      }, REPLY_WORD_MS)
      intervals.push(interval)
    }

    const runLoop = () => {
      clearScheduled()
      setReducedMotion(false)
      setPhase('idle')
      setTypedChars(0)
      setRevealedWords(0)
      setMorphing(false)
      setGooBlur(0)

      timeouts.push(setTimeout(startTyping, TYPE_START_MS))
      timeouts.push(
        setTimeout(() => {
          setPhase('thinking')
          setTypedChars(0)
          setMorphing(true)
          setGooBlur(GOO_MAX_BLUR)
        }, SEND_MS)
      )
      timeouts.push(setTimeout(() => setPhase('replyPreparing'), THINKING_DONE_MS))
      timeouts.push(setTimeout(startReply, THINKING_DONE_MS + REPLY_START_DELAY_MS))
      timeouts.push(
        setTimeout(() => {
          setPhase('merging')
          setMorphing(true)
          setGooBlur(GOO_MAX_BLUR)
        }, MERGE_MS)
      )
      timeouts.push(setTimeout(runLoop, LOOP_MS))
    }

    const syncMotionPreference = () => {
      clearScheduled()
      if (media.matches) {
        showFinished()
        return
      }
      runLoop()
    }

    syncMotionPreference()
    media.addEventListener('change', syncMotionPreference)
    return () => {
      media.removeEventListener('change', syncMotionPreference)
      clearScheduled()
    }
  }, [])

  const composerText = phase === 'typing' ? PROMPT.slice(0, typedChars) : ''
  const chatOpen = reducedMotion || !['idle', 'typing', 'merging'].includes(phase)
  const thinkingPhraseVisible = phase === 'thinking'
  const replyVisible =
    reducedMotion || phase === 'replyPreparing' || phase === 'replying' || phase === 'complete'
  const replyComplete = reducedMotion || phase === 'complete'
  const replyText = REPLY_WORDS.slice(0, reducedMotion ? REPLY_WORDS.length : revealedWords).join(
    ' '
  )

  return (
    <div className='absolute inset-0 flex items-end justify-start p-10 max-sm:px-3 max-sm:py-0 max-lg:items-center max-lg:justify-center max-lg:px-8 max-lg:py-8'>
      <svg width='0' height='0' aria-hidden='true' className='absolute'>
        <defs>
          <filter id='build-callout-goo'>
            <feGaussianBlur in='SourceGraphic' stdDeviation={gooBlur} result='blur' />
            <feColorMatrix
              in='blur'
              type='matrix'
              values='1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -8'
              result='goo'
            />
            <feComposite in='SourceGraphic' in2='goo' operator='atop' />
          </filter>
        </defs>
      </svg>

      <div className='relative h-[310px] w-full max-w-[560px] max-sm:h-[270px] max-sm:max-w-[430px]'>
        {!reducedMotion && (
          <div
            aria-hidden='true'
            className='pointer-events-none absolute inset-0 z-0 flex flex-col justify-end [filter:url(#build-callout-goo)_drop-shadow(0_1px_3px_rgba(28,40,64,0.10))]'
          >
            <div
              className={cn(
                'w-full rounded-2xl bg-[var(--white)] transition-[height,transform,margin-bottom] duration-500 ease-out motion-reduce:transition-none',
                chatOpen ? 'translate-y-0' : 'translate-y-5'
              )}
              style={{
                height: chatOpen ? chatContentH : 0,
                marginBottom: chatOpen ? SPLIT_GAP_PX : 0,
              }}
            />
            <div className='w-full rounded-2xl bg-[var(--white)]' style={{ height: composerH }} />
          </div>
        )}

        <div className='relative z-10 flex h-full flex-col justify-end'>
          <section
            className={cn(
              'w-full overflow-hidden rounded-2xl bg-[var(--white)]',
              !reducedMotion &&
                (chatOpen ? CHAT_SURFACE_TRANSITION_OPEN : CHAT_SURFACE_TRANSITION_MERGE),
              chatOpen
                ? 'translate-y-0 opacity-100 shadow-[0_24px_80px_color-mix(in_srgb,var(--text-primary)_14%,transparent),0_0_0_1px_var(--border-1)]'
                : 'translate-y-5 opacity-0 shadow-[0_24px_80px_transparent,0_0_0_1px_transparent]'
            )}
            style={{
              height: chatOpen ? chatContentH : 0,
              marginBottom: chatOpen ? SPLIT_GAP_PX : 0,
            }}
          >
            <div ref={chatContentRef} className='flex flex-col gap-4 p-4 max-sm:gap-2.5 max-sm:p-3'>
              <div className='ml-auto max-w-[78%] rounded-lg bg-[var(--surface-5)] px-3 py-2 text-[15px] text-[var(--text-primary)] leading-[1.45] max-sm:max-w-[86%] max-sm:text-[12px] max-sm:leading-[1.35]'>
                {PROMPT}
              </div>

              <div className='relative min-h-[34px]'>
                <div
                  className={cn(
                    'absolute inset-0 flex items-center transition-opacity duration-300 ease-out motion-reduce:transition-none',
                    thinkingPhraseVisible ? 'opacity-100' : 'opacity-0'
                  )}
                >
                  <ThinkingLoader
                    size={20}
                    startVariant='corners'
                    phase
                    labelRatio={0.66}
                    className='text-[var(--text-body)]'
                  />
                </div>

                <div
                  className={cn(
                    'flex items-start gap-2.5 text-[15px] text-[var(--text-primary)] leading-[1.5] transition-opacity duration-300 ease-out motion-reduce:transition-none max-sm:text-[12px] max-sm:leading-[1.4]',
                    replyVisible ? 'opacity-100' : 'opacity-0'
                  )}
                >
                  <span className='relative mt-0.5 size-[20px] shrink-0'>
                    <span
                      className={cn(
                        'absolute inset-0 flex items-center justify-center transition-opacity duration-200 ease-out motion-reduce:transition-none',
                        replyComplete ? 'opacity-0' : 'opacity-100'
                      )}
                    >
                      <ThinkingLoader size={20} startVariant='corners' />
                    </span>
                    <span
                      className={cn(
                        'absolute inset-0 flex items-center justify-center transition-opacity duration-200 ease-out motion-reduce:transition-none',
                        replyComplete ? 'opacity-100' : 'opacity-0'
                      )}
                    >
                      <Blimp className='size-[18px] text-[var(--text-icon)]' />
                    </span>
                  </span>
                  <p className='flex-1'>{replyText}</p>
                </div>
              </div>
            </div>
          </section>

          <div
            ref={composerRef}
            className='h-[94px] w-full rounded-2xl border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-2 shadow-[0_18px_60px_color-mix(in_srgb,var(--text-primary)_12%,transparent)]'
          >
            <p
              className={cn(
                'min-h-[42px] px-1.5 pt-1 text-[15px] leading-[1.35] max-sm:text-[13px]',
                composerText ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
              )}
            >
              {composerText || 'Send message to Sim'}
            </p>
            <div className='flex items-center gap-1.5'>
              <span className='flex size-[28px] items-center justify-center rounded-full'>
                <Plus className='size-[16px] text-[var(--text-icon)]' />
              </span>
              <span className='flex size-[28px] items-center justify-center rounded-full'>
                <Paperclip className='size-[16px] text-[var(--text-icon)]' />
              </span>
              <span className='flex size-[28px] items-center justify-center rounded-full'>
                <Slash className='size-[16px] text-[var(--text-icon)]' />
              </span>
              <span className='ml-auto flex items-center gap-1.5'>
                <span className='flex size-[28px] items-center justify-center rounded-full'>
                  <Mic className='size-[16px] text-[var(--text-icon)]' />
                </span>
                <span className='flex size-[28px] items-center justify-center rounded-full bg-[#808080]'>
                  <ArrowUp className='size-[16px] text-[var(--surface-1)]' />
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
