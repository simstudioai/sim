/**
 * Skeleton placeholder for a knowledge base card
 * Matches the structure of BaseOverview component
 */
export function KnowledgeBaseCardSkeleton() {
  return (
    <div className='flex h-full flex-col gap-[12px] rounded-[4px] bg-[var(--surface-elevated)] px-[8px] py-[6px]'>
      <div className='flex items-center justify-between gap-[8px]'>
        <div className='h-[17px] w-[120px] animate-pulse rounded-[4px] bg-[var(--surface-9)]' />
        <div className='h-[22px] w-[90px] animate-pulse rounded-[4px] bg-[var(--surface-5)]' />
      </div>

      <div className='flex flex-1 flex-col gap-[8px]'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-[6px]'>
            <div className='h-[14px] w-[14px] animate-pulse rounded-[2px] bg-[var(--surface-9)]' />
            <div className='h-[14px] w-[45px] animate-pulse rounded-[4px] bg-[var(--surface-9)]' />
          </div>
          <div className='h-[14px] w-[50px] animate-pulse rounded-[4px] bg-[var(--surface-5)]' />
        </div>

        <div className='h-0 w-full border-[var(--divider)] border-t' />

        <div className='flex h-[36px] flex-col gap-[6px]'>
          <div className='h-[14px] w-full animate-pulse rounded-[4px] bg-[var(--surface-5)]' />
          <div className='h-[14px] w-[75%] animate-pulse rounded-[4px] bg-[var(--surface-5)]' />
        </div>
      </div>
    </div>
  )
}

/**
 * Renders multiple knowledge base card skeletons as a fragment
 * To be used inside an existing grid container
 */
export function KnowledgeBaseCardSkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <KnowledgeBaseCardSkeleton key={i} />
      ))}
    </>
  )
}
