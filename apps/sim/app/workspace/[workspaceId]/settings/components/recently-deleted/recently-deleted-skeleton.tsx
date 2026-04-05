import { Skeleton } from '@/components/emcn'
import { DeletedItemSkeleton } from '@/app/workspace/[workspaceId]/settings/components/recently-deleted/deleted-item-skeleton'

/**
 * Skeleton component for the entire Recently Deleted settings section.
 * Renders placeholder UI for the search bar, sort dropdown, tabs, and item list.
 */
export function RecentlyDeletedSkeleton() {
  return (
    <div className='flex h-full flex-col gap-4.5'>
      {/* Search bar + sort dropdown row */}
      <div className='flex items-center gap-2'>
        <Skeleton className='h-[30px] flex-1 rounded-lg' />
        <Skeleton className='h-[30px] w-[190px] shrink-0 rounded-lg' />
      </div>

      {/* Tabs bar */}
      <div className='relative flex gap-4 border-b border-[var(--border)] px-4'>
        <Skeleton className='mb-2 h-[20px] w-[32px] rounded-sm' />
        <Skeleton className='mb-2 h-[20px] w-[72px] rounded-sm' />
        <Skeleton className='mb-2 h-[20px] w-[52px] rounded-sm' />
        <Skeleton className='mb-2 h-[20px] w-[112px] rounded-sm' />
        <Skeleton className='mb-2 h-[20px] w-[40px] rounded-sm' />
      </div>

      {/* Item list */}
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='flex flex-col gap-2'>
          <DeletedItemSkeleton />
          <DeletedItemSkeleton />
          <DeletedItemSkeleton />
        </div>
      </div>
    </div>
  )
}
