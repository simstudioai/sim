'use client'

import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { useSettingsLeaveGuard } from '@/platform/lib/data/settings-guard'

/** One discard dialog for every Settings editor that registers an unsaved draft. */
export function SettingsLeaveGuard() {
  const { pending, confirm, cancel } = useSettingsLeaveGuard()
  return (
    <ConfirmDialog
      target={pending}
      onClose={cancel}
      title='Unsaved changes'
      description='You have unsaved changes. Are you sure you want to discard them?'
      confirmLabel='Discard'
      pendingLabel='Discarding…'
      onConfirm={confirm}
    />
  )
}
