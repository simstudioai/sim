'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'

interface SaveViewModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-filled when renaming an existing view; empty when creating a new one. */
  initialName?: string
  /** `new` starts blank and is configured after; `rename` retitles an existing view. */
  mode: 'new' | 'rename'
  onSubmit: (name: string) => void
  isSubmitting: boolean
}

/**
 * Names a new view or renames an existing one.
 * A view name is free-form (no identifier rules), so the only guard is emptiness.
 */
export function SaveViewModal({
  open,
  onOpenChange,
  initialName = '',
  mode,
  onSubmit,
  isSubmitting,
}: SaveViewModalProps) {
  const [name, setName] = useState(initialName)
  // Seed the field on each open rather than syncing in an effect: the modal stays
  // mounted between opens, so without this a second open shows the stale name.
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) setName(initialName)
  }

  const trimmed = name.trim()
  const title = mode === 'new' ? 'New view' : 'Rename view'

  const handleSubmit = () => {
    if (!trimmed || isSubmitting) return
    onSubmit(trimmed)
  }

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle={title}>
      <ChipModalHeader onClose={() => onOpenChange(false)}>{title}</ChipModalHeader>
      <ChipModalBody>
        {/* Enter fires the footer's primary action automatically — no key wiring. */}
        <ChipModalField
          type='input'
          title='Name'
          value={name}
          onChange={setName}
          placeholder='e.g. Active customers'
          required
        />
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        cancelDisabled={isSubmitting}
        primaryAction={{
          label:
            mode === 'new'
              ? isSubmitting
                ? 'Creating...'
                : 'Create'
              : isSubmitting
                ? 'Saving...'
                : 'Save',
          onClick: handleSubmit,
          disabled: !trimmed || isSubmitting,
        }}
      />
    </ChipModal>
  )
}
