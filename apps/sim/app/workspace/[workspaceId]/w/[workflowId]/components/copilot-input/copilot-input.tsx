'use client'

import { memo, useCallback, useRef, useState } from 'react'
import { ArrowUp, Bot } from 'lucide-react'
import { Button, Tooltip } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { usePanelStore } from '@/stores/panel'

const SEND_BUTTON_BASE = 'h-[28px] w-[28px] rounded-full border-0 p-0 transition-colors'
const SEND_BUTTON_ACTIVE =
  'bg-[#383838] hover:bg-[#575757] dark:bg-[#E0E0E0] dark:hover:bg-[#CFCFCF]'
const SEND_BUTTON_DISABLED = 'bg-[#808080] dark:bg-[#808080]'

export const CopilotInput = memo(function CopilotInput() {
  const isPanelOpen = usePanelStore((s) => s.isPanelOpen)
  const setPendingCopilotMessage = usePanelStore((s) => s.setPendingCopilotMessage)

  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const canSubmit = value.trim().length > 0

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed) return
    setPendingCopilotMessage(trimmed)
    setValue('')
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }, [value, setPendingCopilotMessage])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value)
  }, [])

  if (isPanelOpen) return null

  return (
    <div className='pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center'>
      <div className='pointer-events-auto flex h-[44px] w-full max-w-[520px] items-center gap-2 rounded-xl border border-[var(--border-1)] bg-[var(--white)] px-3 shadow-sm dark:bg-[var(--surface-4)]'>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <div className='flex h-5 w-5 flex-shrink-0 items-center justify-center'>
              <Bot className='h-4 w-4 text-[var(--text-muted)]' />
            </div>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>Ask the copilot</Tooltip.Content>
        </Tooltip.Root>
        <input
          ref={inputRef}
          type='text'
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder='Ask copilot anything...'
          className='h-full min-w-0 flex-1 border-0 bg-transparent text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-subtle)] focus-visible:ring-0'
          autoComplete='off'
          autoCorrect='off'
          spellCheck={false}
        />
        <Button
          variant='ghost'
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={cn(
            SEND_BUTTON_BASE,
            canSubmit ? SEND_BUTTON_ACTIVE : SEND_BUTTON_DISABLED,
            'flex-shrink-0'
          )}
          aria-label='Send message'
        >
          <ArrowUp
            className='block h-[16px] w-[16px] text-white dark:text-black'
            strokeWidth={2.25}
          />
        </Button>
      </div>
    </div>
  )
})
