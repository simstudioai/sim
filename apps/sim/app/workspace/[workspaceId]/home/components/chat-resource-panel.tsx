'use client'

import { type ComponentType, lazy, type ReactNode, Suspense, useCallback } from 'react'
import { cn } from '@sim/emcn'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import type { ShareDialogProps } from '@/app/workspace/[workspaceId]/files/components/share-modal'
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
  header?: ReactNode
  /** Leaves out the panel toggle while there is no resource to show and the panel is closed. */
  hideToggleUntilResource?: boolean
  onSummarize?: (message: string, filters: WorkspaceSearchFilters) => void
  panelClassName?: string
  tabsClassName?: string
  sourcesClassName?: string
  ShareDialogComponent?: ComponentType<ShareDialogProps>
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
  panelClassName,
  tabsClassName,
  sourcesClassName,
  ShareDialogComponent,
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
              tabsClassName={tabsClassName}
              sourcesClassName={sourcesClassName}
              ShareDialogComponent={ShareDialogComponent}
            />
          </Suspense>
        </MothershipResourcesProvider>
      }
    >
      {children}
    </ChatPanelLayout>
  )
}
