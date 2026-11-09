import { StrictMode, useEffect, useState } from 'react'
import { PlatformSurface } from '@sim/emcn-platform/surface/platform-surface'
import {
  AppRouterContext,
  type AppRouterInstance,
} from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { createRoot } from 'react-dom/client'
import {
  activateBrowserScope,
  initBrowserAgentTransport,
  migrateBrowserScope,
  openUrlInNewBrowserTab,
} from '@/lib/browser-agent/transport'
import { ChatPanelTrigger } from '@/app/(product)/_components/chat/panel/chat-panels'
import { ResourcePanels } from '@/app/(product)/_components/chat/panel/resource-panels'
import { useMothershipResize } from '@/hooks/mothership-chat/use-mothership-resize'
import { SurfaceScopeProvider } from '@/platform/lib/surface-scope'
import { useChatPanelStore } from '@/stores/chat-panel/store'

const router: AppRouterInstance = {
  bfcacheId: 'fixture',
  back: () => history.back(),
  forward: () => history.forward(),
  refresh: () => location.reload(),
  push: (url: string) => location.assign(url),
  replace: (url: string) => location.replace(url),
  prefetch: () => {},
}

interface ChatFixtureProps {
  scopeId: string
  userId: string
}

/**
 * One chat as the product renders it: the product's resource panel over the real resize hook, with
 * one browser tab hosting the desktop app's native page.
 */
function ChatFixture({ scopeId, userId }: ChatFixtureProps) {
  const [collapsed, setCollapsed] = useState(false)
  const resize = useMothershipResize(scopeId, { userId, collapsed })
  const startBrowser = async () => {
    await activateBrowserScope(scopeId)
    await openUrlInNewBrowserTab(
      `${location.origin.replace('127.0.0.1', 'localhost')}/page`,
      scopeId
    )
  }
  return (
    <ResourcePanels
      panel={{
        resources: [{ id: 'fixture-browser', type: 'browser', title: 'Browser', active: true }],
        collapsed,
        onSelect: () => {},
        onRemove: () => setCollapsed(true),
        onExpand: () => setCollapsed(false),
        onCollapse: () => setCollapsed(true),
        resize: {
          panelRef: resize.mothershipRef,
          onPointerDown: resize.handleResizePointerDown,
          onKeyDown: resize.handleResizeKeyDown,
          onFocus: resize.handleResizeFocus,
        },
        onInteraction: () => {},
        browserScopeId: scopeId,
      }}
    >
      <div>
        Chat
        <ChatPanelTrigger />
        <button type='button' onClick={() => void startBrowser()}>
          Start browser
        </button>
      </div>
    </ResourcePanels>
  )
}

function ChatPanelFixture() {
  const [chat, setChat] = useState({ key: 'workspace-chat-a', scopeId: 'workspace-chat-a' })
  const [userId, setUserId] = useState('user-a')
  const [settings, setSettings] = useState(false)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => initBrowserAgentTransport(), [])
  return (
    <AppRouterContext.Provider value={router}>
      <SurfaceScopeProvider routePrefix='/o/fixture-organization'>
        <PlatformSurface theme='dark' canvas>
          <nav>
            {[
              'workspace-chat-a',
              'workspace-chat-b',
              'organization-chat-a',
              'pending:chat',
              'pending:native',
              'assigned-chat',
            ].map((id) => (
              <button key={id} type='button' onClick={() => setChat({ key: id, scopeId: id })}>
                {id}
              </button>
            ))}
            <button
              type='button'
              disabled={chat.scopeId === 'assigned-chat'}
              onClick={async () => {
                useChatPanelStore.getState().migrate(chat.scopeId, 'assigned-chat')
                await migrateBrowserScope(chat.scopeId, 'assigned-chat')
                // A chat that adopts its permanent id keeps its mounted surface, as the product's does.
                setChat({ key: chat.key, scopeId: 'assigned-chat' })
              }}
            >
              Assign chat ID
            </button>
            <button type='button' onClick={() => setSettings(!settings)}>
              {settings ? 'Back' : 'Settings'}
            </button>
            <button type='button' onClick={() => setNarrow(!narrow)}>
              Resize container
            </button>
            <button
              type='button'
              onClick={() => setUserId(userId === 'user-a' ? 'user-b' : 'user-a')}
            >
              Switch account
            </button>
          </nav>
          <main data-narrow={narrow || undefined}>
            {!settings && (
              <ChatFixture key={`${userId}:${chat.key}`} scopeId={chat.scopeId} userId={userId} />
            )}
          </main>
        </PlatformSurface>
      </SurfaceScopeProvider>
    </AppRouterContext.Provider>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing fixture root')
createRoot(root).render(
  <StrictMode>
    <ChatPanelFixture />
  </StrictMode>
)
