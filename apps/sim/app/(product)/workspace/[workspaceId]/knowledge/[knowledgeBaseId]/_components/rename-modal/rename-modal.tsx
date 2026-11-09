'use client'

import { useState } from 'react'
import { TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'

interface RenameModalProps {
  title: string
  label: string
  initialName: string
  maxLength: number
  onClose: () => void
  /** Saves the trimmed name; a rejection keeps the dialog open with its message. */
  onSave: (name: string) => Promise<void>
}

/** Renames a knowledge base or a document. Only the display name changes, never its storage. */
export function RenameModal({
  title,
  label,
  initialName,
  maxLength,
  onClose,
  onSave,
}: RenameModalProps) {
  const [name, setName] = useState(initialName)
  const trimmed = name.trim()
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={title}
      confirmLabel='Rename'
      confirmDisabled={!trimmed || trimmed === initialName}
      onConfirm={() => onSave(trimmed)}
    >
      <TextField
        label={label}
        placeholder={`Enter ${label.toLowerCase()}`}
        value={name}
        onChange={setName}
        maxLength={maxLength}
        autoComplete='off'
        required
      />
    </Modal>
  )
}
