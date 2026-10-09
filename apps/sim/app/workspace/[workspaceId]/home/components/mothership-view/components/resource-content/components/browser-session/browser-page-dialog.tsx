'use client'

import type { BrowserPageDialog } from '@sim/browser-protocol'
import { ChipConfirmModal } from '@sim/emcn'

interface BrowserPageDialogModalProps {
  dialog: BrowserPageDialog | undefined
  open: boolean
  onAnswer: (requestId: string, accept: boolean) => void
}

/** Holds browser-chrome navigation until the user decides whether to leave their draft. */
export function BrowserPageDialogModal({ dialog, open, onAnswer }: BrowserPageDialogModalProps) {
  if (!dialog) return null
  const answer = (accept: boolean) => onAnswer(dialog.requestId, accept)
  return (
    <ChipConfirmModal
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && answer(false)}
      title='Leave site?'
      text='Changes you made may not be saved.'
      defaultAction='dismiss'
      dismissLabel='Stay'
      confirm={{ label: 'Leave', onClick: () => answer(true) }}
    />
  )
}
