'use client'

import { useId, useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalFooter,
  ChipModalHeader,
  Label,
  Switch,
  Tooltip,
} from '@sim/emcn'
import { CircleInfo, Lock } from '@sim/emcn/icons'
import type { TableLocks } from '@/lib/table'
import {
  describeLocks,
  LOCK_FIELDS,
} from '@/app/workspace/[workspaceId]/tables/[tableId]/lock-copy'
import { useUpdateTableLocks } from '@/hooks/queries/tables'

function locksEqual(a: TableLocks, b: TableLocks): boolean {
  return (
    a.schemaLocked === b.schemaLocked &&
    a.insertLocked === b.insertLocked &&
    a.updateLocked === b.updateLocked &&
    a.deleteLocked === b.deleteLocked
  )
}

interface LockSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  workspaceId: string
  tableId: string
  locks: TableLocks
}

/**
 * Admin-only panel to toggle a table's four mutation locks. Changes are staged
 * locally and applied on Save (one request); the server re-checks admin and
 * rejects a `write`-only caller with a 403 surfaced as a toast. Gated at the
 * call site on `canAdmin`.
 */
export function LockSettingsModal({
  isOpen,
  onClose,
  workspaceId,
  tableId,
  locks,
}: LockSettingsModalProps) {
  const idPrefix = useId()
  const updateLocks = useUpdateTableLocks(workspaceId)

  // Stage edits locally; reset to the server value each time the modal opens.
  const [draft, setDraft] = useState<TableLocks>(locks)
  const [prevOpen, setPrevOpen] = useState(isOpen)
  if (prevOpen !== isOpen) {
    setPrevOpen(isOpen)
    if (isOpen) setDraft(locks)
  }

  const dirty = !locksEqual(draft, locks)
  const summary = describeLocks(draft)

  const handleSave = () => {
    if (!dirty) {
      onClose()
      return
    }
    updateLocks.mutate({ tableId, locks: draft }, { onSuccess: () => onClose() })
  }

  return (
    <ChipModal open={isOpen} onOpenChange={(open) => !open && onClose()} srTitle='Table locks'>
      <ChipModalHeader icon={Lock} onClose={onClose}>
        Table locks
      </ChipModalHeader>
      <ChipModalBody>
        <p className='px-2 text-[var(--text-muted)] text-caption'>
          <span className='text-[var(--text-body)]'>{summary.name}</span> — {summary.detail}
        </p>
        {LOCK_FIELDS.map((field) => {
          const fieldId = `${idPrefix}-${field.kind}`
          return (
            <div key={field.key} className='flex items-center justify-between px-2'>
              <div className='flex items-center gap-1.5'>
                <Label htmlFor={fieldId}>Lock {field.noun}</Label>
                <Tooltip.Root>
                  {/* Not `asChild`: the hint is each lock's only explanation, so
                      the trigger must be a focusable button for keyboard users. */}
                  <Tooltip.Trigger type='button' className='inline-flex cursor-help'>
                    <CircleInfo className='size-[14px] text-[var(--text-icon)]' />
                  </Tooltip.Trigger>
                  <Tooltip.Content>
                    <p>{field.hint}</p>
                  </Tooltip.Content>
                </Tooltip.Root>
              </div>
              <Switch
                id={fieldId}
                checked={draft[field.key]}
                disabled={updateLocks.isPending}
                onCheckedChange={(checked) =>
                  setDraft((prev) => ({ ...prev, [field.key]: checked }))
                }
              />
            </div>
          )
        })}
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
