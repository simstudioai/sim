import { ChipConfirmModal } from '@sim/emcn'

interface UnsavedChangesModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Confirmed discard: abandon edits and continue (navigate away / close). */
  onDiscard: () => void
}

/**
 * Confirmation shown when leaving a surface with unsaved edits. Shared by the
 * credential detail surfaces and the secrets list so the copy and affordances
 * stay identical.
 */
export function UnsavedChangesModal({ open, onOpenChange, onDiscard }: UnsavedChangesModalProps) {
  return (
    <ChipConfirmModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle='Unsaved Changes'
      title='Unsaved Changes'
      text='You have unsaved changes. Are you sure you want to discard them?'
      dismissLabel='Keep editing'
      confirm={{ label: 'Discard Changes', onClick: onDiscard }}
    />
  )
}
