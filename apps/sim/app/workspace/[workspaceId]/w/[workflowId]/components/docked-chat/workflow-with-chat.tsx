'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Tooltip } from '@/components/emcn'
import { Workflow as WorkflowIcon, X } from '@/components/emcn/icons'
import { isMothershipPageId, MOTHERSHIP_PAGES } from '@/lib/copilot/resources/types'
import { cn } from '@/lib/core/utils/cn'
import {
  MothershipResourcesProvider,
  MothershipView,
} from '@/app/workspace/[workspaceId]/home/components'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import Workflow from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useMothershipTabsStore } from '@/stores/mothership-tabs/store'
import { useSidebarStore } from '@/stores/sidebar/store'
import { DockedChat } from './docked-chat'

/** Sentinel `?chat=` value for a docked chat that hasn't been created yet. */
const NEW_CHAT_PARAM = 'new'

/** Drag bounds for the docked chat pane. */
const CHAT_PANE = { MIN: 360, MAX_PERCENTAGE: 0.55 } as const

interface DockState {
  open: boolean
  chatId?: string
}

/**
 * The workflow route's shell: chat is the constant on the left, the editor
 * owns the stage on the right. Opening a chat never leaves the page — the
 * pane docks beside the canvas and the chat id rides in `?chat=` so refresh
 * and deep links restore the split.
 */
export function WorkflowWithChat() {
  const { workspaceId, workflowId } = useParams<{ workspaceId: string; workflowId: string }>()
  const searchParams = useSearchParams()
  const initialChatParam = searchParams.get('chat')

  const { data: workflows = [] } = useWorkflows(workspaceId)
  const workflowName = workflows.find((workflow) => workflow.id === workflowId)?.name ?? 'Workflow'

  const [dock, setDock] = useState<DockState>(() =>
    initialChatParam
      ? {
          open: true,
          chatId: initialChatParam === NEW_CHAT_PARAM ? undefined : initialChatParam,
        }
      : { open: false }
  )

  /** URL is a mirror, not a router concern — replaceState avoids remounts. */
  const reflectParam = useCallback((key: string, value: string | null) => {
    const url = new URL(window.location.href)
    if (value) url.searchParams.set(key, value)
    else url.searchParams.delete(key)
    window.history.replaceState(null, '', url.toString())
  }, [])

  /** The chat actually in the pane (server id once a new chat resolves). */
  const activeChatIdRef = useRef<string | undefined>(dock.chatId)

  const openChat = useCallback(
    (chatId?: string) => {
      setDock({ open: true, chatId })
      activeChatIdRef.current = chatId
      reflectParam('chat', chatId ?? NEW_CHAT_PARAM)
    },
    [reflectParam]
  )

  const closeChat = useCallback(() => {
    setDock({ open: false })
    reflectParam('chat', null)
  }, [reflectParam])

  /**
   * A new docked chat got its server id mid-conversation. Only the URL
   * updates — re-keying the pane here would remount the hook mid-stream.
   */
  const handleChatResolved = useCallback(
    (chatId: string) => {
      activeChatIdRef.current = chatId
      reflectParam('chat', chatId)
    },
    [reflectParam]
  )

  // ── Stage stack ──────────────────────────────────────────────────────────
  // Non-workflow resources never replace the editor: they slide in as a card
  // IN FRONT of it (toast-stack depth) with the workflow's identity bar
  // peeking above. The stack is a two-way flip — bringing the workflow
  // forward tucks the resource card into a small tab at the bottom edge, so
  // both stay one click apart. Only the card's × (or closing the last tab)
  // tears the stack down. Tabs are the same workspace-owned strip as
  // everywhere.
  const [stackOpen, setStackOpen] = useState<boolean>(() => Boolean(searchParams.get('resource')))
  const [stageFront, setStageFront] = useState<'card' | 'editor'>('card')
  const initialStageIdRef = useRef(searchParams.get('resource'))

  const workspaceTabs = useMothershipTabsStore((s) =>
    workspaceId ? s.byWorkspace[workspaceId] : undefined
  )
  const openTabs = useMothershipTabsStore((s) => s.openTabs)
  const closeTab = useMothershipTabsStore((s) => s.closeTab)
  const reorderTabs = useMothershipTabsStore((s) => s.reorderTabs)
  const setActiveTab = useMothershipTabsStore((s) => s.setActiveTab)
  const stageTabs = useMemo(
    () => (workspaceTabs?.tabs ?? []).filter((tab) => tab.type !== 'workflow'),
    [workspaceTabs]
  )
  const stageActiveId = workspaceTabs?.activeTabId ?? null
  const activeStageTab = stageTabs.find((tab) => tab.id === stageActiveId) ?? stageTabs[0]

  const stageResource = useCallback(
    (resource: MothershipResource) => {
      if (!workspaceId) return
      openTabs(workspaceId, [resource], { focusId: resource.id })
      setStackOpen(true)
      setStageFront('card')
      reflectParam('resource', resource.id)
    },
    [openTabs, workspaceId, reflectParam]
  )

  const collapseStack = useCallback(() => {
    setStackOpen(false)
    setStageFront('card')
    reflectParam('resource', null)
  }, [reflectParam])

  /**
   * Deep-link restore: focus the URL-pinned tab if the strip still has it.
   * The tabs store rehydrates asynchronously, so wait for hydration before
   * deciding the tab doesn't exist.
   */
  useEffect(() => {
    const id = initialStageIdRef.current
    if (!id || !workspaceId) return
    const apply = () => {
      initialStageIdRef.current = null
      const tabs = useMothershipTabsStore.getState().byWorkspace[workspaceId]?.tabs ?? []
      if (tabs.some((tab) => tab.id === id)) {
        setActiveTab(workspaceId, id)
        return
      }
      // The strip doesn't have it, but page ids are self-describing — a deep
      // link to a workspace page reconstructs its tab instead of collapsing.
      if (isMothershipPageId(id)) {
        openTabs(workspaceId, [{ type: 'page', id, title: MOTHERSHIP_PAGES[id] }], {
          focusId: id,
        })
        return
      }
      // Nothing stageable behind the link — close immediately rather than
      // showing an empty card (the auto-collapse effect won't re-run here,
      // since clearing the pending ref changes none of its deps).
      collapseStack()
    }
    if (useMothershipTabsStore.persist.hasHydrated()) {
      apply()
      return
    }
    return useMothershipTabsStore.persist.onFinishHydration(apply)
  }, [workspaceId, setActiveTab, openTabs, collapseStack])

  /** Escape flips the editor forward (the stack stays one click away). */
  useEffect(() => {
    if (!stackOpen || stageFront !== 'card') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setStageFront('editor')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [stackOpen, stageFront])

  /**
   * Closing the last tab leaves nothing to show — the editor comes forward.
   * Reads the live store (the render closure lags one commit behind the
   * deep-link restore) and stays out until hydration and restore both ran,
   * since the strip is transiently empty before them.
   */
  useEffect(() => {
    if (!stackOpen || stageTabs.length > 0) return
    if (!workspaceId) return
    if (!useMothershipTabsStore.persist.hasHydrated()) return
    if (initialStageIdRef.current) return
    const live = useMothershipTabsStore.getState().byWorkspace[workspaceId]?.tabs ?? []
    if (live.some((tab) => tab.type !== 'workflow')) return
    collapseStack()
  }, [stackOpen, stageTabs, collapseStack, workspaceId])

  const selectStageTab = useCallback(
    (id: string) => {
      if (workspaceId) setActiveTab(workspaceId, id)
    },
    [setActiveTab, workspaceId]
  )

  const addStageTab = useCallback(
    (resource: MothershipResource) => {
      if (resource.type === 'workflow') return
      stageResource(resource)
    },
    [stageResource]
  )

  const removeStageTab = useCallback(
    (resourceType: MothershipResourceType, resourceId: string) => {
      if (workspaceId) closeTab(workspaceId, resourceType, resourceId)
    },
    [closeTab, workspaceId]
  )

  const reorderStageTabs = useCallback(
    (tabs: MothershipResource[]) => {
      if (workspaceId) reorderTabs(workspaceId, tabs)
    },
    [reorderTabs, workspaceId]
  )

  // Divider drag mirrors useMothershipResize (imperative width, pointer
  // capture, zero re-renders) but measures from the pane's LEFT edge — this
  // pane leads the row instead of trailing it.
  const chatPaneRef = useRef<HTMLDivElement | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)

  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const el = chatPaneRef.current
    if (!el) return

    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    el.style.width = `${el.getBoundingClientRect().width}px`
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    const ac = new AbortController()
    const { signal } = ac
    const cleanup = () => {
      ac.abort()
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      dragCleanupRef.current = null
    }
    dragCleanupRef.current = cleanup

    handle.addEventListener(
      'pointermove',
      (moveEvent: PointerEvent) => {
        const newWidth = moveEvent.clientX - el.getBoundingClientRect().left
        const maxWidth = window.innerWidth * CHAT_PANE.MAX_PERCENTAGE
        el.style.width = `${Math.min(Math.max(newWidth, CHAT_PANE.MIN), maxWidth)}px`
      },
      { signal }
    )
    handle.addEventListener(
      'pointerup',
      (upEvent: PointerEvent) => {
        handle.releasePointerCapture(upEvent.pointerId)
        cleanup()
      },
      { signal }
    )
    handle.addEventListener('pointercancel', cleanup, { signal })
  }, [])

  useEffect(() => () => dragCleanupRef.current?.(), [])

  useEffect(() => {
    const handleWindowResize = () => {
      const el = chatPaneRef.current
      if (!el || !el.style.width) return
      const maxWidth = window.innerWidth * CHAT_PANE.MAX_PERCENTAGE
      if (el.getBoundingClientRect().width > maxWidth) {
        el.style.width = `${maxWidth}px`
      }
    }
    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [])

  // While the stack exists — either side forward — the stage stops being a
  // panel: everything floats as detached modules on the workspace chrome
  // backdrop, chat included. Flipping only changes which card is in front.
  const isStackMode = stackOpen
  const isEditorCard = stackOpen && stageFront === 'editor'

  // The workspace chrome drops its content card frame while modules float.
  // Layout effect: the frame must flip in the same paint as the cards, never
  // a frame behind them (visible as a flash during load).
  const setStageFloating = useSidebarStore((s) => s.setStageFloating)
  useLayoutEffect(() => {
    setStageFloating(isStackMode)
    return () => setStageFloating(false)
  }, [isStackMode, setStageFloating])

  if (!workspaceId || !workflowId) return null

  return (
    <div className={cn('flex h-full w-full', isStackMode && 'bg-[var(--surface-1)]')}>
      {dock.open && (
        <>
          <div
            ref={chatPaneRef}
            className={cn(
              'flex w-[clamp(360px,34%,520px)] flex-shrink-0 flex-col',
              isStackMode
                ? 'my-2 ml-2 h-[calc(100%-16px)] overflow-hidden rounded-xl border border-[var(--border-1)] bg-[var(--bg)] shadow-sm'
                : 'h-full border-[var(--border)] border-r'
            )}
          >
            <DockedChat
              key={dock.chatId ?? 'new'}
              workspaceId={workspaceId}
              workflowId={workflowId}
              chatId={dock.chatId}
              onClose={closeChat}
              onSelectChat={openChat}
              onChatResolved={handleChatResolved}
              onStageResource={stageResource}
            />
          </div>
          {/* Zero-width flex child whose absolute child straddles the border.
              A small grab pill fades in on hover so the affordance is
              discoverable without adding a permanent line. */}
          <div className='relative z-20 w-0 flex-none'>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <div
                  className='group absolute inset-y-0 left-[-4px] flex w-[8px] cursor-ew-resize items-center justify-center'
                  role='separator'
                  aria-orientation='vertical'
                  aria-label='Resize chat pane'
                  onPointerDown={handleResizePointerDown}
                >
                  <div className='h-[48px] w-[4px] rounded-full bg-[var(--text-subtle)] opacity-0 transition-opacity hover-hover:group-hover:opacity-100' />
                </div>
              </Tooltip.Trigger>
              <Tooltip.Content side='right'>
                <p>Resize</p>
              </Tooltip.Content>
            </Tooltip.Root>
          </div>
        </>
      )}
      <div className='relative h-full min-w-0 flex-1'>
        {/* When the editor is the front of the stack, the resource pane peeks
            behind it as the same slim identity bar the workflow shows on the
            other side of the flip. Rendered before the card so the card
            paints over its lower half. */}
        {isEditorCard && activeStageTab && (
          <button
            type='button'
            aria-label='Show resources'
            onClick={() => setStageFront('card')}
            className='absolute inset-x-4 top-2 z-0 flex h-[38px] items-start rounded-t-xl border border-[var(--border-1)] bg-[var(--bg)] px-3 transition-colors hover-hover:bg-[var(--surface-active)]'
          >
            <span className='flex h-[26px] min-w-0 items-center gap-1.5'>
              {getResourceConfig(activeStageTab.type).renderTabIcon(
                activeStageTab,
                'size-[12px] flex-shrink-0 text-[var(--text-icon)]'
              )}
              <span className='truncate font-medium text-[12px] text-[var(--text-body)]'>
                {activeStageTab.title}
              </span>
              {stageTabs.length > 1 && (
                <span className='text-[11px] text-[var(--text-muted)]'>
                  +{stageTabs.length - 1}
                </span>
              )}
            </span>
          </button>
        )}
        {/* Editor card chrome when it's the front of the stack. The wrappers
            are permanent (classes toggle) so the editor never remounts
            across flips. */}
        <div className={cn('h-full w-full', isEditorCard && 'px-2 pt-[32px] pb-2')}>
          <div
            className={cn(
              'relative h-full w-full',
              isEditorCard &&
                'overflow-hidden rounded-xl border border-[var(--border-1)] bg-[var(--bg)] shadow-sm'
            )}
          >
            <Workflow
              workspaceId={workspaceId}
              workflowId={workflowId}
              chatDock={{ isOpen: dock.open, onSelectChat: openChat }}
            />
          </div>
        </div>
        {stackOpen && stageFront === 'card' && (
          <>
            {/* Opaque stage backdrop in the chrome's own color: the editor
                stays mounted and live underneath, but the stage reads as
                workspace space holding two floating cards — not a panel. */}
            <div aria-hidden='true' className='absolute inset-0 z-30 bg-[var(--surface-1)]' />
            {/* The back card: a slim bar with just the workflow icon + name,
                peeking above the front card (toast-stack depth). Narrower
                than the front so it reads as behind; clicking it brings the
                workflow forward. */}
            <button
              type='button'
              aria-label='Back to workflow'
              onClick={() => setStageFront('editor')}
              className='absolute inset-x-4 top-2 z-30 flex h-[38px] items-start rounded-t-xl border border-[var(--border-1)] bg-[var(--bg)] px-3 transition-colors hover-hover:bg-[var(--surface-active)]'
            >
              <span className='flex h-[26px] min-w-0 items-center gap-1.5'>
                <WorkflowIcon className='size-[12px] flex-shrink-0 text-[var(--text-icon)]' />
                <span className='truncate font-medium text-[12px] text-[var(--text-body)]'>
                  {workflowName}
                </span>
              </span>
            </button>
            {/* The front card: the workspace resource tabs + active content,
                a fully detached rounded pane over the back card. */}
            <div className='absolute inset-x-2 top-[32px] bottom-2 z-30 flex animate-slide-in-bottom flex-col overflow-hidden rounded-xl border border-[var(--border-1)] bg-[var(--bg)] shadow-sm'>
              <MothershipResourcesProvider
                selectResource={selectStageTab}
                addResource={addStageTab}
                removeResource={removeStageTab}
                reorderResources={reorderStageTabs}
                collapseResource={collapseStack}
              >
                <MothershipView
                  workspaceId={workspaceId}
                  chatId={activeChatIdRef.current}
                  resources={stageTabs}
                  activeResourceId={stageActiveId}
                  isCollapsed={false}
                  className='h-full w-full border-l-0'
                />
              </MothershipResourcesProvider>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    type='button'
                    onClick={collapseStack}
                    aria-label='Close resource view'
                    className='absolute top-[7px] right-[9px] z-20 flex size-[30px] flex-shrink-0 items-center justify-center rounded-lg transition-colors hover-hover:bg-[var(--surface-active)]'
                  >
                    <X className='size-[14px] text-[var(--text-icon)]' />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Content side='bottom'>
                  <p>Close resources</p>
                </Tooltip.Content>
              </Tooltip.Root>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
