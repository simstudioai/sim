'use client'

import { Skeleton } from '@/components/emcn'

export function PreviewError({ label, error }: { label: string; error: string }) {
  return (
    <div className='flex flex-1 flex-col items-center justify-center gap-[8px]'>
      <p className='font-medium text-[14px] text-[var(--text-body)]'>Failed to preview {label}</p>
      <p className='text-[13px] text-[var(--text-muted)]'>{error}</p>
    </div>
  )
}

export function resolvePreviewError(
  fetchError: Error | null,
  renderError: string | null
): string | null {
  if (fetchError) return fetchError.message
  return renderError
}

export function shouldSuppressStreamingDocumentError(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('preview failed') ||
    lower.includes('aborterror') ||
    lower.includes('unexpected end') ||
    lower.includes('unexpected eof') ||
    lower.includes('invalid or unexpected token') ||
    lower.includes('end of central directory') ||
    lower.includes('corrupted zip') ||
    lower.includes('end of data reached')
  )
}

export const PDF_PAGE_SKELETON = (
  <div className='absolute inset-0 flex flex-col items-center gap-4 overflow-y-auto bg-[var(--surface-1)] p-6'>
    {[0, 1].map((i) => (
      <div
        key={i}
        className='w-full max-w-[640px] shrink-0 rounded-md bg-[var(--surface-2)] p-8 shadow-medium'
        style={{ aspectRatio: '1 / 1.414' }}
      >
        <div className='flex flex-col gap-3'>
          <Skeleton className='h-[14px] w-[60%]' />
          <Skeleton className='h-[14px] w-[80%]' />
          <Skeleton className='h-[14px] w-[55%]' />
          <Skeleton className='mt-2 h-[14px] w-[75%]' />
          <Skeleton className='h-[14px] w-[65%]' />
          <Skeleton className='h-[14px] w-[85%]' />
          <Skeleton className='h-[14px] w-[50%]' />
        </div>
      </div>
    ))}
  </div>
)
