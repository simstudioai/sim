import { ErrorBoundary } from '@/components/workflow-editor/components/error'

export default function WorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className='flex h-full flex-1 flex-col overflow-hidden'>
      <ErrorBoundary>{children}</ErrorBoundary>
    </main>
  )
}
