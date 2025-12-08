import { ErrorBoundary } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/error'

export default function WorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className='flex flex-1 flex-col h-full overflow-hidden bg-muted/40'>
      <ErrorBoundary>{children}</ErrorBoundary>
    </main>
  )
}
