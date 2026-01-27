import {
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'

interface RemoveMemberDialogProps {
  open: boolean
  memberName: string
  shouldReduceSeats: boolean
  isSelfRemoval?: boolean
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
  error,
  onOpenChange,
  onShouldReduceSeatsChange,
  onConfirmRemove,
  onCancel,
  isSelfRemoval = false,
}: RemoveMemberDialogProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='sm'>
        <ModalHeader>{isSelfRemoval ? 'Leave Organization' : 'Remove Team Member'}</ModalHeader>
        <ModalBody>
          <p className='text-[12px] text-[var(--text-secondary)]'>
            {isSelfRemoval ? (
              'Are you sure you want to leave this organization? You will lose access to all team resources.'
            ) : (
              <>
                Are you sure you want to remove{' '}
                <span className='font-medium text-[var(--text-primary)]'>{memberName}</span> from
                the team?
              </>
            )}{' '}
            <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
          </p>

          {!isSelfRemoval && (
            <div className='mt-[16px]'>
              <div className='flex items-center gap-[8px]'>
                <Checkbox
                  id='reduce-seats'
                  checked={shouldReduceSeats}
                  onCheckedChange={(checked) => onShouldReduceSeatsChange(checked === true)}
                />
                <label htmlFor='reduce-seats' className='text-[12px] text-[var(--text-primary)]'>
                  Also reduce seat count in my subscription
                </label>
              </div>
              <p className='mt-[4px] text-[12px] text-[var(--text-muted)]'>
                If selected, your team seat count will be reduced by 1, lowering your monthly
                billing.
              </p>
            </div>
          )}

          {error && (
            <div className='mt-[8px]'>
              <p className='text-[12px] text-[var(--text-error)] leading-tight'>
                {error instanceof Error && error.message ? error.message : String(error)}
              </p>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={onCancel}>
            Cancel
          </Button>
          <Button variant='destructive' onClick={() => onConfirmRemove(shouldReduceSeats)}>
            {isSelfRemoval ? 'Leave Organization' : 'Remove'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
