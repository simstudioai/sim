'use client'

import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef } from 'react'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import { createSearchResource } from '@/lib/mothership/resources/search'
import { ChatPanelLayout } from '@/app/workspace/[workspaceId]/home/components/chat-panel-layout'
import { MothershipResourcesProvider } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import { useBrowserTabResources } from '@/app/workspace/[workspaceId]/home/hooks/use-browser-tab-resources'
import type { useChat } from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import type { useChatResourcePanel } from '@/app/workspace/[workspaceId]/home/hooks/use-resource-panel'
import { useTerminalTabResources } from '@/app/workspace/[workspaceId]/home/hooks/use-terminal-tab-resources'

const MothershipView = lazy(() =>
  import('@/app/workspace/[workspaceId]/home/components/mothership-view/mothership-view').then(
    (m) => ({ default: m.MothershipView })
  )
)

interface ChatResourcePanelProps {
  workspaceId?: string
  organizationId?: string
  chat: ReturnType<typeof useChat>
  panel: ReturnType<typeof useChatResourcePanel>
  children: ReactNode
  searchRequest?: { messageId: string; query: string }
  onSummarize?: (message: string, filters: WorkspaceSearchFilters) => void
}

/** Shared resizable resource chrome for workspace and organization chat. */
export function ChatResourcePanel({
  workspaceId,
  organizationId,
  chat,
  panel,
  children,
  searchRequest,
  onSummarize,
}: ChatResourcePanelProps) {
  useBrowserTabResources(panel.desktopTabResourceOptions)
  useTerminalTabResources(panel.desktopTabResourceOptions)
  const {
    resolvedChatId,
    desktopScopeId,
    resources,
    activeResourceId,
    removeResource,
    reorderResources,
    setTableViewContext,
    previewSession,
    isSending,
    genericResourceData,
  } = chat
  const {
    isResourceCollapsed,
    skipResourceTransition,
    resourceActivityIds,
    selectResourceFromUser,
    addResourceFromUser,
    collapseResource,
    expandResource,
    mothershipRef,
    handleResourceResizePointerDown,
    handleResourceInteraction,
  } = panel
  const searchInitialized = useRef(false)
  const lastSearchMessageId = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (chat.resolvedChatId && chat.isChatHistoryPending) return
    const initialHistory = !searchInitialized.current
    searchInitialized.current = true
    if (!searchRequest?.query || searchRequest.messageId === lastSearchMessageId.current) return
    lastSearchMessageId.current = searchRequest.messageId
    if (initialHistory && resources.some((resource) => resource.type === 'search')) return
    const scope = organizationId
      ? { kind: 'organization' as const, organizationId }
      : workspaceId
        ? { kind: 'workspace' as const, workspaceId }
        : undefined
    if (!scope) return
    addResourceFromUser(createSearchResource({ query: searchRequest.query, scope }))
  }, [
    searchRequest,
    organizationId,
    workspaceId,
    resources,
    addResourceFromUser,
    chat.resolvedChatId,
    chat.isChatHistoryPending,
  ])
  const summarize = useCallback(
    (message: string, filters: WorkspaceSearchFilters) => {
      if (onSummarize) onSummarize(message, filters)
      else void chat.sendMessage(message, undefined, undefined, { assistantSearch: filters })
    },
    [onSummarize, chat.sendMessage]
  )
  return (
    <ChatPanelLayout
      collapsed={isResourceCollapsed}
      label='resource view'
      activityCount={resourceActivityIds.size}
      onToggle={isResourceCollapsed ? expandResource : collapseResource}
      onResize={handleResourceResizePointerDown}
      panel={
        <MothershipResourcesProvider
          selectResource={selectResourceFromUser}
          addResource={addResourceFromUser}
          removeResource={removeResource}
          reorderResources={reorderResources}
          collapseResource={collapseResource}
        >
          <Suspense fallback={null}>
            <MothershipView
              ref={mothershipRef}
              workspaceId={workspaceId}
              organizationId={organizationId}
              chatId={resolvedChatId}
              desktopScopeId={desktopScopeId}
              resources={resources}
              onTableViewContextChange={setTableViewContext}
              activeResourceId={activeResourceId}
              activityResourceIds={resourceActivityIds}
              isCollapsed={isResourceCollapsed}
              previewSession={previewSession}
              isAgentResponding={isSending}
              genericResourceData={genericResourceData ?? undefined}
              onSummarize={summarize}
              onUserInteraction={handleResourceInteraction}
              className={skipResourceTransition ? 'transition-none!' : undefined}
            />
          </Suspense>
        </MothershipResourcesProvider>
      }
    >
      {children}
    </ChatPanelLayout>
  )
}
