import { Chat } from './components/chat/chat'
import { Console } from './components/console/console'
import { ControlBar } from './components/control-bar/control-bar'
import { ErrorBoundary } from './components/error'
import { Toolbar } from './components/toolbar/toolbar'

export default function WorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ControlBar />
      <Toolbar />
      {/* <Chat /> */}
      <Console />
      <main className="grid items-start gap-2 bg-muted/40 h-[calc(100vh-4rem)]">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </>
  )
}
