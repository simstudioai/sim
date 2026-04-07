'use client'

import React from 'react'
import { Mic } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'

interface MicButtonProps {
  isListening: boolean
  onToggle: () => void
}

export const MicButton = React.memo(function MicButton({ isListening, onToggle }: MicButtonProps) {
  return (
    <button
      type='button'
      onClick={onToggle}
      className={cn(
        'flex h-[28px] w-[28px] items-center justify-center rounded-full transition-colors',
        isListening
          ? 'bg-red-500 text-white hover:bg-red-600'
          : 'text-[var(--text-icon)] hover:bg-[#F7F7F7] dark:hover:bg-[#303030]'
      )}
      title={isListening ? 'Stop listening' : 'Voice input'}
    >
      <Mic className='h-[16px] w-[16px]' strokeWidth={2} />
    </button>
  )
})
