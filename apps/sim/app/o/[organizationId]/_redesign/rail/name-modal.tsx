'use client'

import { readFormText } from '@/app/o/[organizationId]/_redesign/rail/row-links'
import { TextField } from '@/platform/design-system/components/field/fields'
import { Modal } from '@/platform/design-system/components/modal/modal'

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
        name='name'
        required
        maxLength={maxLength}
        defaultValue={initial}
      />
    </Modal>
  )
}
