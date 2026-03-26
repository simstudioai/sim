'use client'

import React from 'react'
import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import {
  SEND_BUTTON_ACTIVE,
  SEND_BUTTON_BASE,
  SEND_BUTTON_DISABLED,
} from '@/app/workspace/[workspaceId]/home/components/user-input/_components/constants'

interface SendButtonProps {
  isSending: boolean
  canSubmit: boolean
  onSubmit: () => void
  onStopGeneration: () => void
}

export const SendButton = React.memo(function SendButton({
  isSending,
  canSubmit,
  onSubmit,
  onStopGeneration,
}: SendButtonProps) {
  if (isSending) {
    return (
      <Button
        onClick={onStopGeneration}
        className={cn(SEND_BUTTON_BASE, SEND_BUTTON_ACTIVE)}
        title='Stop generation'
      >
        <svg
          className='block h-[14px] w-[14px] fill-white dark:fill-black'
          viewBox='0 0 24 24'
          xmlns='http://www.w3.org/2000/svg'
        >
          <rect x='4' y='4' width='16' height='16' rx='3' ry='3' />
        </svg>
      </Button>
    )
  }
  return (
    <Button
      onClick={onSubmit}
      disabled={!canSubmit}
      className={cn(SEND_BUTTON_BASE, canSubmit ? SEND_BUTTON_ACTIVE : SEND_BUTTON_DISABLED)}
    >
      <ArrowUp className='block h-[16px] w-[16px] text-white dark:text-black' strokeWidth={2.25} />
    </Button>
  )
})
