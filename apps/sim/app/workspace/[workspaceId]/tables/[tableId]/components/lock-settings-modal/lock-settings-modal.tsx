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
  Switch,
  Tooltip,
} from '@sim/emcn'
import { CircleInfo, Lock } from '@sim/emcn/icons'
import type { TableLocks } from '@/lib/table/types'
import { LOCK_FIELDS } from '@/app/workspace/[workspaceId]/tables/[tableId]/lock-copy'
import { useUpdateTableLocks } from '@/hooks/queries/tables'
import {
  getTableSecurityLocks,
  getTableSecuritySettings,
  tableSecuritySettingsEqual,
  useTableSecurityStore,
} from '@/stores/table/security/store'

interface LockSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  workspaceId: string
  tableId: string
  locks: TableLocks
}

/**
 * Admin-only panel that sets a table's four mutation locks. Changes are staged
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
  const updateLocks = useUpdateTableLocks(workspaceId)
  const preference = useTableSecurityStore((state) => state.preferences[tableId])
  const setPreference = useTableSecurityStore((state) => state.setPreference)
  const settings = getTableSecuritySettings(locks, preference)

  const [draft, setDraft] = useState(settings)
  const [prevOpen, setPrevOpen] = useState(isOpen)
  if (prevOpen !== isOpen) {
    setPrevOpen(isOpen)
    if (isOpen) setDraft(settings)
  }

  const dirty = !tableSecuritySettingsEqual(draft, settings)

  const handleSave = async () => {
    if (!dirty) {
      onClose()
      return
    }
    try {
      await updateLocks.mutateAsync({ tableId, locks: getTableSecurityLocks(draft) })
    } catch {
      return
    }
    setPreference(tableId, draft)
    onClose()
  }

  return (
    <ChipModal open={isOpen} onOpenChange={(open) => !open && onClose()} srTitle='Table Security'>
      <ChipModalHeader icon={Lock} onClose={onClose}>
        Table Security
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='custom'
          title='Enable Table Security'
          className='flex-row items-center justify-between'
        >
          <Switch
            aria-label='Enable Table Security'
            checked={draft.enabled}
            disabled={updateLocks.isPending}
            onCheckedChange={(enabled) => setDraft((prev) => ({ ...prev, enabled }))}
          />
        </ChipModalField>
        {draft.enabled &&
          LOCK_FIELDS.map((field) => (
            <ChipModalField
              key={field.key}
              type='custom'
              className='flex-row items-center justify-between'
              title={
                <span className='inline-flex items-center gap-1.5'>
                  {field.label}
                  <Tooltip.Root>
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
                value={draft.allowedActions[field.kind] ? 'allow' : 'deny'}
                disabled={updateLocks.isPending}
                onValueChange={(value) =>
                  setDraft((prev) => ({
                    ...prev,
                    allowedActions: { ...prev.allowedActions, [field.kind]: value === 'allow' },
                  }))
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
