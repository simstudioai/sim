import { Chip } from '@sim/emcn'

interface ResourceLoadErrorProps {
  message: string
  onRetry: () => void
}

/** What a resource table shows when its first page failed to load. */
export function ResourceLoadError({ message, onRetry }: ResourceLoadErrorProps) {
  return (
    <div role='alert' className='flex flex-col items-center gap-3 p-6'>
      <p className='text-[var(--text-error)] text-small'>{message}</p>
      <Chip onClick={onRetry}>Retry</Chip>
    </div>
  )
}
