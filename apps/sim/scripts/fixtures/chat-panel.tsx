import { lazy, StrictMode, Suspense, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ChatPanelContent,
  ChatPanelLayout,
} from '@/app/workspace/[workspaceId]/home/components/chat-panel-layout'
import { useMothershipResize } from '@/app/workspace/[workspaceId]/home/hooks/use-mothership-resize'

const LazyContent = lazy(async () => ({ default: ChatPanelContent }))

interface ChatFixtureProps {
  chatId: string
  userId: string
}

function ChatFixture({ chatId, userId }: ChatFixtureProps) {
  const [collapsed, setCollapsed] = useState(false)
  const panel = useMothershipResize(chatId, { userId, collapsed })
  return (
    <ChatPanelLayout
      collapsed={collapsed}
      label='resource view'
      onToggle={() => setCollapsed(!collapsed)}
      onResize={panel.handleResizePointerDown}
      onResizeKeyDown={panel.handleResizeKeyDown}
      onResizeFocus={panel.handleResizeFocus}
      panel={
        <Suspense fallback={null}>
          <LazyContent ref={panel.mothershipRef} collapsed={collapsed}>
            Resource
          </LazyContent>
        </Suspense>
      }
    >
      <div className='min-w-[min(480px,100%)] flex-1'>Chat</div>
    </ChatPanelLayout>
  )
}

interface ChatPanelFixtureProps {
  [key: string]: never
}

function ChatPanelFixture(_props: ChatPanelFixtureProps) {
  const [chatId, setChatId] = useState('workspace-chat-a')
  const [userId, setUserId] = useState('user-a')
  const [settings, setSettings] = useState(false)
  const [narrow, setNarrow] = useState(false)
  return (
    <>
      <nav className='flex h-[40px] gap-4'>
        {['workspace-chat-a', 'workspace-chat-b', 'organization-chat-a'].map((id) => (
          <button key={id} onClick={() => setChatId(id)}>
            {id}
          </button>
        ))}
        <button onClick={() => setSettings(!settings)}>{settings ? 'Back' : 'Settings'}</button>
        <button onClick={() => setNarrow(!narrow)}>Resize container</button>
        <button onClick={() => setUserId(userId === 'user-a' ? 'user-b' : 'user-a')}>
          Switch account
        </button>
      </nav>
      <div className='h-[600px]' style={{ width: narrow ? 1000 : '100%' }}>
        {!settings && <ChatFixture chatId={chatId} userId={userId} />}
      </div>
    </>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing fixture root')
createRoot(root).render(
  <StrictMode>
    <ChatPanelFixture />
  </StrictMode>
)
