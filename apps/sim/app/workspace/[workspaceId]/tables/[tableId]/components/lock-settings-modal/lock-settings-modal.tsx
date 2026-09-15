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

function locksEqual(a: TableLocks, b: TableLocks): boolean {
  return LOCK_FIELDS.every((field) => a[field.key] === b[field.key])
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
 * same state. Changes are staged locally and applied on Save (one request); the
 * server re-checks admin and rejects a `write`-only caller with a 403 surfaced
 * as a toast. Gated at the call site on `canAdmin`.
 */
export function LockSettingsModal({
  isOpen,
  onClose,
  workspaceId,
  tableId,
  locks,
}: LockSettingsModalProps) {
  const updateLocks = useUpdateTableLocks(workspaceId)

  // Stage edits locally; reset to the server value each time the modal opens.
  const [draft, setDraft] = useState<TableLocks>(locks)
  const [prevOpen, setPrevOpen] = useState(isOpen)
  if (prevOpen !== isOpen) {
    setPrevOpen(isOpen)
    if (isOpen) setDraft(locks)
  }

  const dirty = !locksEqual(draft, locks)

  const handleSave = async () => {
    if (!dirty) {
      onClose()
      return
    }
    try {
      await updateLocks.mutateAsync({ tableId, locks: draft })
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
              value={draft[field.key] ? 'deny' : 'allow'}
              disabled={updateLocks.isPending}
              onValueChange={(value) =>
                setDraft((prev) => ({ ...prev, [field.key]: value === 'deny' }))
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
