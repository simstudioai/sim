'use client'

import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import { ChatPanelLayout } from '@/app/workspace/[workspaceId]/home/components/chat-panel-layout'
import { MothershipResourcesProvider } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import type { ResourcePanelNavigation } from '@/app/workspace/[workspaceId]/home/components/resource-panel-navigation'
import { useBrowserTabResources } from '@/app/workspace/[workspaceId]/home/hooks/use-browser-tab-resources'
import type { useChat } from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import type { useChatResourcePanel } from '@/app/workspace/[workspaceId]/home/hooks/use-resource-panel'
import { useTerminalTabResources } from '@/app/workspace/[workspaceId]/home/hooks/use-terminal-tab-resources'

/** Matches the panel's width transition in `ChatPanelContent`. */
const PANEL_TRANSITION_MS = 200

/**
 * While expanded, the panel overlays the chat instead of displacing it, so neither side reflows
 * mid-animation. `reserve` keeps the chat at the width it has when the overlay settles.
 */
interface PanelOverlay {
  mode: 'expanded' | 'settling'
  reserve: number
}

/** The lazy panel takes no width until its chunk loads, so an unloaded panel reserves nothing. */
function measurePanelWidth(layout: HTMLElement | null): number {
  if (!layout) throw new Error('Chat panel layout is not mounted')
  return layout.querySelector<HTMLElement>('[data-mothership-panel]')?.offsetWidth ?? 0
}

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
  const layoutRef = useRef<HTMLDivElement>(null)
  const [overlay, setOverlay] = useState<PanelOverlay | null>(null)
  const settle = (reserve: number) => setOverlay({ mode: 'settling', reserve })
  useEffect(() => {
    if (chat.isSending)
      setOverlay((current) =>
        current?.mode === 'expanded' ? { mode: 'settling', reserve: current.reserve } : current
      )
  }, [chat.isSending])
  useEffect(() => {
    if (overlay?.mode !== 'settling') return
    const timer = setTimeout(() => setOverlay(null), PANEL_TRANSITION_MS)
    return () => clearTimeout(timer)
  }, [overlay])
  const isChatHidden = overlay?.mode === 'expanded'
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
      ref={layoutRef}
      collapsed={isResourceCollapsed}
      chatHidden={isChatHidden}
      chatReserve={overlay?.reserve}
      onToggleChat={
        navigation
          ? () => {
              if (overlay?.mode === 'expanded') settle(overlay.reserve)
              else
                setOverlay({
                  mode: 'expanded',
                  reserve: measurePanelWidth(layoutRef.current),
                })
            }
          : undefined
      }
      label='resource view'
      activityCount={resourceActivityIds.size}
      onToggle={() => {
        if (isResourceCollapsed) {
          expandResource()
          return
        }
        if (overlay) settle(0)
        collapseResource()
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
              onSummarize={summarize}
              onUserInteraction={handleResourceInteraction}
              className={cn(
                skipResourceTransition && 'transition-none!',
                overlay && 'absolute! inset-y-0 right-0',
                isChatHidden && 'w-full! min-w-0! border-l-0!'
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
