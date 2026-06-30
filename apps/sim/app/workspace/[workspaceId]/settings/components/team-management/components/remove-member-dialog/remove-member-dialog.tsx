import { ChipConfirmModal } from '@sim/emcn'

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

  const errorMessage =
    error instanceof Error && error.message ? error.message : error ? String(error) : null

  return (
    <ChipConfirmModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
        onOpenChange(next)
      }}
      srTitle={title}
      title={title}
      text={
        isSelfRemoval
          ? 'Are you sure you want to leave this organization? You will lose access to all team resources. This action cannot be undone.'
          : isExternalRemoval
            ? [
                'Are you sure you want to remove ',
                { text: memberName, bold: true },
                ' from all organization workspaces? Their workspace access and workspace credential access will be revoked. This action cannot be undone.',
              ]
            : [
                'Are you sure you want to remove ',
                { text: memberName, bold: true },
                ' from the team? This action cannot be undone.',
              ]
      }
      confirm={{
        label: isSelfRemoval ? 'Leave Organization' : 'Remove',
        onClick: () => onConfirmRemove(),
        pending: isSubmitting,
      }}
    >
      {errorMessage ? (
        <p role='alert' className='mt-1 px-2 text-[var(--text-error)] text-caption'>
          {errorMessage}
        </p>
      ) : null}
    </ChipConfirmModal>
  )
}
