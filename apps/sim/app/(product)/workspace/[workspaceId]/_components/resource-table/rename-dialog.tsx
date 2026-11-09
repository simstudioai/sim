'use client'

import { useEffect, useState } from 'react'
import { TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { readFormText } from '@/platform/shared/row-links'
import { MINUTE_MS } from '@/platform/shared/time'

interface RenameDialogProps {
  /** What is being renamed; the dialog is open while it is set. */
  target: { id: string; name: string } | null
  /** Names the thing in the title and field, such as "folder". */
  noun: string
  maxLength?: number
  onClose: () => void
  /** Saves the new name; a rejection keeps the dialog open with its message. */
  onRename: (id: string, name: string) => Promise<unknown>
}

/** Renames the open folder from its breadcrumb, where it has no row to edit in place. */
export function RenameDialog({ target, noun, maxLength, onClose, onRename }: RenameDialogProps) {
  const label = `${noun.charAt(0).toUpperCase()}${noun.slice(1)} name`
  return (
    <Modal
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={`Rename ${noun}`}
      confirmLabel='Save'
      onConfirm={async (values) => {
        if (!target) return
        const name = readFormText(values, 'name')
        if (!name) throw new Error(`Enter a ${noun} name.`)
        if (name !== target.name) await onRename(target.id, name)
      }}
    >
      {target && (
        <TextField
          key={target.id}
          label={label}
          placeholder={label}
          name='name'
          required
          maxLength={maxLength}
          defaultValue={target.name}
        />
      )}
    </Modal>
  )
}

/** One reference instant for a list's ages, moving on by the minute. */
export function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE_MS)
    return () => clearInterval(timer)
  }, [])
  return now
}
