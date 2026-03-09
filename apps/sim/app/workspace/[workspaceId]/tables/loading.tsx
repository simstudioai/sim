/**
 * Loading skeleton for the Tables page.
 * Matches the ResourceLayout shell: icon badge + title + search bar + table header + rows.
 */
export default function TablesLoading() {
  return (
    <div className='flex h-full flex-1 flex-col'>
      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-auto bg-white px-6 pt-7 pb-6 dark:bg-[var(--bg)]'>
          {/* Header: icon badge + title + create button */}
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-3'>
              <div className='h-[26px] w-[26px] animate-pulse rounded-[6px] bg-[#EFF6FF] dark:bg-[#1E3A5F]' />
              <div className='h-[20px] w-[60px] animate-pulse rounded bg-[var(--surface-5)]' />
            </div>
            <div className='h-8 w-[100px] animate-pulse rounded-md bg-[var(--surface-5)]' />
          </div>

          {/* Search bar */}
          <div className='mt-3.5'>
            <div className='h-8 w-60 animate-pulse rounded-lg bg-[var(--surface-4)]' />
          </div>

          {/* Table skeleton */}
          <div className='mt-4'>
            {/* Table header */}
            <div className='flex items-center border-b px-4 py-2'>
              <div className='h-3 w-[40%] animate-pulse rounded bg-[var(--surface-5)]' />
              <div className='h-3 w-[15%] animate-pulse rounded bg-[var(--surface-5)]' />
              <div className='h-3 w-[15%] animate-pulse rounded bg-[var(--surface-5)]' />
              <div className='h-3 w-[18%] animate-pulse rounded bg-[var(--surface-5)]' />
            </div>
            {/* Table rows */}
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className='flex items-center border-b px-4 py-3'>
                <div className='h-4 w-[35%] animate-pulse rounded bg-[var(--surface-5)]' />
                <div className='h-4 w-[10%] animate-pulse rounded bg-[var(--surface-5)]' />
                <div className='h-4 w-[10%] animate-pulse rounded bg-[var(--surface-5)]' />
                <div className='h-4 w-[14%] animate-pulse rounded bg-[var(--surface-5)]' />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
