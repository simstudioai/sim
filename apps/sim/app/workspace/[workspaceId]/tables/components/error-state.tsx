interface ErrorStateProps {
  error: unknown
}

export function ErrorState({ error }: ErrorStateProps) {
  return (
    <div className='col-span-full flex h-64 items-center justify-center rounded-[4px] bg-[var(--surface-3)] dark:bg-[var(--surface-4)]'>
      <div className='text-center'>
        <p className='font-medium text-[var(--text-secondary)] text-sm'>Error loading tables</p>
        <p className='mt-1 text-[var(--text-muted)] text-xs'>
          {error instanceof Error ? error.message : 'An error occurred'}
        </p>
      </div>
    </div>
  )
}
