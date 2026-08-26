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
} from '@sim/emcn'
import { Columns3, Eye, Pencil } from '@sim/emcn/icons'
import { sendBrowserPanelAction } from '@/lib/browser-agent/transport'
import { SIM_RESOURCE_DRAG_TYPE, SIM_RESOURCES_DRAG_TYPE } from '@/lib/copilot/resource-types'
import { openTerminal } from '@/lib/terminal/transport'
import type { PreviewMode } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { useMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import { AddResourceDropdown } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import {
  RESOURCE_HEADER_CLASSES,
  RESOURCE_TAB_ICON_BUTTON_CLASS,
  RESOURCE_TAB_ICON_CLASS,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import { useCustomTools } from '@/hooks/queries/custom-tools'
import { useFolders } from '@/hooks/queries/folders'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useMcpServers } from '@/hooks/queries/mcp'
import { useSkills } from '@/hooks/queries/skills'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

/** Opens another inner tab when a singleton desktop resource already exists. */
export function openExistingResourceTab(
  resource: MothershipResource,
  desktopScopeId: string,
  selectResource: (id: string) => void
): void {
  selectResource(resource.id)
  if (resource.type === 'browser') {
    sendBrowserPanelAction('new-tab', {}, desktopScopeId)
  } else if (resource.type === 'terminal') {
    void openTerminal(undefined, desktopScopeId)
  }
}

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
 * Builds a `type:id` -> current name lookup from live query data so resource
 * tabs always reflect the latest name even after a rename. Each query is enabled
 * only when that resource family has an open tab.
 */
function useResourceNameLookup(
  workspaceId: string,
  openTypes: ReadonlySet<MothershipResourceType>
): Map<string, string> {
  const workflowsEnabled = openTypes.has('workflow')
  const tablesEnabled = openTypes.has('table')
  const filesEnabled = openTypes.has('file')
  const knowledgeBasesEnabled = openTypes.has('knowledgebase')
  const foldersEnabled = openTypes.has('folder')
  const skillsEnabled = openTypes.has('skill')
  const customToolsEnabled = openTypes.has('custom_tool')
  const mcpServersEnabled = openTypes.has('mcp_server')
  const { data: workflows } = useWorkflows(workspaceId, { enabled: workflowsEnabled })
  const { data: tables } = useTablesList(workspaceId, 'active', { enabled: tablesEnabled })
  const { data: files } = useWorkspaceFiles(workspaceId, 'active', { enabled: filesEnabled })
  const { data: knowledgeBases } = useKnowledgeBasesQuery(workspaceId, {
    enabled: knowledgeBasesEnabled,
  })
  const { data: folders } = useFolders(workspaceId, { enabled: foldersEnabled })
  const { data: skills } = useSkills(workspaceId, { enabled: skillsEnabled })
  const { data: customTools } = useCustomTools(workspaceId, { enabled: customToolsEnabled })
  const { data: mcpServers } = useMcpServers(workspaceId, { enabled: mcpServersEnabled })

  return useMemo(() => {
    const map = new Map<string, string>()
    for (const workflow of workflows ?? []) map.set(`workflow:${workflow.id}`, workflow.name)
    for (const table of tables ?? []) map.set(`table:${table.id}`, table.name)
    for (const file of files ?? []) map.set(`file:${file.id}`, file.name)
    for (const knowledgeBase of knowledgeBases ?? []) {
      map.set(`knowledgebase:${knowledgeBase.id}`, knowledgeBase.name)
    }
    for (const folder of folders ?? []) map.set(`folder:${folder.id}`, folder.name)
    for (const skill of skills ?? []) map.set(`skill:${skill.id}`, skill.name)
    for (const tool of customTools ?? []) map.set(`custom_tool:${tool.id}`, tool.title)
    for (const server of mcpServers ?? []) {
      map.set(`mcp_server:${server.id}`, server.name || 'Unnamed server')
    }
    return map
  }, [workflows, tables, files, knowledgeBases, folders, skills, customTools, mcpServers])
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
  const openTypes = useMemo(() => new Set(resources.map((resource) => resource.type)), [resources])
  const nameLookup = useResourceNameLookup(workspaceId, openTypes)
  const {
    selectResource,
    addResource: onAddResource,
    removeResource: onRemoveResource,
    reorderResources: onReorderResources,
    requestResourceTransition,
  } = useMothershipResources()

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

  const existingKeys = useMemo(
    () => new Set(resources.map((r) => `${r.type}:${r.id}`)),
    [resources]
  )

  const tabs = useMemo<TabStripItem[]>(
    () =>
      resources.map((resource) => ({
        id: resource.id,
        title: nameLookup.get(`${resource.type}:${resource.id}`) ?? resource.title,
        icon: getResourceConfig(resource.type).renderTabIcon(resource, 'size-[16px] shrink-0'),
        active: activeId === resource.id,
        selected: selectedIds.size > 1 && selectedIds.has(resource.id),
        attention: activityIds?.has(resource.id) ?? false,
      })),
    [resources, nameLookup, activeId, selectedIds, activityIds]
  )

  const handleAdd = useCallback(
    (resource: MothershipResource) => {
      requestResourceTransition(() => onAddResource(resource))
    },
    [onAddResource, requestResourceTransition]
  )

  const handleOpenExisting = useCallback(
    (resource: MothershipResource) => {
      const open = () => openExistingResourceTab(resource, desktopScopeId, selectResource)
      if (resource.id === activeId) open()
      else requestResourceTransition(open)
    },
    [activeId, desktopScopeId, requestResourceTransition, selectResource]
  )

  const handleSelect = useCallback(
    (id: string, _source?: TabStripSelectionSource, e?: ReactMouseEvent<HTMLButtonElement>) => {
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
          const select = () => {
            setSelectedIds(next)
            selectResource(resource.id)
          }
          if (resource.id === activeId) select()
          else requestResourceTransition(select)
          return
        }
      }

      // Cmd/Ctrl+click: toggle individual tab in/out of selection
      if (e?.metaKey || e?.ctrlKey) {
        const wasSelected = selectedIds.has(resource.id)
        if (wasSelected) {
          const next = new Set(selectedIds)
          next.delete(resource.id)
          const fallback =
            activeId === resource.id
              ? (findNearestId(resources, idx, next) ?? findNearestId(resources, idx, null))
              : undefined
          const deselect = () => {
            setSelectedIds(next)
            if (fallback) selectResource(fallback)
            if (!anchorIdRef.current) anchorIdRef.current = resource.id
          }
          if (fallback && fallback !== activeId) requestResourceTransition(deselect)
          else deselect()
        } else {
          const select = () => {
            setSelectedIds((prev) => new Set(prev).add(resource.id))
            selectResource(resource.id)
            if (!anchorIdRef.current) anchorIdRef.current = resource.id
          }
          if (resource.id === activeId) select()
          else requestResourceTransition(select)
        }
        return
      }

      // Plain click: single-select
      const select = () => {
        anchorIdRef.current = resource.id
        setSelectedIds(new Set([resource.id]))
        selectResource(resource.id)
      }
      if (resource.id === activeId) select()
      else requestResourceTransition(select)
    },
    [resources, selectResource, selectedIds, activeId, requestResourceTransition]
  )

  const handleClose = useCallback(
    (id: string) => {
      const resource = resources.find((r) => r.id === id)
      if (!resource) return
      const isMulti = selectedIds.has(resource.id) && selectedIds.size > 1
      const targets = isMulti ? resources.filter((r) => selectedIds.has(r.id)) : [resource]
      const close = () => {
        // Update parent state immediately for all targets
        for (const r of targets) {
          onRemoveResource(r.type, r.id)
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
      }
      if (targets.some((target) => target.id === activeId)) requestResourceTransition(close)
      else close()
    },
    [activeId, onRemoveResource, requestResourceTransition, resources, selectedIds]
  )

  const handleTabDragStart = useCallback(
    (e: ReactDragEvent<HTMLDivElement>, id: string, drag: TabStripDragContext) => {
      const resource = resources.find((r) => r.id === id)
      if (!resource) return
      const selected = resources.filter((r) => selectedIds.has(r.id))
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
      e.dataTransfer.setData(
        SIM_RESOURCE_DRAG_TYPE,
        JSON.stringify({ type: resource.type, id: resource.id, title: resource.title })
      )
    },
    [resources, selectedIds]
  )

  const handleReorder = useCallback(
    (id: string, targetIndex: number) => {
      const fromIndex = resources.findIndex((r) => r.id === id)
      if (fromIndex < 0 || fromIndex === targetIndex) return
      const reordered = [...resources]
      const [moved] = reordered.splice(fromIndex, 1)
      reordered.splice(targetIndex, 0, moved)
      onReorderResources(reordered)
    },
    [resources, onReorderResources]
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
      className={RESOURCE_HEADER_CLASSES.stripGeometry}
      newTabControl={
        // Offered before the chat exists too: a resource opened while composing
        // the first prompt is context for that prompt, and gating on a chat id
        // meant the panel could be opened but not filled.
        <div className={cn(resources.length === 0 && RESOURCE_HEADER_CLASSES.emptyAddOffset)}>
          <AddResourceDropdown
            workspaceId={workspaceId}
            existingKeys={existingKeys}
            onAdd={handleAdd}
            onOpenExisting={handleOpenExisting}
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
