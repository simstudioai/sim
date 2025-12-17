import { Button } from '@/components/emcn'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { SaveStatus } from '@/hooks/use-auto-save'

interface SaveStatusIndicatorProps {
  /** Current save status */
  status: SaveStatus
  /** Error message to display */
  errorMessage: string | null
  /** Text to show while saving (e.g., "Saving schedule...") */
  savingText?: string
  /** Text to show while loading (e.g., "Loading schedule...") */
  loadingText?: string
  /** Whether to show loading indicator */
  isLoading?: boolean
  /** Callback when retry button is clicked */
  onRetry?: () => void
  /** Whether retry is disabled (e.g., during saving) */
  retryDisabled?: boolean
  /** Number of retry attempts made */
  retryCount?: number
  /** Maximum retry attempts allowed */
  maxRetries?: number
}

/**
 * Shared component for displaying save status indicators.
 * Shows saving spinner, error alerts with retry, and loading indicators.
 */
export function SaveStatusIndicator({
  status,
  errorMessage,
  savingText = 'Saving...',
  loadingText = 'Loading...',
  isLoading = false,
  onRetry,
  retryDisabled = false,
  retryCount = 0,
  maxRetries = 3,
}: SaveStatusIndicatorProps) {
  const maxRetriesReached = retryCount >= maxRetries

  return (
    <>
      {/* Saving indicator */}
      {status === 'saving' && (
        <div className='flex items-center gap-2 text-muted-foreground text-sm'>
          <div className='h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
          {savingText}
        </div>
      )}

      {/* Error message with retry */}
      {errorMessage && (
        <Alert variant='destructive'>
          <AlertDescription className='flex items-center justify-between'>
            <span>
              {errorMessage}
              {maxRetriesReached && (
                <span className='ml-1 text-xs opacity-75'>(Max retries reached)</span>
              )}
            </span>
            {onRetry && (
              <Button
                variant='ghost'
                onClick={onRetry}
                disabled={retryDisabled || status === 'saving'}
                className='ml-2 h-6 px-2 text-xs'
              >
                Retry
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Loading indicator */}
      {isLoading && status !== 'saving' && (
        <div className='flex items-center gap-2 text-muted-foreground text-sm'>
          <div className='h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
          {loadingText}
        </div>
      )}
    </>
  )
}
