import { ErrorBoundary } from './components/error'

export default function WorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className='h-full overflow-hidden bg-muted/40'>
      <ErrorBoundary>{children}</ErrorBoundary>
    </main>
  )
}
