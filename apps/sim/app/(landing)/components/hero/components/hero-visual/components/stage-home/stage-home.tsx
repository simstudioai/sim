import type { RefObject } from 'react'
import { ArrowUp } from 'lucide-react'
import {
  HOME_GREETING,
  PROMPT_ATOMS,
  type PromptAtom,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

interface StageHomeProps {
  /** Number of prompt atoms the typewriter has revealed so far. */
  typedCount: number
  /** The prompt text region — the root cursor targets this for its "click in". */
  inputRef: RefObject<HTMLDivElement | null>
  /** The send button — the root cursor targets this to "send". */
  sendRef: RefObject<HTMLDivElement | null>
}

/**
 * The Mothership home stage — a greeting above a faithful prompt-input shell
 * that reveals the typed prompt one atom at a time, with inline `@mention`
 * icon-chips matching the real workspace input. The driving cursor is owned by
 * the parent; this stage only exposes the input and send button as ref targets.
 * Purely decorative.
 */
export function StageHome({ typedCount, inputRef, sendRef }: StageHomeProps) {
  const visible: PromptAtom[] = PROMPT_ATOMS.slice(0, typedCount)
  const isEmpty = typedCount === 0

  return (
    <div className='flex h-full w-full flex-col items-center justify-center px-10'>
      <p className='mb-7 text-balance text-center font-season text-[30px] text-[var(--text-primary)]'>
        {HOME_GREETING}
      </p>

      <div className='w-full max-w-[460px] rounded-2xl border border-[var(--border-1)] bg-[var(--surface-2)] px-2.5 py-2 shadow-sm'>
        <div
          ref={inputRef}
          className='min-h-[24px] px-1 py-1 font-body text-[15px] text-[var(--text-primary)] leading-[24px] tracking-[-0.015em]'
        >
          {isEmpty ? (
            <span className='text-[var(--text-subtle)]'>Ask Sim to build an agent…</span>
          ) : (
            <>
              {visible.map((atom, i) =>
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
              <span
                className='ml-px inline-block h-[16px] w-px translate-y-[2px] animate-caret-blink bg-[var(--text-primary)]'
                aria-hidden='true'
              />
            </>
          )}
        </div>
        <div className='mt-1 flex items-center justify-end'>
          <div
            ref={sendRef}
            aria-hidden='true'
            className='flex size-[28px] items-center justify-center rounded-full bg-[#383838]'
          >
            <ArrowUp className='size-4 text-white' />
          </div>
        </div>
      </div>
    </div>
  )
}
