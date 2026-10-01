import { lazy, StrictMode, Suspense, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  activateBrowserScope,
  migrateBrowserScope,
  openUrlInNewBrowserTab,
  reportBrowserPanelBounds,
} from '@/lib/browser-agent/transport'
import {
  ChatPanelContent,
  ChatPanelLayout,
} from '@/app/workspace/[workspaceId]/home/components/chat-panel-layout'
import { useMothershipResize } from '@/app/workspace/[workspaceId]/home/hooks/use-mothership-resize'
import { useChatPanelStore } from '@/stores/chat-panel/store'

const LazyContent = lazy(async () => ({ default: ChatPanelContent }))

interface ChatFixtureProps {
  chatId: string
  userId: string
}

function ChatFixture({ chatId, userId }: ChatFixtureProps) {
  const browserHost = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(false)
  const panel = useMothershipResize(chatId, { userId, collapsed })
  const startBrowser = async () => {
    await activateBrowserScope(chatId)
    await openUrlInNewBrowserTab(
      `${location.origin.replace('127.0.0.1', 'localhost')}/page`,
      chatId
    )
    const rect = browserHost.current?.getBoundingClientRect()
    if (rect)
      reportBrowserPanelBounds(
        { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        null,
        chatId
      )
  }
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
            <div ref={browserHost} className='m-4 flex-1'>
              Resource
            </div>
          </LazyContent>
        </Suspense>
      }
    >
      <div className='min-w-[min(480px,100%)] flex-1'>
        Chat
        <button onClick={() => void startBrowser()}>Start browser</button>
      </div>
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
        {[
          'workspace-chat-a',
          'workspace-chat-b',
          'organization-chat-a',
          'pending:chat',
          'pending:native',
          'assigned-chat',
        ].map((id) => (
          <button key={id} onClick={() => setChatId(id)}>
            {id}
          </button>
        ))}
        <button
          disabled={chatId === 'assigned-chat'}
          onClick={async () => {
            useChatPanelStore.getState().migrate(chatId, 'assigned-chat')
            await migrateBrowserScope(chatId, 'assigned-chat')
            setChatId('assigned-chat')
          }}
        >
          Assign chat ID
        </button>
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
