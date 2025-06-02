export function KnowledgeBaseCardSkeleton() {
  return (
    <div className='rounded-lg border bg-background p-4'>
      <div className='flex items-start justify-between'>
        <div className='flex-1 space-y-3'>
          {/* Title skeleton */}
          <div className='h-4 w-3/4 animate-pulse rounded bg-muted' />

          {/* Description skeleton */}
          <div className='space-y-2'>
            <div className='h-3 w-full animate-pulse rounded bg-muted' />
            <div className='h-3 w-2/3 animate-pulse rounded bg-muted' />
          </div>

          {/* Stats skeleton */}
          <div className='flex items-center gap-4 pt-2'>
            <div className='flex items-center gap-1'>
              <div className='h-3 w-3 animate-pulse rounded bg-muted' />
              <div className='h-3 w-8 animate-pulse rounded bg-muted' />
            </div>
            <div className='flex items-center gap-1'>
              <div className='h-3 w-3 animate-pulse rounded bg-muted' />
              <div className='h-3 w-12 animate-pulse rounded bg-muted' />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function KnowledgeBaseCardSkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
      {Array.from({ length: count }).map((_, i) => (
        <KnowledgeBaseCardSkeleton key={i} />
      ))}
    </div>
  )
}
