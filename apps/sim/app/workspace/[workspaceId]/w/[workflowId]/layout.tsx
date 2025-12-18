import { ErrorBoundary } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/error'

export default function WorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className='flex h-full flex-1 flex-col overflow-hidden bg-[var(--surface-0)]'>
      <ErrorBoundary>{children}</ErrorBoundary>
    </main>
  )
}
