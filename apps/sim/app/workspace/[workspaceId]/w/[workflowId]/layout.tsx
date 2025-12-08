import { ErrorBoundary } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/error'

/**
 * Main workflow layout responsible for wrapping child routes with shared UI chrome.
 */
export default function WorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className='flex h-full flex-1 flex-col overflow-hidden bg-muted/40'>
      <ErrorBoundary>{children}</ErrorBoundary>
    </main>
  )
}
