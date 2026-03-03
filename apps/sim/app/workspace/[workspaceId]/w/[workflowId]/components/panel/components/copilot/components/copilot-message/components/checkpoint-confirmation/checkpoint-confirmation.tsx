import { useTranslations } from 'next-intl'
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
  const t = useTranslations('panel.copilot_panel.checkpoint_confirmation')
  const isRestoreVariant = variant === 'restore'

  return (
    <div className='mt-[8px] rounded-[4px] border border-[var(--border)] bg-[var(--surface-4)] p-[10px]'>
      <p className='mb-[8px] text-[12px] text-[var(--text-primary)]'>
        {isRestoreVariant ? (
          <>
            {t('restore_title')}{' '}
            <span className='text-[var(--text-error)]'>{t('restore_warning')}</span>
          </>
        ) : (
          t('continue_title')
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
          {t('cancel_button')}
        </Button>
        <Button
          onClick={onRevert}
          variant='destructive'
          size='sm'
          className='flex-1'
          disabled={isProcessing}
        >
          {isProcessing ? t('reverting_button') : t('revert_button')}
        </Button>
        {!isRestoreVariant && onContinue && (
          <Button
            onClick={onContinue}
            variant='tertiary'
            size='sm'
            className='flex-1'
            disabled={isProcessing}
          >
            {t('continue_button')}
          </Button>
        )}
      </div>
    </div>
  )
}
