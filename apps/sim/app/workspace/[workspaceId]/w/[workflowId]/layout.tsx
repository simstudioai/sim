import { ErrorBoundary } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/error'
import { WorkflowLocationBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-location-bar'

export default function WorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className='flex h-full flex-1 flex-col overflow-hidden'>
      <WorkflowLocationBar />
      <div className='relative min-h-0 flex-1 overflow-hidden'>
        <ErrorBoundary>{children}</ErrorBoundary>
      </div>
    </main>
  )
}
