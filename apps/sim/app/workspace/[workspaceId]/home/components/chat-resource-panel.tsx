'use client'

import { lazy, type ReactNode, Suspense } from 'react'
import { Button, cn } from '@sim/emcn'
import { PanelLeft } from '@sim/emcn/icons'
import { MothershipResourcesProvider } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import { RESOURCE_HEADER_CLASSES } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'
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
}

/** Shared resizable resource chrome for workspace and organization chat. */
export function ChatResourcePanel({
  workspaceId,
  organizationId,
  chat,
  panel,
  children,
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
  const resourceActivityCount = resourceActivityIds.size
  const resourceToggleLabel = isResourceCollapsed
    ? resourceActivityCount > 0
      ? `Expand resource view, ${resourceActivityCount} resource${resourceActivityCount === 1 ? '' : 's'} updated`
      : 'Expand resource view'
    : 'Collapse resource view'

  return (
    <div
      className={cn('relative flex h-full min-h-0 bg-[var(--bg)]', RESOURCE_HEADER_CLASSES.layout)}
    >
      {children}
      {/* Resize handle — zero-width flex child whose absolute child straddles the border */}
      {!isResourceCollapsed && (
        <div className='relative z-20 w-0 flex-none'>
          <div
            className='absolute inset-y-0 left-[-4px] w-[8px] cursor-ew-resize'
            role='separator'
            aria-orientation='vertical'
            aria-label='Resize resource panel'
            onPointerDown={handleResourceResizePointerDown}
          />
        </div>
      )}

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
            onUserInteraction={handleResourceInteraction}
            className={skipResourceTransition ? 'transition-none!' : undefined}
          />
        </Suspense>
      </MothershipResourcesProvider>

      <div
        className={cn('z-30', RESOURCE_HEADER_CLASSES.overlay, RESOURCE_HEADER_CLASSES.endPosition)}
      >
        <Button
          variant='ghost'
          size={null}
          type='button'
          onClick={isResourceCollapsed ? expandResource : collapseResource}
          className="after:-translate-x-1/2 after:-translate-y-1/2 relative size-[var(--resource-header-toggle-size)] rounded-[8px] after:absolute after:top-1/2 after:left-1/2 after:size-[var(--resource-header-toggle-hit-size)] after:content-[''] hover-hover:bg-[var(--surface-active)]"
          aria-label={resourceToggleLabel}
        >
          <span className='relative'>
            <PanelLeft className='-scale-x-100 size-[16px] text-[var(--text-icon)]' />
            {isResourceCollapsed && resourceActivityIds.size > 0 && (
              <span
                aria-hidden='true'
                className='-top-0.5 -right-0.5 absolute size-1.5 rounded-full bg-[var(--brand-primary)]'
              />
            )}
          </span>
        </Button>
      </div>
    </div>
  )
}
