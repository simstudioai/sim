'use client'

import React from 'react'
import { cn, Mic, Tooltip } from '@sim/emcn'

interface MicButtonProps {
  isListening: boolean
  onToggle: () => void
}

export const MicButton = React.memo(function MicButton({ isListening, onToggle }: MicButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type='button'
          onClick={onToggle}
          aria-label={isListening ? 'Stop listening' : 'Voice input'}
          className={cn(
            'flex h-[28px] w-[28px] items-center justify-center rounded-full transition-colors',
            isListening
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'text-[var(--text-icon)] hover:bg-[#F7F7F7] dark:hover:bg-[#303030]'
          )}
        >
          <Mic className='h-[16px] w-[16px]' />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content side='top'>{isListening ? 'Stop listening' : 'Voice input'}</Tooltip.Content>
    </Tooltip.Root>
  )
})
