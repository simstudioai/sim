'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, cn } from '@sim/emcn'
import {
  ArrowRight,
  ArrowUp,
  ClipboardList,
  Files,
  Mic,
  Paperclip,
  Plus,
  ShieldCheck,
  Shuffle,
  Slash,
  Table,
} from '@sim/emcn/icons'
import { ThinkingLoader } from '@/components/ui'
import {
  COMPOSER_PLACEHOLDER,
  ENTERPRISE_GREETING,
  ENTERPRISE_PROMPT,
  ENTERPRISE_REPLY,
  type EnterpriseLoopPhase,
  PROMPT_CHAR_MS,
  REPLY_WORD_MS,
  SUGGESTED_ACTIONS,
} from '@/app/(landing)/enterprise/components/enterprise-platform-loop/stage-data'

const REPLY_WORDS = ENTERPRISE_REPLY.split(' ')

/** Greyscale leading icons for the suggested-action rows, in row order. */
const ACTION_ICONS = [Table, ShieldCheck, ClipboardList, Files] as const

const Caret = () => (
  <span
    aria-hidden='true'
    className='ml-px inline-block h-[16px] w-px translate-y-[2px] animate-caret-blink bg-[var(--text-primary)]'
  />
)

interface ComposerProps {
  /** Rendered in the text region (placeholder span or typed prompt). */
  children: React.ReactNode
  /** Fills the send disc with the active ink once the prompt has text. */
  active: boolean
}

/**
 * The Mothership composer chrome - white rounded field, text region on top,
 * icon rail beneath (add / attach / skills left, mic + send disc right) -
 * matching the homepage loop's composer and the real `UserInput`.
 */
function Composer({ children, active }: ComposerProps) {
  return (
    <div className='w-full rounded-2xl border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-2 shadow-[0_1px_2px_0_rgba(18,18,18,0.05)]'>
      <p className='min-h-[24px] px-1.5 pt-1 text-[15px] text-[var(--text-primary)] leading-[24px]'>
        {children}
      </p>
      <div className='mt-2 flex items-center gap-1.5'>
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
          <span
            className={cn(
              'flex size-[28px] items-center justify-center rounded-full transition-colors duration-200',
              active ? 'bg-[#383838]' : 'bg-[#808080]'
            )}
          >
            <ArrowUp className='size-[16px] text-white' />
          </span>
        </span>
      </div>
    </div>
  )
}

interface EnterpriseHomeStageProps {
  /** Current beat, driven by the parent {@link EnterprisePlatformLoop} clock. */
  phase: EnterpriseLoopPhase
  /** True during the brief fade-out before the cycle restarts. */
  fading: boolean
}

/**
 * The main pane of the enterprise loop - the real workspace's NEW-CHAT home
 * view, replayed: the centered greeting, the composer (placeholder, then the
 * enterprise prompt typing out, then the send disc arming), and the
 * "Suggested actions" rows beneath. On `dispatch` the home layer exits first
 * and the conversation layer (the sent prompt as a user bubble over the goo
 * {@link ThinkingLoader}, with the composer docked at the bottom) enters after
 * a beat; the loader thinks while the parent's stage pane builds the workflow,
 * then the reply streams in word by word on `reply`.
 *
 * Purely presentational; the clock lives in the parent so the chat and the
 * workflow stage animate off one timeline. Both typewriters derive from
 * ELAPSED time so throttled background tabs catch up instead of stalling
 * mid-sentence.
 */
export function EnterpriseHomeStage({ phase, fading }: EnterpriseHomeStageProps) {
  const isTyping = phase === 'typing'
  const isReply = phase === 'reply'
  const inConversation = phase === 'dispatch' || isReply
  const promptDone = phase === 'typed' || inConversation
  const [typedChars, setTypedChars] = useState(0)
  const [revealedWords, setRevealedWords] = useState(0)

  useEffect(() => {
    if (!isTyping) {
      setTypedChars(0)
      return
    }

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let interval: ReturnType<typeof setInterval> | null = null

    const type = () => {
      const startedAt = performance.now()
      interval = setInterval(() => {
        const elapsed = performance.now() - startedAt
        const n = Math.min(Math.floor(elapsed / PROMPT_CHAR_MS) + 1, ENTERPRISE_PROMPT.length)
        setTypedChars(n)
        if (n >= ENTERPRISE_PROMPT.length && interval) clearInterval(interval)
      }, PROMPT_CHAR_MS)
    }

    const syncMotionPreference = () => {
      if (interval) clearInterval(interval)
      if (media.matches) {
        setTypedChars(ENTERPRISE_PROMPT.length)
        return
      }
      type()
    }

    syncMotionPreference()
    media.addEventListener('change', syncMotionPreference)
    return () => {
      media.removeEventListener('change', syncMotionPreference)
      if (interval) clearInterval(interval)
    }
  }, [isTyping])

  // Stream the reply word by word while the phase holds on 'reply'; any other
  // phase (the next cycle's reset) rewinds it for the following pass.
  useEffect(() => {
    if (!isReply) {
      setRevealedWords(0)
      return
    }

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let interval: ReturnType<typeof setInterval> | null = null

    const stream = () => {
      const startedAt = performance.now()
      interval = setInterval(() => {
        const elapsed = performance.now() - startedAt
        const n = Math.min(Math.floor(elapsed / REPLY_WORD_MS) + 1, REPLY_WORDS.length)
        setRevealedWords(n)
        if (n >= REPLY_WORDS.length && interval) clearInterval(interval)
      }, REPLY_WORD_MS)
    }

    const syncMotionPreference = () => {
      if (interval) clearInterval(interval)
      if (media.matches) {
        setRevealedWords(REPLY_WORDS.length)
        return
      }
      stream()
    }

    syncMotionPreference()
    media.addEventListener('change', syncMotionPreference)
    return () => {
      media.removeEventListener('change', syncMotionPreference)
      if (interval) clearInterval(interval)
    }
  }, [isReply])

  const visiblePrompt = promptDone ? ENTERPRISE_PROMPT : ENTERPRISE_PROMPT.slice(0, typedChars)
  const hasText = visiblePrompt.length > 0

  return (
    <div
      className={cn(
        'relative h-full w-full bg-[var(--bg)] transition-opacity duration-300 ease-out',
        fading ? 'opacity-0' : 'opacity-100'
      )}
    >
      {/* Home layer - greeting, composer, suggested actions. Exits FIRST on
          dispatch (no delay) so the swap never reads as two stacked layers. */}
      <div
        className={cn(
          'absolute inset-0 flex flex-col items-center justify-center px-10 pb-[6vh] transition-opacity duration-200 ease-out',
          inConversation ? 'pointer-events-none opacity-0' : 'opacity-100'
        )}
      >
        <p className='mb-7 text-[30px] text-[var(--text-primary)]'>{ENTERPRISE_GREETING}</p>

        <div className='w-full max-w-[576px]'>
          <Composer active={hasText}>
            {hasText ? (
              <>
                {visiblePrompt}
                {isTyping && <Caret />}
              </>
            ) : (
              <span className='font-[380] text-[var(--text-muted)]'>{COMPOSER_PLACEHOLDER}</span>
            )}
          </Composer>

          <div className='mt-7'>
            <div className='flex items-center justify-between'>
              <span className='flex items-center gap-2'>
                <span className='text-[13px] text-[var(--text-muted)]'>Suggested actions</span>
                <ChevronDown className='h-[7px] w-[9px] text-[var(--text-muted)]' />
              </span>
              <span className='flex items-center gap-1.5'>
                <span className='text-[13px] text-[var(--text-muted)]'>Shuffle</span>
                <Shuffle className='size-[14px] text-[var(--text-muted)]' />
              </span>
            </div>
            <div className='mt-2 flex flex-col'>
              {SUGGESTED_ACTIONS.map((action, i) => {
                const Icon = ACTION_ICONS[i]
                return (
                  <span
                    key={action}
                    className={cn(
                      'flex items-center gap-2 border-[var(--border-1)] px-2 py-2',
                      i > 0 && 'border-t'
                    )}
                  >
                    <Icon className='size-[16px] flex-shrink-0 text-[var(--text-muted)]' />
                    <span className='flex-1 truncate text-[var(--text-primary)] text-sm'>
                      {action}
                    </span>
                    <ArrowRight className='size-[16px] shrink-0 text-[var(--text-muted)]' />
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Conversation layer - the sent exchange. Enters AFTER the home layer's
          200ms exit so the handoff is a choreographed swap, not a crossfade.
          The loader thinks through the workflow build, then the reply streams. */}
      <div
        className={cn(
          'absolute inset-0 flex flex-col transition-opacity duration-200 ease-out',
          inConversation ? 'opacity-100 [transition-delay:220ms]' : 'pointer-events-none opacity-0'
        )}
      >
        <div className='mx-auto flex min-h-0 w-full max-w-[640px] flex-1 flex-col gap-6 overflow-hidden px-6 pt-6'>
          <div className='max-w-[82%] self-end rounded-2xl bg-[var(--surface-3)] px-4 py-3 text-[15px] text-[var(--text-primary)] leading-[1.5]'>
            {ENTERPRISE_PROMPT}
          </div>
          {phase === 'dispatch' && (
            <ThinkingLoader size={26} phase labelRatio={0.58} className='mt-1' />
          )}
          <p
            className={cn(
              'text-[15px] text-[var(--text-primary)] leading-[1.6] transition-opacity duration-200 ease-out',
              isReply ? 'opacity-100' : 'opacity-0'
            )}
          >
            {REPLY_WORDS.slice(0, revealedWords).join(' ')}
          </p>
        </div>
        <div className='mx-auto mb-5 w-[calc(100%-40px)] max-w-[600px] shrink-0'>
          <Composer active={false}>
            <span className='font-[380] text-[var(--text-muted)]'>Send message to Sim</span>
          </Composer>
        </div>
      </div>
    </div>
  )
}
