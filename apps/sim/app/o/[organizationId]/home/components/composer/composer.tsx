'use client'

import { Chip, ChipTextarea } from '@sim/emcn'
import { ArrowUp, Search, Square } from '@sim/emcn/icons'

interface ComposerProps {
  value: string
  mode: 'search' | 'assistant'
  isSending: boolean
  onChange: (value: string) => void
  onModeChange: (mode: 'search' | 'assistant') => void
  onSubmit: () => void
  onStop: () => void
}

/** Organization questions and document searches share one composer. */
export function Composer({
  value,
  mode,
  isSending,
  onChange,
  onModeChange,
  onSubmit,
  onStop,
}: ComposerProps) {
  return (
    <form
      className='flex flex-col gap-2'
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <ChipTextarea
        aria-label={mode === 'search' ? 'Search your sources' : 'Ask about your sources'}
        placeholder={mode === 'search' ? 'Search your sources…' : 'Ask about your sources…'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            onSubmit()
          }
        }}
      />
      <div className='flex items-center justify-between gap-2'>
        <div className='flex gap-1' role='group' aria-label='Mode'>
          <Chip active={mode === 'assistant'} onClick={() => onModeChange('assistant')}>
            Assistant
          </Chip>
          <Chip active={mode === 'search'} onClick={() => onModeChange('search')}>
            Search
          </Chip>
        </div>
        {isSending && mode === 'assistant' ? (
          <Chip leftIcon={Square} onClick={onStop}>
            Stop
          </Chip>
        ) : (
          <Chip
            type='submit'
            variant='primary'
            leftIcon={mode === 'search' ? Search : ArrowUp}
            disabled={!value.trim()}
          >
            {mode === 'search' ? 'Search' : 'Send'}
          </Chip>
        )}
      </div>
    </form>
  )
}
