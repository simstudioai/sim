import { ChipModal, ChipModalBody, ChipModalFooter, ChipModalHeader } from '@/components/emcn'

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
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Unsaved Changes'>
      <ChipModalHeader onClose={() => onOpenChange(false)}>Unsaved Changes</ChipModalHeader>
      <ChipModalBody>
        <p className='px-2 text-[var(--text-secondary)] text-sm'>
          You have unsaved changes. Are you sure you want to discard them?
        </p>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        primaryAction={{
          label: 'Discard Changes',
          onClick: onDiscard,
          variant: 'destructive',
        }}
      />
    </ChipModal>
  )
}
