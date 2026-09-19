'use client'

import React from 'react'
import { ComposerActionButton } from '@sim/emcn'
import { ArrowUp, StopFilled } from '@sim/emcn/icons'

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
      <ComposerActionButton
        onClick={onStopGeneration}
        title='Stop generation'
        aria-label='Stop generation'
      >
        <StopFilled className='block h-[14px] w-[14px] fill-white dark:fill-black' />
      </ComposerActionButton>
    )
  }
  return (
    <ComposerActionButton
      onClick={onSubmit}
      aria-label='Send message'
      disabled={!canSubmit}
      active={canSubmit}
    >
      <ArrowUp className='block h-[16px] w-[16px] text-white dark:text-black' />
    </ComposerActionButton>
  )
})
