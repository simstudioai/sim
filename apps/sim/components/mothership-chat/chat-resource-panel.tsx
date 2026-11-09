'use client'

import { lazy, type ReactNode, Suspense, useCallback } from 'react'
import { cn } from '@sim/emcn-legacy'
import { ChatPanelLayout } from '@/components/mothership-chat/chat-panel-layout'
import { useChatChrome } from '@/components/mothership-chat/chat-surface-context'
import { MothershipResourcesProvider } from '@/components/mothership-chat/mothership-resources-context'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import { useBrowserTabResources } from '@/hooks/mothership-chat/use-browser-tab-resources'
import type { useChat } from '@/hooks/mothership-chat/use-chat'
import type { useChatResourcePanel } from '@/hooks/mothership-chat/use-resource-panel'
import { useTerminalTabResources } from '@/hooks/mothership-chat/use-terminal-tab-resources'

const MothershipView = lazy(() =>
  import('@/components/mothership-chat/mothership-view/mothership-view').then((m) => ({
    default: m.MothershipView,
  }))
)

interface ChatResourcePanelProps {
  workspaceId?: string
  organizationId?: string
  allowBuildControls?: boolean
  chat: ReturnType<typeof useChat>
  panel: ReturnType<typeof useChatResourcePanel>
  children: ReactNode
  header?: ReactNode
  /** Leaves out the panel toggle while there is no resource to show and the panel is closed. */
  hideToggleUntilResource?: boolean
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
  header,
  hideToggleUntilResource = false,
  onSummarize,
}: ChatResourcePanelProps) {
  const { panelClassName } = useChatChrome()
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
      header={header}
      collapsed={isResourceCollapsed}
      label='resource view'
      activityCount={resourceActivityIds.size}
      toggleHidden={hideToggleUntilResource && isResourceCollapsed && resources.length === 0}
      onToggle={isResourceCollapsed ? expandResource : collapseResource}
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
              onSummarize={summarize}
              onUserInteraction={handleResourceInteraction}
              className={cn(skipResourceTransition && 'transition-none!', panelClassName)}
            />
          </Suspense>
        </MothershipResourcesProvider>
      }
    >
      {children}
    </ChatPanelLayout>
  )
}
