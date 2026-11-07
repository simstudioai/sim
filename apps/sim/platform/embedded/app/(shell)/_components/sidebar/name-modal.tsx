'use client'

import { TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { readFormText } from '@/platform/shared/row-links'

interface NameModalProps {
  title: string
  confirmLabel: string
  fieldLabel: string
  emptyMessage: string
  maxLength: number
  /** The current name, when renaming. An unchanged one saves nothing. */
  initial?: string
  onSubmit: (name: string) => Promise<void>
  onClose: () => void
}

export function NameModal({
  title,
  confirmLabel,
  fieldLabel,
  emptyMessage,
  maxLength,
  initial,
  onSubmit,
  onClose,
}: NameModalProps) {
  return (
    <Modal
      open
      onOpenChange={onClose}
      title={title}
      confirmLabel={confirmLabel}
      onConfirm={async (values) => {
        const name = readFormText(values, 'name')
        if (!name) throw new Error(emptyMessage)
        if (name !== initial) await onSubmit(name)
      }}
    >
      <TextField
        label={fieldLabel}
        placeholder={fieldLabel}
        name='name'
        required
        maxLength={maxLength}
        defaultValue={initial}
      />
    </Modal>
  )
}
