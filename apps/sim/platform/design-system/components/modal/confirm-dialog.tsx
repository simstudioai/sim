'use client'

import { useState } from 'react'
import { Modal } from '@/platform/design-system/components/modal/modal'

interface ConfirmDialogProps<T> {
  /** What is being confirmed; the dialog is open while this is set. */
  target: T | null | undefined | false
  onClose: () => void
  title: string | ((target: T) => string)
  description?: string | ((target: T) => string)
  confirmLabel: string
  pendingLabel: string
  /** Runs the action: the dialog shows it pending, closes on success and shows a rejection's message. */
  onConfirm: (target: T) => unknown
  /** A confirm for an action that loses nothing. */
  safe?: boolean
  confirmDisabled?: boolean
}

/** The one question asked before a destructive or far-reaching action. */
export function ConfirmDialog<T>({
  target,
  onClose,
  title,
  description,
  confirmLabel,
  pendingLabel,
  onConfirm,
  safe,
  confirmDisabled,
}: ConfirmDialogProps<T>) {
  const [running, setRunning] = useState(false)
  const [held, setHeld] = useState<T | null>(null)
  const active = target || target === 0 ? (target as T) : null
  /** Copy stays put through the close animation, after the caller has already cleared its target. */
  if (active !== null && active !== held) setHeld(active)
  const shown = active ?? held
  const resolve = (value: string | ((target: T) => string) | undefined) =>
    typeof value === 'function' ? (shown === null ? '' : value(shown)) : value
  return (
    <Modal
      variant='confirm'
      destructive={!safe}
      open={active !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={resolve(title) ?? ''}
      description={resolve(description)}
      confirmLabel={running ? pendingLabel : confirmLabel}
      confirmDisabled={confirmDisabled}
      onConfirm={async () => {
        if (shown === null) return
        setRunning(true)
        try {
          return await onConfirm(shown)
        } finally {
          setRunning(false)
        }
      }}
    />
  )
}
