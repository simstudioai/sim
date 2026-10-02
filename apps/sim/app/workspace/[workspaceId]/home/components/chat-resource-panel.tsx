'use client'

import { lazy, type ReactNode, Suspense, useCallback, useEffect, useState } from 'react'
import { cn } from '@sim/emcn'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import { ChatPanelLayout } from '@/app/workspace/[workspaceId]/home/components/chat-panel-layout'
import { MothershipResourcesProvider } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import type { ResourcePanelNavigation } from '@/app/workspace/[workspaceId]/home/components/resource-panel-navigation'
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
  navigation?: ResourcePanelNavigation
  workspaceId?: string
  organizationId?: string
  allowBuildControls?: boolean
  chat: ReturnType<typeof useChat>
  panel: ReturnType<typeof useChatResourcePanel>
  children: ReactNode
  onSummarize?: (message: string, filters: WorkspaceSearchFilters) => void
}

/** Shared resizable resource chrome for workspace and organization chat. */
export function ChatResourcePanel({
  navigation,
  workspaceId,
  organizationId,
  allowBuildControls,
  chat,
  panel,
  children,
  onSummarize,
}: ChatResourcePanelProps) {
  const [chatHidden, setChatHidden] = useState(false)
  const isChatHidden = Boolean(navigation) && chatHidden && !panel.isResourceCollapsed
  useEffect(() => {
    if (chat.isSending) setChatHidden(false)
  }, [chat.isSending])
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
    handleResourceResizeKeyDown,
    handleResourceResizeFocus,
    handleResourceInteraction,
  } = panel
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
      chatHidden={isChatHidden}
      onToggleChat={navigation ? () => setChatHidden((hidden) => !hidden) : undefined}
      label='resource view'
      activityCount={resourceActivityIds.size}
      onToggle={() => {
        setChatHidden(false)
        if (isResourceCollapsed) expandResource()
        else collapseResource()
      }}
      onResize={handleResourceResizePointerDown}
      onResizeKeyDown={handleResourceResizeKeyDown}
      onResizeFocus={handleResourceResizeFocus}
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
              navigation={navigation}
              ref={mothershipRef}
              workspaceId={workspaceId}
              organizationId={organizationId}
              allowBuildControls={allowBuildControls}
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
              className={cn(
                skipResourceTransition && 'transition-none!',
                isChatHidden && 'w-full! min-w-0! flex-1 border-l-0!'
              )}
            />
          </Suspense>
        </MothershipResourcesProvider>
      }
    >
      {children}
    </ChatPanelLayout>
  )
}
