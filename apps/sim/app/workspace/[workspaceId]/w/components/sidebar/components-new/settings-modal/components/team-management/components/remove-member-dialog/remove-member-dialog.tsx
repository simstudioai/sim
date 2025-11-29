import {
  Button,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
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
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{isSelfRemoval ? 'Leave Organization' : 'Remove Team Member'}</ModalTitle>
          <ModalDescription>
            {isSelfRemoval
              ? 'Are you sure you want to leave this organization? You will lose access to all team resources.'
              : `Are you sure you want to remove ${memberName} from the team?`}{' '}
            <span className='text-[var(--text-error)] dark:text-[var(--text-error)]'>
              This action cannot be undone.
            </span>
          </ModalDescription>
        </ModalHeader>

        {!isSelfRemoval && (
          <div className='py-4'>
            <div className='flex items-center space-x-2'>
              <input
                type='checkbox'
                id='reduce-seats'
                className='rounded-[4px]'
                checked={shouldReduceSeats}
                onChange={(e) => onShouldReduceSeatsChange(e.target.checked)}
              />
              <label htmlFor='reduce-seats' className='text-xs'>
                Also reduce seat count in my subscription
              </label>
            </div>
            <p className='mt-1 text-muted-foreground text-xs'>
              If selected, your team seat count will be reduced by 1, lowering your monthly billing.
            </p>
          </div>
        )}

        {error && (
          <div className='pb-2'>
            <p className='text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
              {error instanceof Error && error.message ? error.message : String(error)}
            </p>
          </div>
        )}

        <ModalFooter>
          <Button variant='outline' onClick={onCancel} className='h-[32px] px-[12px]'>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirmRemove(shouldReduceSeats)}
            className='h-[32px] bg-[var(--text-error)] px-[12px] text-[var(--white)] hover:bg-[var(--text-error)] hover:text-[var(--white)] dark:bg-[var(--text-error)] dark:text-[var(--white)] hover:dark:bg-[var(--text-error)] dark:hover:text-[var(--white)]'
          >
            {isSelfRemoval ? 'Leave Organization' : 'Remove'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
