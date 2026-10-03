import { type ComponentPropsWithoutRef, forwardRef } from 'react'
import { ImageUp } from '../../icons/image-up'
import { Loader } from '../../icons/loader'
import { cn } from '../../lib/cn'

export interface UploadPreviewButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'type'> {
  /** Accessible name describing which image will be uploaded or replaced. */
  'aria-label': string
  /** Shows the shared loader and prevents another activation during upload. */
  loading?: boolean
}

/**
 * Image-upload preview tile. Renders the caller's image, an empty-image icon,
 * or a loading indicator. File selection, validation, and uploads stay with
 * the caller. The 64px square can expand through layout classes such as `w-full`.
 *
 * @example
 * <UploadPreviewButton aria-label='Change logo' loading={uploading} onClick={selectFile}>
 *   {logoUrl ? <img src={logoUrl} alt='' className='size-full object-contain p-1' /> : null}
 * </UploadPreviewButton>
 */
export const UploadPreviewButton = forwardRef<HTMLButtonElement, UploadPreviewButtonProps>(
  ({ children, className, loading = false, disabled, ...props }, ref) => (
    <button
      {...props}
      ref={ref}
      type='button'
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'group relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] transition-colors hover:bg-[var(--surface-3)] disabled:opacity-50',
        className
      )}
    >
      {loading ? (
        <Loader className='size-5 text-[var(--text-muted)]' animate />
      ) : (
        (children ?? <ImageUp className='size-5 text-[var(--text-muted)]' />)
      )}
    </button>
  )
)

UploadPreviewButton.displayName = 'UploadPreviewButton'
