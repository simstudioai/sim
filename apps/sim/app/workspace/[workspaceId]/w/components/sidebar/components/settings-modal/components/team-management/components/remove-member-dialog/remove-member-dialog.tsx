import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface RemoveMemberDialogProps {
  open: boolean
  memberName: string
  shouldReduceSeats: boolean
  isSelfRemoval?: boolean
  onOpenChange: (open: boolean) => void
  onShouldReduceSeatsChange: (shouldReduce: boolean) => void
  onConfirmRemove: (shouldReduceSeats: boolean) => Promise<void>
  onCancel: () => void
}

export function RemoveMemberDialog({
  open,
  memberName,
  shouldReduceSeats,
  onOpenChange,
  onShouldReduceSeatsChange,
  onConfirmRemove,
  onCancel,
  isSelfRemoval = false,
}: RemoveMemberDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isSelfRemoval ? 'Leave Organization' : 'Remove Team Member'}</DialogTitle>
          <DialogDescription>
            {isSelfRemoval
              ? 'Are you sure you want to leave this organization? You will lose access to all team resources.'
              : `Are you sure you want to remove ${memberName} from the team?`}
          </DialogDescription>
        </DialogHeader>

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

        <DialogFooter>
          <Button variant='outline' onClick={onCancel} className='h-9 rounded-[8px]'>
            Cancel
          </Button>
          <Button
            variant='destructive'
            onClick={() => onConfirmRemove(shouldReduceSeats)}
            className='h-9 rounded-[8px]'
          >
            {isSelfRemoval ? 'Leave Organization' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
