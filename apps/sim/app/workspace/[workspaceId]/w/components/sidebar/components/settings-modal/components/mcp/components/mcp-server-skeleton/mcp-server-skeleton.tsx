import { Skeleton } from '@/components/ui'

/**
 * Skeleton loader for MCP server list items.
 * Matches the structure of ServerListItem component.
 */
export function McpServerSkeleton() {
  return (
    <div className='flex items-center justify-between gap-[12px]'>
      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
        <div className='flex items-center gap-[6px]'>
          <Skeleton className='h-[14px] w-[100px]' />
          <Skeleton className='h-[13px] w-[80px]' />
        </div>
        <Skeleton className='h-[13px] w-[120px]' />
      </div>
      <div className='flex flex-shrink-0 items-center gap-[4px]'>
        <Skeleton className='h-[30px] w-[60px] rounded-[4px]' />
        <Skeleton className='h-[30px] w-[54px] rounded-[4px]' />
      </div>
    </div>
  )
}
