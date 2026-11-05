'use client'

import { Modal } from '@/platform/design-system/components'
import { useLeaveInterception } from '@/platform/lib/data/settings-guard'

/** Mounted by an editor: asks before a link or a closing tab discards its draft. */
export function UnsavedChanges() {
  const { pending, confirm, cancel } = useLeaveInterception()
  return (
    <Modal
      open={pending}
      onOpenChange={(open) => {
        if (!open) cancel()
      }}
      variant='confirm'
      destructive
      title='Discard changes?'
      confirmLabel='Discard'
      onConfirm={confirm}
      description='You have unsaved changes on this page.'
    />
  )
}
