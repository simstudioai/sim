import {
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
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
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='sm'>
        <ModalHeader>{title}</ModalHeader>
        <ModalBody>
          <ModalDescription className='text-[var(--text-secondary)]'>
            {isSelfRemoval ? (
              'Are you sure you want to leave this organization? You will lose access to all team resources.'
            ) : isExternalRemoval ? (
              <>
                Are you sure you want to remove{' '}
                <span className='font-medium text-[var(--text-primary)]'>{memberName}</span> from
                all organization workspaces? Their workspace access and workspace credential access
                will be revoked.
              </>
            ) : (
              <>
                Are you sure you want to remove{' '}
                <span className='font-medium text-[var(--text-primary)]'>{memberName}</span> from
                the team?
              </>
            )}{' '}
            This action cannot be undone.
          </ModalDescription>

          {!isSelfRemoval && !isExternalRemoval && canReduceSeats && (
            <div className='mt-4'>
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
                If selected, your team seat count will be reduced by 1, lowering your monthly
                billing.
              </p>
            </div>
          )}

          {error && (
            <div className='mt-2'>
              <p className='text-[var(--text-error)] text-small leading-tight'>
                {error instanceof Error && error.message ? error.message : String(error)}
              </p>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant='default' disabled={isSubmitting} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant='destructive'
            disabled={isSubmitting}
            onClick={() =>
              onConfirmRemove(isExternalRemoval || !canReduceSeats ? false : shouldReduceSeats)
            }
          >
            {isSelfRemoval ? 'Leave Organization' : 'Remove'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
