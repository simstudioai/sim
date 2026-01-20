import { Button } from '@/components/emcn'

type CheckpointConfirmationVariant = 'restore' | 'discard'

interface CheckpointConfirmationProps {
  /** Confirmation variant - 'restore' for reverting, 'discard' for edit with checkpoint options */
  variant: CheckpointConfirmationVariant
  /** Whether an action is currently processing */
  isProcessing: boolean
  /** Callback when cancel is clicked */
  onCancel: () => void
  /** Callback when revert is clicked */
  onRevert: () => void
  /** Callback when continue is clicked (only for 'discard' variant) */
  onContinue?: () => void
}

/**
 * Inline confirmation for checkpoint operations
 * Supports two variants:
 * - 'restore': Simple revert confirmation with warning
 * - 'discard': Edit with checkpoint options (revert or continue without revert)
 */
export function CheckpointConfirmation({
  variant,
  isProcessing,
  onCancel,
  onRevert,
  onContinue,
}: CheckpointConfirmationProps) {
  const isRestoreVariant = variant === 'restore'

  return (
    <div className='mt-[8px] rounded-[4px] border border-[var(--border)] bg-[var(--surface-4)] p-[10px]'>
      <p className='mb-[8px] text-[12px] text-[var(--text-primary)]'>
        {isRestoreVariant ? (
          <>
            Revert to checkpoint? This will restore your workflow to the state saved at this
            checkpoint.{' '}
            <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
          </>
        ) : (
          'Continue from a previous message?'
        )}
      </p>
      <div className='flex gap-[8px]'>
        <Button
          onClick={onCancel}
          variant='active'
          size='sm'
          className='flex-1'
          disabled={isProcessing}
        >
          Cancel
        </Button>
        <Button
          onClick={onRevert}
          variant='destructive'
          size='sm'
          className='flex-1'
          disabled={isProcessing}
        >
          {isProcessing ? 'Reverting...' : 'Revert'}
        </Button>
        {!isRestoreVariant && onContinue && (
          <Button
            onClick={onContinue}
            variant='tertiary'
            size='sm'
            className='flex-1'
            disabled={isProcessing}
          >
            Continue
          </Button>
        )}
      </div>
    </div>
  )
}
