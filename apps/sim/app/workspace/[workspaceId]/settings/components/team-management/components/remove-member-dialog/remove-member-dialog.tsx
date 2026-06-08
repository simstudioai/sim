import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalFooter,
  ChipModalHeader,
} from '@/components/emcn'

interface RemoveMemberDialogProps {
  open: boolean
  memberName: string
  isSelfRemoval?: boolean
  isExternalRemoval?: boolean
  isSubmitting?: boolean
  error?: Error | null
  onOpenChange: (open: boolean) => void
  onConfirmRemove: () => Promise<void>
  onCancel: () => void
}

export function RemoveMemberDialog({
  open,
  memberName,
  error,
  onOpenChange,
  onConfirmRemove,
  onCancel,
  isSelfRemoval = false,
  isExternalRemoval = false,
  isSubmitting = false,
}: RemoveMemberDialogProps) {
  const title = isSelfRemoval
    ? 'Leave Organization'
    : isExternalRemoval
      ? 'Remove External Member'
      : 'Remove Team Member'

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle={title}>
      <ChipModalHeader onClose={() => onOpenChange(false)}>{title}</ChipModalHeader>
      <ChipModalBody>
        <p className='px-2 text-[var(--text-secondary)] text-sm'>
          {isSelfRemoval ? (
            'Are you sure you want to leave this organization? You will lose access to all team resources.'
          ) : isExternalRemoval ? (
            <>
              Are you sure you want to remove{' '}
              <span className='font-medium text-[var(--text-primary)]'>{memberName}</span> from all
              organization workspaces? Their workspace access and workspace credential access will
              be revoked.
            </>
          ) : (
            <>
              Are you sure you want to remove{' '}
              <span className='font-medium text-[var(--text-primary)]'>{memberName}</span> from the
              team?
            </>
          )}{' '}
          This action cannot be undone.
        </p>

        <ChipModalError>
          {error instanceof Error && error.message ? error.message : error ? String(error) : null}
        </ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onCancel}
        primaryAction={{
          label: isSelfRemoval ? 'Leave Organization' : 'Remove',
          onClick: () => onConfirmRemove(),
          disabled: isSubmitting,
          variant: 'destructive',
        }}
      />
    </ChipModal>
  )
}
