import {
  type ComponentProps,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Button,
  cn,
  TabStrip,
  type TabStripDragContext,
  type TabStripItem,
  type TabStripSelectionSource,
  Tooltip,
  tabStripItemSelector,
  toast,
} from '@sim/emcn'
import { Columns3, Eye, Pencil } from '@sim/emcn/icons'
import { describeRunningCommand, type TerminalTabState } from '@sim/terminal-protocol'
import { browserTabTitle } from '@/lib/browser-agent/tab-label'
import {
  openBrowserTab,
  reorderBrowserTab,
  sendBrowserPanelAction,
} from '@/lib/browser-agent/transport'
import { SIM_RESOURCE_DRAG_TYPE, SIM_RESOURCES_DRAG_TYPE } from '@/lib/copilot/resource-types'
import { isEphemeralResource } from '@/lib/copilot/resources/types'
import { requestTerminalFocus } from '@/lib/terminal/focus'
import { terminalIdFromResourceId, terminalResourceId } from '@/lib/terminal/resource-id'
import { terminalTabTitle, terminalTooltip } from '@/lib/terminal/tab-label'
import { closeTerminal, openTerminal, reorderTerminal } from '@/lib/terminal/transport'
import type { PreviewMode } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { useMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import { AddResourceDropdown } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import {
  RESOURCE_HEADER_CLASSES,
  RESOURCE_TAB_ICON_BUTTON_CLASS,
  RESOURCE_TAB_ICON_CLASS,
  resourceTabWidthClass,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import { useFolders } from '@/hooks/queries/folders'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import {
  useAddChatResource,
  useRemoveChatResource,
  useReorderChatResources,
} from '@/hooks/queries/mothership-chats'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useSettledTerminalCommands } from '@/hooks/use-settled-terminal-commands'
import { useBrowserSessionStore } from '@/stores/browser-session/store'
import { useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

/**
 * Types that cannot be opened as a resource tab. Folders and chats have no tab
 * surface; integrations are `@`-mention-only (see `MENTION_ONLY_RESOURCE_TYPES`
 * in `plus-menu-dropdown`), so they are never offered here.
 *
 * Module-scope by contract — `useAvailableResources` keys its group memo on this.
 */
const ADD_RESOURCE_EXCLUDED_TYPES: readonly MothershipResourceType[] = [
  'folder',
  'task',
  'integration',
] as const

const EMPTY_TERMINAL_TABS: TerminalTabState[] = []

/** Closing a shell mid-command stops that command, so the user confirms first. */
function confirmClosingRunningTerminals(
  targets: readonly MothershipResource[],
  terminalTabs: readonly TerminalTabState[]
): boolean {
  const running = targets.flatMap((resource) => {
    if (resource.type !== 'terminal') return []
    const tab = terminalTabs.find((entry) => terminalResourceId(entry.terminalId) === resource.id)
    return tab?.running ? [tab.running] : []
  })
  if (running.length === 0) return true
  return window.confirm(
    running.length === 1
      ? `${describeRunningCommand(running[0])} is still running. Close this terminal and stop it?`
      : `${running.length} selected terminals have a running process. Close them anyway?`
  )
}

/**
 * Returns the id of the nearest resource to `idx` that is in `filter`
 * (or any resource if `filter` is null). Returns undefined if nothing qualifies.
 */
function findNearestId(
  resources: MothershipResource[],
  idx: number,
  filter: Set<string> | null
): string | undefined {
  for (let offset = 1; offset < resources.length; offset++) {
    for (const candidate of [idx + offset, idx - offset]) {
      const r = resources[candidate]
      if (r && (!filter || filter.has(r.id))) return r.id
    }
  }
  return undefined
}

/**
 * Builds an offscreen drag image showing all selected tabs side-by-side, so the
 * cursor visibly carries every tab in the multi-selection. The element is
 * appended to the document and removed on the next tick after the browser has
 * snapshotted it.
 */
function buildMultiDragImage(
  tabList: Element | null,
  selected: MothershipResource[]
): HTMLElement | null {
  if (!tabList || selected.length === 0) return null
  const container = document.createElement('div')
  Object.assign(container.style, {
    position: 'fixed',
    top: '-10000px',
    left: '-10000px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px',
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>)
  let appendedAny = false
  for (const r of selected) {
    const original = tabList.querySelector<HTMLElement>(tabStripItemSelector(r.id))
    if (!original) continue
    const clone = original.cloneNode(true) as HTMLElement
    clone.style.opacity = '0.95'
    container.appendChild(clone)
    appendedAny = true
  }
  if (!appendedAny) return null
  document.body.appendChild(container)
  return container
}

const PREVIEW_MODE_ICONS = {
  editor: Columns3,
  split: Eye,
  preview: Pencil,
} satisfies Record<PreviewMode, (props: ComponentProps<typeof Eye>) => ReactNode>

const PREVIEW_MODE_LABELS: Record<PreviewMode, string> = {
  editor: 'Split Mode',
  split: 'Preview Mode',
  preview: 'Edit Mode',
}

/**
 * Stable identity for the empty lookup across `enabled` toggles. The tab list
 * memo below takes this map as a dependency, so a fresh empty map each time
 * `enabled` flips would rebuild every tab for no change in what they say.
 */
const NO_RESOURCE_NAMES = new Map<string, string>()

/**
 * Builds a `type:id` -> current name lookup from live query data so resource
 * tabs always reflect the latest name even after a rename. Skipped entirely
 * when there are no tabs to label — a chat with no open resources must not
 * fetch five workspace-wide lists.
 */
function useResourceNameLookup(workspaceId: string, enabled: boolean): Map<string, string> {
  const { data: workflows } = useWorkflows(workspaceId, { enabled })
  const { data: tables } = useTablesList(workspaceId, 'active', { enabled })
  const { data: files } = useWorkspaceFiles(workspaceId, 'active', { enabled })
  const { data: knowledgeBases } = useKnowledgeBasesQuery(workspaceId, { enabled })
  const { data: folders } = useFolders(workspaceId, { enabled })

  return useMemo(() => {
    if (!enabled) return NO_RESOURCE_NAMES
    const map = new Map<string, string>()
    for (const w of workflows ?? []) map.set(`workflow:${w.id}`, w.name)
    for (const t of tables ?? []) map.set(`table:${t.id}`, t.name)
    for (const f of files ?? []) map.set(`file:${f.id}`, f.name)
    for (const kb of knowledgeBases ?? []) map.set(`knowledgebase:${kb.id}`, kb.name)
    for (const folder of folders ?? []) map.set(`folder:${folder.id}`, folder.name)
    return map
  }, [enabled, workflows, tables, files, knowledgeBases, folders])
}

interface ResourceTabsProps {
  workspaceId: string
  desktopScopeId: string
  chatId?: string
  resources: MothershipResource[]
  activeId: string | null
  activityIds?: ReadonlySet<string>
  previewMode?: PreviewMode
  onCyclePreviewMode?: () => void
  actions?: ReactNode
  onRequestAddResourceOpen?: (open: () => void) => void
  onAddResourceClose?: () => Promise<void>
}

/**
 * The resource panel's tab strip: the shared {@link TabStrip} plus the three
 * things only this surface has — a multi-tab selection that drags into the chat
 * as context, an add control that is a resource picker rather than a plain
 * button, and the active resource's own actions trailing the row. Everything
 * else — fixed tab widths, clipped-title tooltips, the scroll-edge fades,
 * keyboard navigation, drag reordering — comes from the strip, which is the same
 * component the browser and terminal panels nested inside this one use.
 */
export function ResourceTabs({
  workspaceId,
  desktopScopeId,
  chatId,
  resources,
  activeId,
  activityIds,
  previewMode,
  onCyclePreviewMode,
  actions,
  onRequestAddResourceOpen,
  onAddResourceClose,
}: ResourceTabsProps) {
  const PreviewModeIcon = PREVIEW_MODE_ICONS[previewMode ?? 'split']
  const nameLookup = useResourceNameLookup(workspaceId, resources.length > 0)
  const {
    selectResource,
    addResource: onAddResource,
    removeResource: onRemoveResource,
    reorderResources: onReorderResources,
  } = useMothershipResources()

  const addResource = useAddChatResource(chatId)
  const removeResource = useRemoveChatResource(chatId)
  const reorderResources = useReorderChatResources(chatId)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const anchorIdRef = useRef<string | null>(null)
  const prevChatIdRef = useRef(chatId)
  // The drag image lives on `document.body` rather than in the React tree,
  // because `setDragImage` snapshots a real, laid-out element. Holding it lets
  // a drag whose source tab unmounts mid-gesture still be cleaned up.
  const dragImageRef = useRef<HTMLElement | null>(null)

  useEffect(
    () => () => {
      dragImageRef.current?.remove()
      dragImageRef.current = null
    },
    []
  )

  // Reset selection when switching chats — component instance persists across
  // chat switches so stale IDs would otherwise carry over.
  if (prevChatIdRef.current !== chatId) {
    prevChatIdRef.current = chatId
    setSelectedIds(new Set())
    anchorIdRef.current = null
  }

  // Browser and terminal tab titles are live page and shell state, owned by
  // the desktop app; a terminal is named after its settled foreground program.
  const browserTabs = useBrowserSessionStore((state) => state.sessions[desktopScopeId]?.tabs)
  const terminalTabs = useCopilotTerminalStore(
    (state) => state.sessions[desktopScopeId]?.tabs.tabs ?? EMPTY_TERMINAL_TABS
  )
  const settledCommands = useSettledTerminalCommands(terminalTabs)

  const tabs = useMemo<TabStripItem[]>(() => {
    const browserTitles = new Map(browserTabs?.map((tab) => [tab.tabId, browserTabTitle(tab)]))
    const terminalsById = new Map(
      terminalTabs.map((tab) => [terminalResourceId(tab.terminalId), tab])
    )
    return resources.map((resource) => {
      const terminal = resource.type === 'terminal' ? terminalsById.get(resource.id) : undefined
      return {
        id: resource.id,
        title:
          (resource.type === 'browser'
            ? browserTitles.get(resource.id)
            : terminal
              ? terminalTabTitle(terminal, settledCommands)
              : nameLookup.get(`${resource.type}:${resource.id}`)) ?? resource.title,
        // A shell's label is a basename, and it may be running something it is
        // not naming yet, so hovering identifies the directory and program.
        ...(terminal ? { tooltip: terminalTooltip(terminal) } : {}),
        icon: getResourceConfig(resource.type).renderTabIcon(
          resource,
          'size-[16px] shrink-0',
          desktopScopeId
        ),
        active: activeId === resource.id,
        selected: selectedIds.size > 1 && selectedIds.has(resource.id),
        attention: activityIds?.has(resource.id) ?? false,
      }
    })
  }, [
    resources,
    nameLookup,
    browserTabs,
    terminalTabs,
    settledCommands,
    desktopScopeId,
    activeId,
    selectedIds,
    activityIds,
  ])

  const handleAdd = useCallback(
    (resource: MothershipResource) => {
      // A browser tab or terminal is a live page or shell the desktop app
      // creates; it joins the strip through the tab list rather than as a
      // resource of its own.
      if (resource.type === 'browser') {
        void openBrowserTab(desktopScopeId)
          .then((state) => {
            if (state?.activeTabId) selectResource(state.activeTabId)
          })
          .catch(() => toast.error('Could not open a new browser tab. Please try again.'))
        return
      }
      if (resource.type === 'terminal') {
        void openTerminal(undefined, desktopScopeId)
          .then((state) => {
            if (!state.activeTerminalId) return
            selectResource(terminalResourceId(state.activeTerminalId))
            requestTerminalFocus(state.activeTerminalId)
          })
          .catch(() => toast.error('Could not open a new terminal. Please try again.'))
        return
      }
      // Opening a resource before the first message is sent is allowed: there
      // is simply no chat to attach it to yet. `onAddResource` queues it and
      // persists once the chat exists, so only the server call is conditional.
      // Synthetic result/preview panels are in-memory only either way.
      if (chatId && !isEphemeralResource(resource)) {
        addResource.mutate({ chatId, resource })
      }
      onAddResource(resource)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatId, desktopScopeId, onAddResource, selectResource]
  )

  const handleSelect = useCallback(
    (id: string, source?: TabStripSelectionSource, e?: ReactMouseEvent<HTMLButtonElement>) => {
      const idx = resources.findIndex((r) => r.id === id)
      const resource = resources[idx]
      if (!resource) return

      // Shift+click: contiguous range from anchor
      if (e?.shiftKey) {
        // Fall back to activeId when no explicit anchor exists (e.g. tab opened via sidebar)
        const anchorId = anchorIdRef.current ?? activeId
        const anchorIdx = anchorId ? resources.findIndex((r) => r.id === anchorId) : -1
        if (anchorIdx !== -1) {
          const start = Math.min(anchorIdx, idx)
          const end = Math.max(anchorIdx, idx)
          const next = new Set<string>()
          for (let i = start; i <= end; i++) next.add(resources[i].id)
          setSelectedIds(next)
          selectResource(resource.id)
          return
        }
      }

      // Cmd/Ctrl+click: toggle individual tab in/out of selection
      if (e?.metaKey || e?.ctrlKey) {
        const wasSelected = selectedIds.has(resource.id)
        if (wasSelected) {
          const next = new Set(selectedIds)
          next.delete(resource.id)
          setSelectedIds(next)
          // Only switch active if we just deselected the currently-active tab
          if (activeId === resource.id) {
            const fallback =
              findNearestId(resources, idx, next) ?? findNearestId(resources, idx, null)
            if (fallback) selectResource(fallback)
          }
        } else {
          setSelectedIds((prev) => new Set(prev).add(resource.id))
          selectResource(resource.id)
        }
        if (!anchorIdRef.current) anchorIdRef.current = resource.id
        return
      }

      // Plain click: single-select
      anchorIdRef.current = resource.id
      setSelectedIds(new Set([resource.id]))
      selectResource(resource.id)
      // A pointer pick of a shell also hands it the keyboard; arrow-key
      // navigation along the strip keeps its own focus.
      if (resource.type === 'terminal' && source !== 'keyboard') {
        requestTerminalFocus(terminalIdFromResourceId(resource.id))
      }
    },
    [resources, selectResource, selectedIds, activeId]
  )

  const handleClose = useCallback(
    (id: string) => {
      const resource = resources.find((r) => r.id === id)
      if (!resource) return
      const isMulti = selectedIds.has(resource.id) && selectedIds.size > 1
      const targets = isMulti ? resources.filter((r) => selectedIds.has(r.id)) : [resource]
      if (!confirmClosingRunningTerminals(targets, terminalTabs)) return
      // A browser tab's page is closed natively and its resource dropped at
      // once; the tab list then confirms the removal. A shell's close answers
      // with the tab list, so its resource follows that list instead — a
      // close the desktop app refuses must not leave a running shell with no
      // tab.
      for (const r of targets) {
        if (r.type === 'terminal') {
          void closeTerminal(terminalIdFromResourceId(r.id), desktopScopeId).catch(() =>
            toast.error('Could not close that terminal. Please try again.')
          )
          continue
        }
        onRemoveResource(r.type, r.id)
        if (r.type === 'browser') {
          sendBrowserPanelAction('close-tab', { tabId: r.id }, desktopScopeId)
        }
      }
      // Clear stale selection and anchor for all removed targets
      const removedIds = new Set(targets.map((r) => r.id))
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const removedId of removedIds) next.delete(removedId)
        return next
      })
      if (anchorIdRef.current && removedIds.has(anchorIdRef.current)) {
        anchorIdRef.current = null
      }
      // Mirrors `handleAdd`: a resource opened while composing the first prompt
      // has to be closable before there is a chat to attach it to. Only the
      // server call is conditional — the local removal above also drops the
      // queued write, so nothing resurrects it once the chat exists.
      if (!chatId) return
      for (const r of targets) {
        if (isEphemeralResource(r)) continue
        removeResource.mutate({ chatId, resourceType: r.type, resourceId: r.id })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatId, desktopScopeId, onRemoveResource, resources, selectedIds, terminalTabs]
  )

  /**
   * The strip's own title for a resource: a browser tab's live page title, a
   * terminal's settled program or directory.
   */
  const withStripTitle = useCallback(
    (resource: MothershipResource): MothershipResource => {
      const title = tabs.find((tab) => tab.id === resource.id)?.title
      return title && title !== resource.title ? { ...resource, title } : resource
    },
    [tabs]
  )

  const handleTabDragStart = useCallback(
    (e: ReactDragEvent<HTMLDivElement>, id: string, drag: TabStripDragContext) => {
      const resource = resources.find((r) => r.id === id)
      if (!resource) return
      const selected = resources.filter((r) => selectedIds.has(r.id)).map(withStripTitle)
      const isMultiDrag = selected.length > 1 && selectedIds.has(resource.id)
      if (isMultiDrag) {
        e.dataTransfer.effectAllowed = 'copy'
        e.dataTransfer.setData(SIM_RESOURCES_DRAG_TYPE, JSON.stringify(selected))
        const dragImage = buildMultiDragImage(e.currentTarget.closest('[role="tablist"]'), selected)
        if (dragImage) {
          e.dataTransfer.setDragImage(dragImage, 16, 16)
          dragImageRef.current = dragImage
          setTimeout(() => {
            dragImage.remove()
            if (dragImageRef.current === dragImage) dragImageRef.current = null
          }, 0)
        }
        // This gesture carries the whole selection out to the chat, so it is not
        // a reorder; the strip drops its drag tracking rather than showing a
        // drop indicator for a move that will never happen.
        drag.preventReorder()
        return
      }
      // `copyMove` because the strip already set `move` for its own reordering,
      // and a drop target asking for `copy` is refused outright unless copying
      // is allowed too.
      e.dataTransfer.effectAllowed = 'copyMove'
      const { type, id: resourceId, title } = withStripTitle(resource)
      e.dataTransfer.setData(
        SIM_RESOURCE_DRAG_TYPE,
        JSON.stringify({ type, id: resourceId, title })
      )
    },
    [resources, selectedIds, withStripTitle]
  )

  const handleReorder = useCallback(
    (id: string, targetIndex: number) => {
      const fromIndex = resources.findIndex((r) => r.id === id)
      if (fromIndex < 0 || fromIndex === targetIndex) return
      const reordered = [...resources]
      const [moved] = reordered.splice(fromIndex, 1)
      reordered.splice(targetIndex, 0, moved)
      onReorderResources(reordered)
      // Browser tabs and terminals are not stored with the chat; their order
      // lives in the desktop's native lists, which restore and the agent read
      // back.
      const nativeIndex = () => reordered.filter((r) => r.type === moved.type).indexOf(moved)
      if (moved.type === 'browser') {
        reorderBrowserTab(moved.id, nativeIndex(), desktopScopeId)
      } else if (moved.type === 'terminal') {
        void reorderTerminal(
          terminalIdFromResourceId(moved.id),
          nativeIndex(),
          desktopScopeId
        ).catch(() => toast.error('Could not reorder that terminal. Please try again.'))
      }
      if (chatId) {
        const persistable = reordered.filter((r) => !isEphemeralResource(r))
        if (persistable.length > 0) {
          reorderResources.mutate({ chatId, resources: persistable })
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatId, desktopScopeId, resources, onReorderResources]
  )

  const previewToggle =
    previewMode && onCyclePreviewMode ? (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant='subtle'
            onClick={onCyclePreviewMode}
            className={RESOURCE_TAB_ICON_BUTTON_CLASS}
            aria-label='Cycle preview mode'
          >
            <PreviewModeIcon mode={previewMode} className={RESOURCE_TAB_ICON_CLASS} />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>{PREVIEW_MODE_LABELS[previewMode]}</p>
        </Tooltip.Content>
      </Tooltip.Root>
    ) : null

  return (
    <TabStrip
      tabs={tabs}
      onSelect={handleSelect}
      onClose={handleClose}
      onReorder={handleReorder}
      onTabDragStart={handleTabDragStart}
      variant='floating'
      className={cn(RESOURCE_HEADER_CLASSES.stripGeometry, resourceTabWidthClass(resources.length))}
      newTabControl={
        // Offered before the chat exists too: a resource opened while composing
        // the first prompt is context for that prompt, and gating on a chat id
        // meant the panel could be opened but not filled.
        <div className={cn(resources.length === 0 && RESOURCE_HEADER_CLASSES.emptyAddOffset)}>
          <AddResourceDropdown
            workspaceId={workspaceId}
            onAdd={handleAdd}
            excludeTypes={ADD_RESOURCE_EXCLUDED_TYPES}
            onRequestOpen={onRequestAddResourceOpen}
            onClose={onAddResourceClose}
          />
        </div>
      }
      // A bare fragment is always truthy, so the empty case has to be `null` or
      // the strip renders an empty trailing cluster.
      endActions={
        actions || previewToggle ? (
          <>
            {actions}
            {previewToggle}
          </>
        ) : null
      }
    />
  )
}
