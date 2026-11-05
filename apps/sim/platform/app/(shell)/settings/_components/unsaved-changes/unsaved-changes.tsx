'use client'

import { Modal } from '@/platform/design-system/components'
import { useLeaveConfirmation } from '@/platform/lib/data/settings-guard'

/** One discard dialog for every section with an editor. */
export function UnsavedChanges() {
  const { pending, confirm, cancel } = useLeaveConfirmation()
  return (
    <Modal
      open={pending}
      onOpenChange={(open) => {
        if (!open) cancel()
      }}
      variant='confirm'
      destructive
      title='Unsaved changes'
      confirmLabel='Discard changes'
      description='You have unsaved changes. Are you sure you want to discard them?'
      onConfirm={() => confirm()}
    />
  )
}
