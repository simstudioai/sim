import { Button } from '@/components/emcn'

interface CheckpointDiscardModalProps {
  isProcessingDiscard: boolean
  onCancel: () => void
  onRevert: () => void
  onContinue: () => void
}

/**
 * Inline confirmation modal for discarding checkpoints during message editing
 * Shows options to cancel, revert to checkpoint, or continue without reverting
 */
export function CheckpointDiscardModal({
  isProcessingDiscard,
  onCancel,
  onRevert,
  onContinue,
}: CheckpointDiscardModalProps) {
  return (
    <div className='mt-[8px] rounded-[4px] border border-[var(--border)] bg-[var(--surface-4)] p-[10px]'>
      <p className='mb-[8px] text-[12px] text-[var(--text-primary)]'>
        Continue from a previous message?
      </p>
      <div className='flex gap-[8px]'>
        <Button
          onClick={onCancel}
          variant='active'
          size='sm'
          className='flex-1'
          disabled={isProcessingDiscard}
        >
          Cancel
        </Button>
        <Button
          onClick={onRevert}
          variant='destructive'
          size='sm'
          className='flex-1'
          disabled={isProcessingDiscard}
        >
          {isProcessingDiscard ? 'Reverting...' : 'Revert'}
        </Button>
        <Button
          onClick={onContinue}
          variant='tertiary'
          size='sm'
          className='flex-1'
          disabled={isProcessingDiscard}
        >
          Continue
        </Button>
      </div>
    </div>
  )
}
