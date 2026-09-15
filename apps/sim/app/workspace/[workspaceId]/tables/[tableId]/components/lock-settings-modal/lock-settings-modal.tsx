'use client'

import { useState } from 'react'
import {
  ChipButtonGroup,
  ChipButtonGroupItem,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Tooltip,
} from '@sim/emcn'
import { CircleInfo, Lock } from '@sim/emcn/icons'
import type { TableLocks } from '@/lib/table/types'
import { LOCK_FIELDS } from '@/app/workspace/[workspaceId]/tables/[tableId]/lock-copy'
import { useUpdateTableLocks } from '@/hooks/queries/tables'

/**
 * The rows the admin actually moved, relative to the locks the server holds
 * right now. Everything absent from this patch is left alone by the save.
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
 * Admin-only panel that sets a table's four mutation locks, one Allow/Deny row
 * each. The rows mirror the server flags exactly — `Deny` is a set lock — so a
 * table nobody has configured opens on four `Allow`s and every viewer sees the
 * same state.
 *
 * Only the rows this admin moved are staged; every other row keeps rendering
 * the authoritative value, so a lock another admin changes while this modal is
 * open shows up here instead of going stale behind it. Save sends just that
 * patch (the route takes a partial), so it can't carry a stale flag over
 * someone else's newer change — a row both admins moved is the only real
 * conflict, and there this admin's explicit choice wins. The server re-checks
 * admin and rejects a `write`-only caller with a 403 surfaced as a toast.
 * Gated at the call site on `canAdmin`.
 */
export function LockSettingsModal({
  isOpen,
  onClose,
  workspaceId,
  tableId,
  locks,
}: LockSettingsModalProps) {
  const updateLocks = useUpdateTableLocks(workspaceId)

  // Stage only the rows this admin moved; clear them each time the modal opens.
  const [overrides, setOverrides] = useState<Partial<TableLocks>>({})
  const [prevOpen, setPrevOpen] = useState(isOpen)
  if (prevOpen !== isOpen) {
    setPrevOpen(isOpen)
    if (isOpen) setOverrides({})
  }

  const changed = changedLocks(overrides, locks)
  const dirty = Object.keys(changed).length > 0

  const handleSave = async () => {
    if (!dirty) {
      onClose()
      return
    }
    try {
      await updateLocks.mutateAsync({ tableId, locks: changed })
    } catch {
      return
    }
    onClose()
  }

  return (
    <ChipModal open={isOpen} onOpenChange={(open) => !open && onClose()} srTitle='Table Security'>
      <ChipModalHeader icon={Lock} onClose={onClose}>
        Table Security
      </ChipModalHeader>
      <ChipModalBody>
        {LOCK_FIELDS.map((field) => (
          <ChipModalField
            key={field.key}
            type='custom'
            className='flex-row items-center justify-between'
            title={
              <span className='inline-flex items-center gap-1.5'>
                {field.label}
                <Tooltip.Root>
                  {/* Not `asChild`: the hint is each row's only explanation, so
                      the trigger must be a focusable button for keyboard users. */}
                  <Tooltip.Trigger
                    type='button'
                    aria-label={`About ${field.label.toLowerCase()}`}
                    className='inline-flex cursor-help'
                  >
                    <CircleInfo className='size-[14px] text-[var(--text-icon)]' />
                  </Tooltip.Trigger>
                  <Tooltip.Content>
                    <p>{field.hint}</p>
                  </Tooltip.Content>
                </Tooltip.Root>
              </span>
            }
          >
            <ChipButtonGroup
              aria-label={field.label}
              className='shrink-0'
              value={(overrides[field.key] ?? locks[field.key]) ? 'deny' : 'allow'}
              disabled={updateLocks.isPending}
              onValueChange={(value) =>
                setOverrides((prev) => ({ ...prev, [field.key]: value === 'deny' }))
              }
            >
              <ChipButtonGroupItem value='deny'>Deny</ChipButtonGroupItem>
              <ChipButtonGroupItem value='allow'>Allow</ChipButtonGroupItem>
            </ChipButtonGroup>
          </ChipModalField>
        ))}
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        cancelDisabled={updateLocks.isPending}
        primaryAction={{
          label: updateLocks.isPending ? 'Saving...' : 'Save',
          onClick: handleSave,
          disabled: !dirty || updateLocks.isPending,
        }}
      />
    </ChipModal>
  )
}
