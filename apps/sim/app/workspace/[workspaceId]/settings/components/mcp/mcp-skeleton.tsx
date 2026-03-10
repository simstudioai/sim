import { McpServerSkeleton } from '@/app/workspace/[workspaceId]/settings/components/mcp/components/mcp-server-skeleton/mcp-server-skeleton'

/**
 * Skeleton for the MCP section shown during dynamic import loading.
 */
export function McpSkeleton() {
  return (
    <div className='flex flex-col gap-[12px]'>
      <McpServerSkeleton />
      <McpServerSkeleton />
      <McpServerSkeleton />
    </div>
  )
}
