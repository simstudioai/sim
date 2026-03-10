import { Skeleton } from '@/components/emcn'
import { McpServerSkeleton } from '@/app/workspace/[workspaceId]/settings/components/mcp/components/mcp-server-skeleton/mcp-server-skeleton'

/**
 * Skeleton for the MCP section shown during dynamic import loading.
 */
export function McpSkeleton() {
  return (
    <div className='flex h-full flex-col gap-[18px]'>
      <div className='flex items-center gap-[8px]'>
        <Skeleton className='h-[30px] flex-1 rounded-[8px]' />
        <Skeleton className='h-[30px] w-[64px] rounded-[6px]' />
      </div>
      <div className='flex flex-col gap-[8px]'>
        <McpServerSkeleton />
        <McpServerSkeleton />
        <McpServerSkeleton />
      </div>
    </div>
  )
}
