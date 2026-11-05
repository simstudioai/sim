import { Button, cn } from '@sim/emcn'
import { Loader, RefreshCw, X } from '@sim/emcn/icons'

interface KnowledgeUploadRowProps {
  name: string
  size: string
  error: boolean
  processing: boolean
  disabled: boolean
  onRemove: () => void
  onRetry?: () => void
}

/** Selected-file presentation shared by knowledge creation and document uploads. */
export function KnowledgeUploadRow({
  name,
  size,
  error,
  processing,
  disabled,
  onRemove,
  onRetry,
}: KnowledgeUploadRowProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-sm border p-2',
        error && 'border-[var(--text-error)]'
      )}
    >
      <span
        className={cn('min-w-0 flex-1 truncate text-caption', error && 'text-[var(--text-error)]')}
        title={name}
      >
        {name}
      </span>
      <span className='shrink-0 text-[var(--text-muted)] text-xs'>{size}</span>
      <div className='flex shrink-0 items-center gap-1'>
        {processing ? (
          <Loader className='size-4 text-[var(--text-muted)]' animate />
        ) : (
          <>
            {onRetry && (
              <Button
                aria-label='Retry upload'
                type='button'
                variant='ghost'
                size='icon'
                onClick={onRetry}
                disabled={disabled}
              >
                <RefreshCw className='size-3' />
              </Button>
            )}
            <Button
              aria-label='Remove file'
              type='button'
              variant='ghost'
              size='icon'
              onClick={onRemove}
              disabled={disabled}
            >
              <X className='size-3.5' />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
