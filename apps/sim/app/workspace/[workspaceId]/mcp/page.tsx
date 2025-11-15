import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { McpProjectManager } from '@/app/workspace/[workspaceId]/mcp/components/mcp-project-manager'

interface WorkspaceMcpPageProps {
  params: { workspaceId: string }
}

export default function WorkspaceMcpPage({ params }: WorkspaceMcpPageProps) {
  return (
    <div className='flex flex-1 flex-col gap-6 p-6'>
      <div className='max-w-3xl space-y-2'>
        <h1 className='text-2xl font-semibold tracking-tight'>Hosted MCP Servers</h1>
        <p className='text-sm text-muted-foreground'>
          Create and deploy Model Context Protocol servers without leaving Sim. Projects inherit
          your workspace permissions, tokens, and environment variables, making it simple to expose
          internal tools, Reddit monitors, or arXiv scrapers to every workflow.
        </p>
      </div>
      <Suspense
        fallback={
          <div className='flex h-32 items-center justify-center rounded-lg border bg-muted/40'>
            <Loader2 className='mr-2 h-5 w-5 animate-spin text-muted-foreground' />
            <span className='text-muted-foreground'>Loading projects…</span>
          </div>
        }
      >
        <McpProjectManager workspaceId={params.workspaceId} />
      </Suspense>
    </div>
  )
}
