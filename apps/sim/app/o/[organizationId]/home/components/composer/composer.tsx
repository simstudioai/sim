'use client'

import { Button, cn } from '@sim/emcn'
import { ArrowUp } from '@sim/emcn/icons'
import { useAnimatedPlaceholder } from '@/hooks/use-animated-placeholder'

const SEND_BUTTON_BASE = 'size-[28px] rounded-full border-0 p-0 transition-colors'
const SEND_BUTTON_ACTIVE =
  'bg-[#383838] hover:bg-[#575757] dark:bg-[#E0E0E0] dark:hover:bg-[#CFCFCF]'
const SEND_BUTTON_DISABLED = 'bg-[#808080] dark:bg-[#808080]'

interface ComposerProps {
  value: string
  /** On the empty home the placeholder types itself and the field is taller; in a chat it is the plain footer input. */
  isInitialView: boolean
  isSending: boolean
  onChange: (value: string) => void
  onSubmit: () => void
  onStop: () => void
}

/**
 * The organization home composer: a question to the Assistant. Wears the
 * workspace chat input's chrome — the framed field and the send control — and
 * carries only the controls that are wired for the organization.
 */
export function Composer({
  value,
  isInitialView,
  isSending,
  onChange,
  onSubmit,
  onStop,
}: ComposerProps) {
  const canSubmit = value.trim().length > 0
  const animatedPlaceholder = useAnimatedPlaceholder(isInitialView)
  const placeholder = isInitialView ? animatedPlaceholder : 'Send message to Sim'

  return (
    <div
      className={cn(
        'relative z-10 mx-auto w-full max-w-chat rounded-2xl border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-2 dark:bg-[var(--surface-4)]',
        isInitialView && 'shadow-ambient'
      )}
    >
      <div
        className={cn(
          'relative max-h-[200px] overflow-y-auto overflow-x-hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          isInitialView && 'min-h-[56px]'
        )}
      >
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              onSubmit()
            }
          }}
          placeholder={placeholder}
          aria-label='Ask Sim'
          rows={1}
          className='field-sizing-content m-0 box-border min-h-[24px] w-full resize-none border-0 bg-transparent px-1 py-1 font-body text-[14px] text-[var(--text-primary)] leading-[24px] tracking-[-0.015em] outline-hidden [overflow-wrap:anywhere] placeholder:text-[var(--text-muted)] focus-visible:ring-0 focus-visible:ring-offset-0'
        />
      </div>

      <div className='flex items-center justify-end'>
        {isSending ? (
          <Button
            type='button'
            variant='ghost'
            onClick={onStop}
            aria-label='Stop generation'
            className={cn(SEND_BUTTON_BASE, SEND_BUTTON_ACTIVE)}
          >
            <svg
              className='block size-[14px] fill-white dark:fill-black'
              viewBox='0 0 24 24'
              xmlns='http://www.w3.org/2000/svg'
            >
              <rect x='4' y='4' width='16' height='16' rx='3' ry='3' />
            </svg>
          </Button>
        ) : (
          <Button
            type='button'
            variant='ghost'
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-label='Send'
            className={cn(SEND_BUTTON_BASE, canSubmit ? SEND_BUTTON_ACTIVE : SEND_BUTTON_DISABLED)}
          >
            <ArrowUp className='block size-[16px] text-white dark:text-black' />
          </Button>
        )}
      </div>
    </div>
  )
}
