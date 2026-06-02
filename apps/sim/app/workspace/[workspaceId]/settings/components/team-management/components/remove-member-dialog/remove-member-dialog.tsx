import {
  Checkbox,
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalFooter,
  ChipModalHeader,
} from '@/components/emcn'

interface RemoveMemberDialogProps {
  open: boolean
  memberName: string
  shouldReduceSeats: boolean
  canReduceSeats?: boolean
  isSelfRemoval?: boolean
  isExternalRemoval?: boolean
  isSubmitting?: boolean
  error?: Error | null
  onOpenChange: (open: boolean) => void
  onShouldReduceSeatsChange: (shouldReduce: boolean) => void
  onConfirmRemove: (shouldReduceSeats: boolean) => Promise<void>
  onCancel: () => void
}

export function RemoveMemberDialog({
  open,
  memberName,
  shouldReduceSeats,
  canReduceSeats = true,
  error,
  onOpenChange,
  onShouldReduceSeatsChange,
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
      <ChipModalHeader onClose={() => onOpenChange(false)} showDivider={false}>
        {title}
      </ChipModalHeader>
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

        {!isSelfRemoval && !isExternalRemoval && canReduceSeats && (
          <div className='px-2'>
            <div className='flex items-center gap-2'>
              <Checkbox
                id='reduce-seats'
                checked={shouldReduceSeats}
                onCheckedChange={(checked) => onShouldReduceSeatsChange(checked === true)}
              />
              <label htmlFor='reduce-seats' className='text-[var(--text-primary)] text-small'>
                Also reduce seat count in my subscription
              </label>
            </div>
            <p className='mt-1 text-[var(--text-muted)] text-small'>
              If selected, your team seat count will be reduced by 1, lowering your monthly billing.
            </p>
          </div>
        )}

        <ChipModalError>
          {error instanceof Error && error.message ? error.message : error ? String(error) : null}
        </ChipModalError>
      </ChipModalBody>
      <ChipModalFooter>
        <Chip variant='filled' flush disabled={isSubmitting} onClick={onCancel}>
          Cancel
        </Chip>
        <Chip
          variant='destructive'
          flush
          disabled={isSubmitting}
          onClick={() =>
            onConfirmRemove(isExternalRemoval || !canReduceSeats ? false : shouldReduceSeats)
          }
        >
          {isSelfRemoval ? 'Leave Organization' : 'Remove'}
        </Chip>
      </ChipModalFooter>
    </ChipModal>
  )
}
