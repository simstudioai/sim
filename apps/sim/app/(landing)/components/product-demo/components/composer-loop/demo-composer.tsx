'use client'

import { ArrowUp, cn, Tooltip } from '@sim/emcn'
import { Mic, Paperclip, Plus, Slash } from '@sim/emcn/icons'

/** Icon controls, in the product's order, each labelled as the product labels it. */
export const COMPOSER_ACTIONS = ['Add resources', 'Attach file', 'Skills'] as const

export type DemoComposerAction = (typeof COMPOSER_ACTIONS)[number]

const ACTION_ICONS = {
  'Add resources': Plus,
  'Attach file': Paperclip,
  Skills: Slash,
} as const satisfies Record<DemoComposerAction, typeof Plus>

/**
 * The product's resting placeholder - the first phrase its animated placeholder
 * types (`useAnimatedPlaceholder`); the first message swaps it for the
 * conversation one.
 */
const INITIAL_PLACEHOLDER = 'Ask Sim to respond to my emails...'
const CONVERSATION_PLACEHOLDER = 'Send message to Sim'

interface DemoComposerProps {
  /** The prompt as typed so far; empty rests on the placeholder. */
  prompt: string
  /** Swaps the send disc for the stop square while Sim works. */
  isSending: boolean
  /** Resting placeholder before the first message; the conversation one after. */
  isInitialView: boolean
}

/**
 * The Mothership composer's chrome, drawn for the landing: the product
 * `UserInput`'s white 16px-radius field with its hairline and resting shadow,
 * its prompt line (the real editor's box and tokens - typed text in
 * `--text-primary`, the placeholder in `--text-muted`), and its icon rail -
 * add / attach / skills on the left, the mic and the send disc that becomes a
 * stop square on the right.
 *
 * Presentational only, so the marketing page never loads the real composer's
 * data graph. Nothing here is focusable: every control is a `span`, and the
 * product's own {@link Tooltip} is projected onto it, so the icons name
 * themselves on hover exactly as they do in the app without putting five inert
 * buttons in the page's tab order. Callers own `aria-hidden`.
 */
export function DemoComposer({ prompt, isSending, isInitialView }: DemoComposerProps) {
  const written = prompt.length > 0
  const armed = isSending || written

  return (
    <div
      className={cn(
        'relative w-full rounded-2xl border border-[var(--border)] bg-[var(--white)] px-2.5 py-2 dark:bg-[var(--surface-4)]',
        isInitialView && 'shadow-xs'
      )}
    >
      <p className='m-0 min-h-[24px] whitespace-pre-wrap break-words px-1 py-1 font-body text-[15px] leading-[24px] tracking-[-0.015em] [overflow-wrap:anywhere]'>
        {written ? (
          <span className='text-[var(--text-primary)]'>{prompt}</span>
        ) : (
          <span className='text-[var(--text-muted)]'>
            {isInitialView ? INITIAL_PLACEHOLDER : CONVERSATION_PLACEHOLDER}
          </span>
        )}
      </p>

      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-1'>
          {COMPOSER_ACTIONS.map((action) => {
            const Icon = ACTION_ICONS[action]
            return (
              <Tooltip.Root key={action}>
                <Tooltip.Trigger asChild>
                  <span
                    data-action={action}
                    className='flex size-[28px] items-center justify-center rounded-full'
                  >
                    <Icon className='size-[16px] text-[var(--text-icon)]' />
                  </span>
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>{action}</Tooltip.Content>
              </Tooltip.Root>
            )
          })}
        </div>
        <div className='flex items-center gap-1.5'>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span className='flex size-[28px] items-center justify-center rounded-full'>
                <Mic className='size-[16px] text-[var(--text-icon)]' />
              </span>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>Voice input</Tooltip.Content>
          </Tooltip.Root>
          <span
            data-send
            className={cn(
              'flex size-[28px] items-center justify-center rounded-full transition-colors duration-150',
              armed ? 'bg-[#383838] dark:bg-[#E0E0E0]' : 'bg-[#808080] dark:bg-[#808080]'
            )}
          >
            {isSending ? (
              <svg
                viewBox='0 0 24 24'
                className='block size-[14px] fill-white dark:fill-black'
                aria-hidden='true'
              >
                <rect x='4' y='4' width='16' height='16' rx='3' ry='3' />
              </svg>
            ) : (
              <ArrowUp className='block size-[16px] text-white dark:text-black' />
            )}
          </span>
        </div>
      </div>
    </div>
  )
}
