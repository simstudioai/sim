import { Button } from '@/components/emcn'

interface RestoreCheckpointModalProps {
  isReverting: boolean
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Inline confirmation modal for restoring a checkpoint
 * Warns user that the action cannot be undone
 */
export function RestoreCheckpointModal({
  isReverting,
  onCancel,
  onConfirm,
}: RestoreCheckpointModalProps) {
  return (
    <div className='mt-[8px] rounded-[4px] border border-[var(--border)] bg-[var(--surface-4)] p-[10px]'>
      <p className='mb-[8px] text-[12px] text-[var(--text-primary)]'>
        Revert to checkpoint? This will restore your workflow to the state saved at this checkpoint.{' '}
        <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
      </p>
      <div className='flex gap-[8px]'>
        <Button
          onClick={onCancel}
          variant='active'
          size='sm'
          className='flex-1'
          disabled={isReverting}
        >
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          variant='destructive'
          size='sm'
          className='flex-1'
          disabled={isReverting}
        >
          {isReverting ? 'Reverting...' : 'Revert'}
        </Button>
      </div>
    </div>
  )
}
