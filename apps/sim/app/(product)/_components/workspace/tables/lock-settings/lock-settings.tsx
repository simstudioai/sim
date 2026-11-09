'use client'

import { useState } from 'react'
import { Modal } from '@sim/emcn/modal'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { SettingsRow } from '@sim/emcn/settings-section'
import { LOCK_FIELDS, type TableLocks, useUpdateTableLocks } from '@/platform/lib/data/tables'

const LOCK_CHOICES = [
  { value: 'deny', label: 'Deny' },
  { value: 'allow', label: 'Allow' },
] as const

/**
 * The rows the admin actually moved, relative to the locks the server holds right now. Everything
 * absent from this patch is left alone by the save.
 */
function changedLocks(overrides: Partial<TableLocks>, locks: TableLocks): Partial<TableLocks> {
  const changed: Partial<TableLocks> = {}
  for (const field of LOCK_FIELDS) {
    const next = overrides[field.key]
    if (next !== undefined && next !== locks[field.key]) changed[field.key] = next
  }
  return changed
}

interface LockSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  workspaceId: string
  tableId: string
  locks: TableLocks
}

/**
 * Sets a table's four mutation locks, one Allow/Deny row each, for an admin (the page gates it on
 * `canAdmin`). Deny is a set lock, so a table nobody has configured opens on four Allows and every
 * viewer sees the same state.
 *
 * Only the rows this admin moved are staged; every other row keeps showing the server's value, so a
 * lock another admin changes while this dialog is open appears here instead of going stale. Save
 * sends just that patch, so it never carries a stale flag over someone else's newer change; a row
 * both admins moved is the only real conflict, and there this admin's explicit choice wins. The
 * server re-checks admin and refuses a write-only caller, which the mutation reports as a toast.
 */
export function LockSettingsModal({
  isOpen,
  onClose,
  workspaceId,
  tableId,
  locks,
}: LockSettingsModalProps) {
  const updateLocks = useUpdateTableLocks(workspaceId)

  // Stage only the rows this admin moved, starting over each time the dialog opens.
  const [overrides, setOverrides] = useState<Partial<TableLocks>>({})
  const [prevOpen, setPrevOpen] = useState(isOpen)
  if (prevOpen !== isOpen) {
    setPrevOpen(isOpen)
    if (isOpen) setOverrides({})
  }

  const changed = changedLocks(overrides, locks)
  const dirty = Object.keys(changed).length > 0
  const choices = LOCK_CHOICES.map((choice) => ({ ...choice, disabled: updateLocks.isPending }))

  async function handleSave() {
    if (!dirty) return
    try {
      await updateLocks.mutateAsync({ tableId, locks: changed })
    } catch {
      // The mutation already toasted the failure; stay open with the draft.
      return false
    }
  }

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title='Table Security'
      confirmLabel={updateLocks.isPending ? 'Saving…' : 'Save'}
      confirmDisabled={!dirty}
      pending={updateLocks.isPending}
      onConfirm={handleSave}
    >
      {LOCK_FIELDS.map((field) => (
        <SettingsRow key={field.key} label={field.label} description={field.hint}>
          <SegmentedControl
            label={field.label}
            description={field.hint}
            options={choices}
            value={(overrides[field.key] ?? locks[field.key]) ? 'deny' : 'allow'}
            onSelect={(value) =>
              setOverrides((previous) => ({ ...previous, [field.key]: value === 'deny' }))
            }
          />
        </SettingsRow>
      ))}
    </Modal>
  )
}
