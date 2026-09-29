'use client'

import { useId } from 'react'
import type { BrowserPageDialog } from '@sim/browser-protocol'
import {
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalDescription,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'

interface BrowserPageDialogModalProps {
  dialog: BrowserPageDialog | undefined
  open: boolean
  onAnswer: (requestId: string, accept: boolean) => void
}

/** Names the page behind a dialog, so page text can never pass as Sim's own. */
function dialogSource(origin: string): string {
  try {
    const { host } = new URL(origin)
    if (host) return `${host} says`
  } catch {}
  return 'This page says'
}

/**
 * The page's alert, confirm, or leave-site question, asked the way a browser
 * asks it. Every dismiss path answers the page, which is blocked until then.
 */
export function BrowserPageDialogModal({ dialog, open, onAnswer }: BrowserPageDialogModalProps) {
  const messageId = useId()
  if (!dialog) return null
  const answer = (accept: boolean) => onAnswer(dialog.requestId, accept)
  const source = dialogSource(dialog.origin)

  if (dialog.kind === 'alert') {
    return (
      <ChipModal
        open={open}
        onOpenChange={(nextOpen) => !nextOpen && answer(true)}
        srTitle={source}
        aria-describedby={dialog.message ? messageId : undefined}
      >
        <ChipModalHeader onClose={() => answer(true)}>{source}</ChipModalHeader>
        <ChipModalBody>
          {dialog.message ? (
            <ChipModalDescription id={messageId}>{dialog.message}</ChipModalDescription>
          ) : null}
        </ChipModalBody>
        <ChipModalFooter hideCancel primaryAction={{ label: 'OK', onClick: () => answer(true) }} />
      </ChipModal>
    )
  }

  if (dialog.kind === 'beforeunload') {
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

  return (
    <ChipConfirmModal
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && answer(false)}
      title={source}
      text={dialog.message}
      defaultAction='dismiss'
      confirm={{ label: 'OK', onClick: () => answer(true), variant: 'primary' }}
    />
  )
}
