'use client'

import { Modal } from '@/platform/design-system/components'
import { useSettingsLeaveGuard } from '@/platform/lib/data/shell-guard'

/** One discard dialog for every Settings editor that registers an unsaved draft. */
export function SettingsLeaveGuard() {
  const { pending, confirm, cancel } = useSettingsLeaveGuard()
  return (
    <Modal
      open={pending}
      onOpenChange={(open) => {
        if (!open) cancel()
      }}
      variant='confirm'
      title='Unsaved changes'
      confirmLabel='Discard changes'
      destructive
      onConfirm={confirm}
    >
      <p data-type='T048'>You have unsaved changes. Are you sure you want to discard them?</p>
    </Modal>
  )
}
