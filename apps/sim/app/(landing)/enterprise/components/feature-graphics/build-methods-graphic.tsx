'use client'

import { useEffect, useState } from 'react'
import { cn } from '@sim/emcn'
import { ArrowUp, FolderCode, Mic, Paperclip, Plus, Slash } from '@sim/emcn/icons'
import { ThinkingLoader } from '@/components/ui'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics/feature-graphic-shell'
import { FeaturePlatformPanel } from '@/app/(landing)/enterprise/components/feature-graphics/feature-platform-panel'

interface CodeSegment {
  text: string
  tone?: 'muted' | 'primary'
}

/** The `support-agent.ts` contents, split into tone-colored typewriter segments. */
const CODE_LINES: CodeSegment[][] = [
  [
    { text: 'import', tone: 'muted' },
    { text: ' ' },
    { text: '{ agent }', tone: 'primary' },
    { text: ' ' },
    { text: 'from', tone: 'muted' },
    { text: ' ' },
    { text: "'@sim/sdk'", tone: 'primary' },
  ],
  [
    { text: 'const', tone: 'muted' },
    { text: ' ' },
    { text: 'supportAgent', tone: 'primary' },
    { text: ' ' },
    { text: '= await', tone: 'muted' },
    { text: ' ' },
    { text: 'agent', tone: 'primary' },
  ],
  [{ text: '  .workflow({' }],
  [
    { text: '    ' },
    { text: 'name:', tone: 'muted' },
    { text: ' ' },
    { text: "'Support agent'", tone: 'primary' },
    { text: ',' },
  ],
  [{ text: '    ' }, { text: 'instructions:', tone: 'muted' }],
  [{ text: '    ' }, { text: "'Answer customer questions'", tone: 'primary' }, { text: ',' }],
  [
    { text: '    ' },
    { text: 'tools:', tone: 'muted' },
    { text: ' ' },
    { text: '[zendesk, slack]', tone: 'primary' },
    { text: ',' },
  ],
  [{ text: '  })' }],
]

const CODE_LINE_LENGTHS = CODE_LINES.map((line) =>
  line.reduce((total, segment) => total + segment.text.length, 0)
)
const CODE_LINE_STARTS = CODE_LINE_LENGTHS.map((_, index) =>
  CODE_LINE_LENGTHS.slice(0, index).reduce((total, length) => total + length, 0)
)
const CODE_TOTAL_CHARS = CODE_LINE_LENGTHS.reduce((total, length) => total + length, 0)

const PROMPT = 'Create a support agent that answers customer questions'
const REPLY =
  'On it — scaffolding a support agent with Zendesk and Slack that answers customer questions.'
const REPLY_WORDS = REPLY.split(' ')

const CODE_START_MS = 500
const CODE_CHAR_MS = 24
const COMPOSER_IN_MS = 5300
const PROMPT_START_MS = 6000
const PROMPT_CHAR_MS = 55
const SEND_MS = 9600
const CHAT_ENTER_MS = 10100
const REPLY_MS = 11600
const REPLY_WORD_MS = 80
const FADE_MS = 15100
const LOOP_MS = 15700

type BuildMethodsPhase =
  | 'idle'
  | 'code'
  | 'composer'
  | 'prompt'
  | 'exit'
  | 'chat'
  | 'reply'
  | 'fade'

const SEGMENT_TONE_CLASS = {
  muted: 'text-[var(--text-muted)]',
  primary: 'text-[var(--text-primary)]',
} as const

/** Renders one code line clipped to the number of characters typed so far. */
function renderCodeLine(segments: CodeSegment[], visibleChars: number) {
  const rendered = []
  let remaining = visibleChars
  for (let index = 0; index < segments.length && remaining > 0; index++) {
    const segment = segments[index]
    rendered.push(
      <span key={index} className={segment.tone && SEGMENT_TONE_CLASS[segment.tone]}>
        {segment.text.slice(0, remaining)}
      </span>
    )
    remaining -= segment.text.length
  }
  return rendered
}

/**
 * Decorative loop for the "Build visually or with code" tile: the
 * `support-agent.ts` editor types itself out, the platform composer slides up
 * and receives a typed prompt, and the send beat swaps the editor for a
 * headerless Mothership chat surface — the same agent built from code or from
 * a message. All window bodies sit on `--white`, matching the hero surfaces.
 *
 * Window handoffs are exit-before-enter orchestration, never crossfades: the
 * editor fully exits (slides down and fades over 380ms) during the `exit`
 * phase, the stage holds empty for a beat, and only then does the chat enter
 * (slide-up fade, 420ms). The composer is a pure transform slide from below
 * the shell's clipped edge — its opacity never animates, so it never reads as
 * a translucent layer over the editor. Panel transitions are disabled on the
 * `idle` reset so state snaps back while the scene-level fade has the tile at
 * zero opacity. Local timers + CSS transitions only, mirroring the other
 * landing loops; under `prefers-reduced-motion` it renders the finished
 * editor + composer as a static frame.
 */
export function BuildMethodsGraphic() {
  const [phase, setPhase] = useState<BuildMethodsPhase>('idle')
  const [typedCodeChars, setTypedCodeChars] = useState(0)
  const [typedPromptChars, setTypedPromptChars] = useState(0)
  const [revealedReplyWords, setRevealedReplyWords] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(false)

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
      setPhase('composer')
      setTypedCodeChars(CODE_TOTAL_CHARS)
      setTypedPromptChars(0)
      setRevealedReplyWords(0)
    }

    const startCodeTyping = () => {
      setPhase('code')
      const startedAt = performance.now()
      const interval = setInterval(() => {
        const elapsed = performance.now() - startedAt
        const next = Math.min(Math.floor(elapsed / CODE_CHAR_MS) + 1, CODE_TOTAL_CHARS)
        setTypedCodeChars(next)
        if (next >= CODE_TOTAL_CHARS) clearInterval(interval)
      }, CODE_CHAR_MS)
      intervals.push(interval)
    }

    const startPromptTyping = () => {
      setPhase('prompt')
      const startedAt = performance.now()
      const interval = setInterval(() => {
        const elapsed = performance.now() - startedAt
        const next = Math.min(Math.floor(elapsed / PROMPT_CHAR_MS) + 1, PROMPT.length)
        setTypedPromptChars(next)
        if (next >= PROMPT.length) clearInterval(interval)
      }, PROMPT_CHAR_MS)
      intervals.push(interval)
    }

    const startReply = () => {
      setPhase('reply')
      const startedAt = performance.now()
      const interval = setInterval(() => {
        const elapsed = performance.now() - startedAt
        const next = Math.min(Math.floor(elapsed / REPLY_WORD_MS) + 1, REPLY_WORDS.length)
        setRevealedReplyWords(next)
        if (next >= REPLY_WORDS.length) clearInterval(interval)
      }, REPLY_WORD_MS)
      intervals.push(interval)
    }

    const runLoop = () => {
      clearScheduled()
      setReducedMotion(false)
      setPhase('idle')
      setTypedCodeChars(0)
      setTypedPromptChars(0)
      setRevealedReplyWords(0)

      timeouts.push(setTimeout(startCodeTyping, CODE_START_MS))
      timeouts.push(setTimeout(() => setPhase('composer'), COMPOSER_IN_MS))
      timeouts.push(setTimeout(startPromptTyping, PROMPT_START_MS))
      timeouts.push(setTimeout(() => setPhase('exit'), SEND_MS))
      timeouts.push(setTimeout(() => setPhase('chat'), CHAT_ENTER_MS))
      timeouts.push(setTimeout(startReply, REPLY_MS))
      timeouts.push(setTimeout(() => setPhase('fade'), FADE_MS))
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

  const codeTypingActive = phase === 'code' && typedCodeChars < CODE_TOTAL_CHARS
  const composerVisible = reducedMotion || !['idle', 'code'].includes(phase)
  const editorExited = !reducedMotion && ['exit', 'chat', 'reply', 'fade'].includes(phase)
  const chatOpen = !reducedMotion && ['chat', 'reply', 'fade'].includes(phase)
  const promptText = phase === 'prompt' || phase === 'exit' ? PROMPT.slice(0, typedPromptChars) : ''
  const replyText = REPLY_WORDS.slice(0, revealedReplyWords).join(' ')
  const lastStartedLine = CODE_LINE_STARTS.reduce(
    (last, start, index) => (typedCodeChars > start ? index : last),
    -1
  )

  return (
    <FeatureGraphicShell>
      <div
        className={cn(
          'absolute inset-0 transition-opacity duration-300 ease-out motion-reduce:transition-none',
          phase === 'fade' ? 'opacity-0' : 'opacity-100'
        )}
      >
        <FeaturePlatformPanel
          className={cn(
            'top-5 bg-[var(--white)] transition-[transform,opacity] duration-[380ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
            phase === 'idle' && 'transition-none',
            editorExited ? 'translate-y-16 opacity-0' : 'translate-y-0 opacity-100'
          )}
          icon={FolderCode}
          title='support-agent.ts'
        >
          <div className='min-h-[190px] space-y-2 p-4 font-mono text-caption leading-[1.7]'>
            {CODE_LINES.map((line, index) =>
              typedCodeChars > CODE_LINE_STARTS[index] ? (
                <div key={index} className='flex gap-3'>
                  <span className='w-3 select-none text-right text-[var(--text-muted)]'>
                    {index + 1}
                  </span>
                  <code>
                    {renderCodeLine(line, typedCodeChars - CODE_LINE_STARTS[index])}
                    {codeTypingActive && index === lastStartedLine && (
                      <span className='ml-px inline-block h-[1.1em] w-px translate-y-[2px] animate-pulse bg-[var(--text-primary)] align-text-bottom' />
                    )}
                  </code>
                </div>
              ) : null
            )}
          </div>
        </FeaturePlatformPanel>

        <div
          aria-hidden='true'
          className={cn(
            'absolute top-5 right-0 bottom-0 left-0 overflow-hidden rounded-tl-xl border-[var(--border-1)] border-t border-l bg-[var(--white)] shadow-sm transition-[transform,opacity] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
            phase === 'idle' && 'transition-none',
            chatOpen ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
          )}
        >
          <div className='flex flex-col gap-3 p-4'>
            <div className='max-w-[80%] self-end rounded-lg bg-[var(--surface-3)] px-3 py-2 text-[var(--text-primary)] text-caption leading-[1.5]'>
              {PROMPT}
            </div>
            {phase === 'chat' && <ThinkingLoader size={18} phase labelRatio={0.6} />}
            <p
              className={cn(
                'text-[var(--text-primary)] text-caption leading-[1.6] transition-opacity duration-200 ease-out',
                phase === 'reply' || phase === 'fade' ? 'opacity-100' : 'opacity-0'
              )}
            >
              {replyText}
            </p>
          </div>
        </div>

        <div
          className={cn(
            'absolute right-3 bottom-5 left-5 rounded-xl border border-[var(--border-1)] bg-[var(--white)] px-3 py-2.5 shadow-sm transition-transform duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
            phase === 'idle' && 'transition-none',
            composerVisible ? 'translate-y-0' : 'translate-y-[130%]'
          )}
        >
          <p
            className={cn(
              'px-1 text-caption',
              promptText ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
            )}
          >
            {promptText || 'Send message to Sim'}
            {phase === 'prompt' && typedPromptChars < PROMPT.length && (
              <span className='ml-px inline-block h-[1.1em] w-px translate-y-[2px] animate-pulse bg-[var(--text-primary)] align-text-bottom' />
            )}
          </p>
          <div className='mt-2 flex items-center gap-1'>
            <span className='flex size-6 items-center justify-center'>
              <Plus className='size-[14px] text-[var(--text-icon)]' />
            </span>
            <span className='flex size-6 items-center justify-center'>
              <Paperclip className='size-[14px] text-[var(--text-icon)]' />
            </span>
            <span className='flex size-6 items-center justify-center'>
              <Slash className='size-[14px] text-[var(--text-icon)]' />
            </span>
            <span className='ml-auto flex size-6 items-center justify-center'>
              <Mic className='size-[14px] text-[var(--text-icon)]' />
            </span>
            <span className='flex size-7 items-center justify-center rounded-full bg-[var(--text-primary)]'>
              <ArrowUp className='size-[14px] text-[var(--text-inverse)]' />
            </span>
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
