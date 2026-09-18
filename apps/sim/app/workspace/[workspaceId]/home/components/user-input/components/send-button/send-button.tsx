'use client'

import React from 'react'
import { Button, cn } from '@sim/emcn'
import { ArrowUp, StopFilled } from '@sim/emcn/icons'
import {
  SEND_BUTTON_ACTIVE,
  SEND_BUTTON_BASE,
  SEND_BUTTON_DISABLED,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components/constants'

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
        variant='ghost'
        className={cn(SEND_BUTTON_BASE, SEND_BUTTON_ACTIVE)}
        title='Stop generation'
        aria-label='Stop generation'
      >
        <StopFilled className='block h-[14px] w-[14px] fill-white dark:fill-black' />
      </Button>
    )
  }
  return (
    <Button
      onClick={onSubmit}
      aria-label='Send message'
      variant='ghost'
      disabled={!canSubmit}
      className={cn(SEND_BUTTON_BASE, canSubmit ? SEND_BUTTON_ACTIVE : SEND_BUTTON_DISABLED)}
    >
      <ArrowUp className='block h-[16px] w-[16px] text-white dark:text-black' />
    </Button>
  )
})
