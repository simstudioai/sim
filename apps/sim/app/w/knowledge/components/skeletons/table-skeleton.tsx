export function DocumentTableRowSkeleton({ isSidebarCollapsed }: { isSidebarCollapsed: boolean }) {
  return (
    <tr className='border-b'>
      {/* Select column */}
      <td className='px-4 py-3'>
        <div className='h-3.5 w-3.5 animate-pulse rounded bg-muted' />
      </td>

      {/* Name column */}
      <td className='px-4 py-3'>
        <div className='flex items-center gap-2'>
          <div className='h-6 w-5 animate-pulse rounded bg-muted' />
          <div className='h-4 w-32 animate-pulse rounded bg-muted' />
        </div>
      </td>

      {/* Size column */}
      <td className='px-4 py-3'>
        <div className='h-3 w-12 animate-pulse rounded bg-muted' />
      </td>

      {/* Tokens column */}
      <td className='px-4 py-3'>
        <div className='h-3 w-8 animate-pulse rounded bg-muted' />
      </td>

      {/* Chunks column - hidden on small screens */}
      <td className='hidden px-4 py-3 lg:table-cell'>
        <div className='h-3 w-6 animate-pulse rounded bg-muted' />
      </td>

      {/* Upload Time column */}
      <td className='px-4 py-3'>
        <div className='space-y-1'>
          <div className='h-3 w-16 animate-pulse rounded bg-muted' />
          <div className='h-3 w-12 animate-pulse rounded bg-muted lg:hidden' />
        </div>
      </td>

      {/* Processing Status column */}
      <td className='px-4 py-3'>
        <div className='h-6 w-16 animate-pulse rounded-md bg-muted' />
      </td>

      {/* Active Status column */}
      <td className='px-4 py-3'>
        <div className='h-6 w-16 animate-pulse rounded-md bg-muted' />
      </td>

      {/* Actions column */}
      <td className='px-4 py-3'>
        <div className='flex items-center gap-1'>
          <div className='h-8 w-8 animate-pulse rounded bg-muted' />
          <div className='h-8 w-8 animate-pulse rounded bg-muted' />
          <div className='h-8 w-8 animate-pulse rounded bg-muted' />
        </div>
      </td>
    </tr>
  )
}

export function ChunkTableRowSkeleton({ isSidebarCollapsed }: { isSidebarCollapsed: boolean }) {
  return (
    <tr className='border-b'>
      {/* Select column */}
      <td className='px-4 py-3'>
        <div className='h-3.5 w-3.5 animate-pulse rounded bg-muted' />
      </td>

      {/* Index column */}
      <td className='px-4 py-3'>
        <div className='h-4 w-6 animate-pulse rounded bg-muted' />
      </td>

      {/* Content column */}
      <td className='px-4 py-3'>
        <div className='space-y-2'>
          <div className='h-4 w-full animate-pulse rounded bg-muted' />
          <div className='h-4 w-3/4 animate-pulse rounded bg-muted' />
          <div className='h-4 w-1/2 animate-pulse rounded bg-muted' />
        </div>
      </td>

      {/* Tokens column */}
      <td className='px-4 py-3'>
        <div className='h-3 w-8 animate-pulse rounded bg-muted' />
      </td>

      {/* Status column */}
      <td className='px-4 py-3'>
        <div className='h-6 w-16 animate-pulse rounded-md bg-muted' />
      </td>

      {/* Actions column */}
      <td className='px-4 py-3'>
        <div className='flex items-center gap-1'>
          <div className='h-8 w-8 animate-pulse rounded bg-muted' />
          <div className='h-8 w-8 animate-pulse rounded bg-muted' />
        </div>
      </td>
    </tr>
  )
}

export function DocumentTableSkeleton({
  isSidebarCollapsed,
  rowCount = 5,
}: {
  isSidebarCollapsed: boolean
  rowCount?: number
}) {
  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      {/* Table header - fixed */}
      <div className='sticky top-0 z-10 overflow-x-auto border-b bg-background'>
        <table className='w-full min-w-[800px] table-fixed'>
          <colgroup>
            <col className='w-[4%]' />
            <col className={`${isSidebarCollapsed ? 'w-[20%]' : 'w-[22%]'}`} />
            <col className='w-[8%]' />
            <col className='w-[8%]' />
            <col className='hidden w-[8%] lg:table-column' />
            <col className={`${isSidebarCollapsed ? 'w-[16%]' : 'w-[14%]'}`} />
            <col className='w-[10%]' />
            <col className='w-[10%]' />
            <col className='w-[12%]' />
          </colgroup>
          <thead>
            <tr>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <div className='h-3.5 w-3.5 animate-pulse rounded bg-muted' />
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs leading-none'>Name</span>
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs leading-none'>Size</span>
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs leading-none'>Tokens</span>
              </th>
              <th className='hidden px-4 pt-2 pb-3 text-left font-medium lg:table-cell'>
                <span className='text-muted-foreground text-xs leading-none'>Chunks</span>
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs leading-none'>Uploaded</span>
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs leading-none'>Processing</span>
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs leading-none'>Status</span>
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs leading-none'>Actions</span>
              </th>
            </tr>
          </thead>
        </table>
      </div>

      {/* Table body - scrollable */}
      <div className='flex-1 overflow-auto'>
        <table className='w-full min-w-[800px] table-fixed'>
          <colgroup>
            <col className='w-[4%]' />
            <col className={`${isSidebarCollapsed ? 'w-[20%]' : 'w-[22%]'}`} />
            <col className='w-[8%]' />
            <col className='w-[8%]' />
            <col className='hidden w-[8%] lg:table-column' />
            <col className={`${isSidebarCollapsed ? 'w-[16%]' : 'w-[14%]'}`} />
            <col className='w-[10%]' />
            <col className='w-[10%]' />
            <col className='w-[12%]' />
          </colgroup>
          <tbody>
            {Array.from({ length: rowCount }).map((_, i) => (
              <DocumentTableRowSkeleton key={i} isSidebarCollapsed={isSidebarCollapsed} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function ChunkTableSkeleton({
  isSidebarCollapsed,
  rowCount = 5,
}: {
  isSidebarCollapsed: boolean
  rowCount?: number
}) {
  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      {/* Table header - fixed */}
      <div className='sticky top-0 z-10 border-b bg-background'>
        <table className='w-full table-fixed'>
          <colgroup>
            <col className='w-[5%]' />
            <col className='w-[8%]' />
            <col className={`${isSidebarCollapsed ? 'w-[57%]' : 'w-[55%]'}`} />
            <col className='w-[10%]' />
            <col className='w-[10%]' />
            <col className='w-[12%]' />
          </colgroup>
          <thead>
            <tr>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <div className='h-3.5 w-3.5 animate-pulse rounded bg-muted' />
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs leading-none'>Index</span>
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs leading-none'>Content</span>
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs leading-none'>Tokens</span>
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs leading-none'>Status</span>
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs leading-none'>Actions</span>
              </th>
            </tr>
          </thead>
        </table>
      </div>

      {/* Table body - scrollable */}
      <div className='flex-1 overflow-auto'>
        <table className='w-full table-fixed'>
          <colgroup>
            <col className='w-[5%]' />
            <col className='w-[8%]' />
            <col className={`${isSidebarCollapsed ? 'w-[57%]' : 'w-[55%]'}`} />
            <col className='w-[10%]' />
            <col className='w-[10%]' />
            <col className='w-[12%]' />
          </colgroup>
          <tbody>
            {Array.from({ length: rowCount }).map((_, i) => (
              <ChunkTableRowSkeleton key={i} isSidebarCollapsed={isSidebarCollapsed} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
