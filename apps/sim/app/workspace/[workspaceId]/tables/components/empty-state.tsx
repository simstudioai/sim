interface EmptyStateProps {
  hasSearchQuery: boolean
}

export function EmptyState({ hasSearchQuery }: EmptyStateProps) {
  return (
    <div className='col-span-full flex h-64 items-center justify-center rounded-lg border border-muted-foreground/25 bg-muted/20'>
      <div className='text-center'>
        <p className='font-medium text-[var(--text-secondary)] text-sm'>
          {hasSearchQuery ? 'No tables found' : 'No tables yet'}
        </p>
        <p className='mt-1 text-[var(--text-muted)] text-xs'>
          {hasSearchQuery
            ? 'Try a different search term'
            : 'Create your first table to store structured data for your workflows'}
        </p>
      </div>
    </div>
  )
}
