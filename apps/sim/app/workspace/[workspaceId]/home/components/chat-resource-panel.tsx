'use client'

import { lazy, type ReactNode, Suspense, useCallback } from 'react'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
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
  allowBuildControls?: boolean
  chat: ReturnType<typeof useChat>
  panel: ReturnType<typeof useChatResourcePanel>
  children: ReactNode
  onSummarize?: (message: string, filters: WorkspaceSearchFilters) => void
}

/** Shared resizable resource chrome for workspace and organization chat. */
export function ChatResourcePanel({
  workspaceId,
  organizationId,
  allowBuildControls,
  chat,
  panel,
  children,
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
