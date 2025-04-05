import { Chat } from './components/chat/chat'
import { ErrorBoundary } from './components/error'

export default function WorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* <Chat /> */}
      <main className="bg-muted/40 overflow-hidden h-full">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </>
  )
}
