'use client'

import React from 'react'
import { Mic, Tooltip } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { useTranslations } from 'next-intl'

interface MicButtonProps {
  isListening: boolean
  onToggle: () => void
}

export const MicButton = React.memo(function MicButton({ isListening, onToggle }: MicButtonProps) {
  const t = useTranslations('auto')
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type='button'
          onClick={onToggle}
          aria-label={isListening ? t('stop_listening') : t('voice_input')}
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
      <Tooltip.Content side='top'>
        {isListening ? t('stop_listening') : t('voice_input')}
      </Tooltip.Content>
    </Tooltip.Root>
  )
})
