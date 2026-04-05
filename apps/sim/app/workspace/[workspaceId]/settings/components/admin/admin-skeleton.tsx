import { Skeleton } from '@/components/emcn'

/**
 * Skeleton component for admin settings loading state.
 * Matches the exact layout structure of the Admin component.
 */
export function AdminSkeleton() {
  return (
    <div className='flex h-full flex-col gap-6'>
      {/* Super admin mode toggle */}
      <div className='flex items-center justify-between'>
        <Skeleton className='h-[14px] w-[120px]' />
        <Skeleton className='h-[20px] w-[36px] rounded-full' />
      </div>

      <div className='h-px bg-[var(--border-secondary)]' />

      {/* Workflow import section */}
      <div className='flex flex-col gap-2'>
        <Skeleton className='h-[14px] w-[340px]' />
        <div className='flex gap-2'>
          <Skeleton className='h-9 flex-1 rounded-md' />
          <Skeleton className='h-9 w-[80px] rounded-md' />
        </div>
      </div>

      <div className='h-px bg-[var(--border-secondary)]' />

      {/* User management section */}
      <div className='flex flex-col gap-3'>
        <Skeleton className='h-[14px] w-[120px]' />

        {/* Search input + button */}
        <div className='flex gap-2'>
          <Skeleton className='h-9 flex-1 rounded-md' />
          <Skeleton className='h-9 w-[80px] rounded-md' />
        </div>

        {/* Table */}
        <div className='flex flex-col gap-0.5'>
          {/* Column headers */}
          <div className='flex items-center gap-3 border-[var(--border-secondary)] border-b px-3 py-2'>
            <Skeleton className='h-[12px] w-[200px]' />
            <Skeleton className='h-[12px] flex-1' />
            <Skeleton className='h-[12px] w-[80px]' />
            <Skeleton className='h-[12px] w-[80px]' />
            <Skeleton className='h-[12px] w-[250px]' />
          </div>

          {/* Table rows */}
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className='flex items-center gap-3 border-[var(--border-secondary)] border-b px-3 py-2 last:border-b-0'
            >
              <Skeleton className='h-[14px] w-[200px]' />
              <Skeleton className='h-[14px] flex-1' />
              <Skeleton className='h-[20px] w-[50px] rounded-full' />
              <Skeleton className='h-[20px] w-[50px] rounded-full' />
              <div className='flex w-[250px] justify-end gap-1'>
                <Skeleton className='h-[28px] w-[80px] rounded-md' />
                <Skeleton className='h-[28px] w-[64px] rounded-md' />
                <Skeleton className='h-[28px] w-[40px] rounded-md' />
              </div>
            </div>
          ))}
        </div>

        {/* Pagination */}
        <div className='flex items-center justify-between'>
          <Skeleton className='h-[14px] w-[160px]' />
          <div className='flex gap-1'>
            <Skeleton className='h-[28px] w-[64px] rounded-md' />
            <Skeleton className='h-[28px] w-[48px] rounded-md' />
          </div>
        </div>
      </div>
    </div>
  )
}
