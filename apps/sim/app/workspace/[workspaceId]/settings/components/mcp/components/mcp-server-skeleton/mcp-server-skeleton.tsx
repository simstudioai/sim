import { Skeleton } from '@/components/emcn'

/**
 * Skeleton loader for MCP server list items.
 * Matches the structure of ServerListItem component.
 */
export function McpServerSkeleton() {
  return (
    <div className='flex items-center justify-between gap-3'>
      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
        <div className='flex items-center gap-1.5'>
          <Skeleton className='h-4 w-[100px]' />
          <Skeleton className='h-3.5 w-[80px]' />
        </div>
        <Skeleton className='h-3.5 w-[120px]' />
      </div>
      <div className='flex flex-shrink-0 items-center gap-1'>
        <Skeleton className='h-[30px] w-[60px] rounded-sm' />
        <Skeleton className='h-[30px] w-[54px] rounded-sm' />
      </div>
    </div>
  )
}
