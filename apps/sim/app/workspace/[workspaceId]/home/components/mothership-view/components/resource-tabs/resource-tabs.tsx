import {
  type ComponentProps,
  type Dispatch,
  memo,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Button,
  chipVariants,
  POPOVER_ANIMATION_CLASSES,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Tooltip,
} from '@/components/emcn'
import { ChevronDown, Columns3, Eye, Pencil, X } from '@/components/emcn/icons'
import { SIM_RESOURCE_DRAG_TYPE, SIM_RESOURCES_DRAG_TYPE } from '@/lib/copilot/resource-types'
import { cn } from '@/lib/core/utils/cn'
import type { PreviewMode } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { AddResourceDropdown } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import { ResourcePanelToggle } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-panel-toggle'
import { ResourceSwitcherList } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-switcher-list'
import {
  RESOURCE_TAB_GAP_CLASS,
  RESOURCE_TAB_ICON_BUTTON_CLASS,
  RESOURCE_TAB_ICON_CLASS,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import { useFolders } from '@/hooks/queries/folders'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

/** Inactive tabs shown inline before the rest collapse into the +N chip. */
const MAX_INLINE_INACTIVE_TABS = 5

const ADD_RESOURCE_EXCLUDED_TYPES: readonly MothershipResourceType[] = ['folder', 'task'] as const

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
  stripNode: HTMLElement | null,
  selected: MothershipResource[]
): HTMLElement | null {
  if (!stripNode || selected.length === 0) return null
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
    const original = stripNode.querySelector<HTMLElement>(
      `[data-resource-tab-id="${CSS.escape(r.id)}"]`
    )
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
 * tabs always reflect the latest name even after a rename.
 */
function useResourceNameLookup(workspaceId: string): Map<string, string> {
  const { data: workflows = [] } = useWorkflows(workspaceId)
  const { data: tables = [] } = useTablesList(workspaceId)
  const { data: files = [] } = useWorkspaceFiles(workspaceId)
  const { data: knowledgeBases } = useKnowledgeBasesQuery(workspaceId)
  const { data: folders = [] } = useFolders(workspaceId)

  return useMemo(() => {
    const map = new Map<string, string>()
    for (const w of workflows) map.set(`workflow:${w.id}`, w.name)
    for (const t of tables) map.set(`table:${t.id}`, t.name)
    for (const f of files) map.set(`file:${f.id}`, f.name)
    for (const kb of knowledgeBases ?? []) map.set(`knowledgebase:${kb.id}`, kb.name)
    for (const folder of folders) map.set(`folder:${folder.id}`, folder.name)
    return map
  }, [workflows, tables, files, knowledgeBases, folders])
}

interface ResourceTabItemProps {
  resource: MothershipResource
  idx: number
  isHovered: boolean
  isDragging: boolean
  isSelected: boolean
  showGapBefore: boolean
  showGapAfter: boolean
  displayName: string
  /** The artifact changed while this tab wasn't focused. */
  showDot: boolean
  onDragStart: (e: React.DragEvent, idx: number) => void
  onDragOver: (e: React.DragEvent, idx: number) => void
  onDragLeave: () => void
  onDragEnd: () => void
  onTabClick: (e: React.MouseEvent, idx: number) => void
  setHoveredTabId: Dispatch<SetStateAction<string | null>>
  onRemove: (e: React.SyntheticEvent, resource: MothershipResource) => void
}

/**
 * A compressed, inactive tab: icon-first with a truncating label so the strip
 * squeezes browser-style instead of scroll-clipping. The active resource never
 * renders here — it gets the spotlight title chip.
 */
const ResourceTabItem = memo(function ResourceTabItem({
  resource,
  idx,
  isHovered,
  isDragging,
  isSelected,
  showGapBefore,
  showGapAfter,
  displayName,
  showDot,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDragEnd,
  onTabClick,
  setHoveredTabId,
  onRemove,
}: ResourceTabItemProps) {
  const config = getResourceConfig(resource.type)
  return (
    <div className='relative flex min-w-0 shrink items-center'>
      {showGapBefore && (
        <div className='-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-0 z-10 h-[16px] w-[2px] rounded-full bg-[var(--text-subtle)]' />
      )}
      <button
        type='button'
        draggable
        data-resource-tab-id={resource.id}
        onDragStart={(e) => onDragStart(e, idx)}
        onDragOver={(e) => onDragOver(e, idx)}
        onDragLeave={onDragLeave}
        onDragEnd={onDragEnd}
        onMouseDown={(e) => {
          if (e.button === 1) {
            e.preventDefault()
            onRemove(e, resource)
          }
        }}
        onClick={(e) => onTabClick(e, idx)}
        onMouseEnter={() => setHoveredTabId(resource.id)}
        onMouseLeave={() => setHoveredTabId(null)}
        className={cn(
          chipVariants({ variant: 'ghost', flush: true }),
          'relative min-w-[36px] max-w-[124px] shrink pr-[20px] text-[var(--text-body)]',
          isSelected && 'bg-[var(--surface-active)]',
          isDragging && 'opacity-30'
        )}
      >
        {config.renderTabIcon(resource, 'size-[16px] shrink-0')}
        <span className='min-w-0 truncate'>{displayName}</span>
        {showDot && !isHovered && (
          <span
            aria-hidden='true'
            className='-translate-y-1/2 absolute top-1/2 right-[8px] size-[5px] rounded-full bg-[var(--brand-accent)]'
          />
        )}
        {isHovered && (
          <span
            role='button'
            tabIndex={-1}
            onClick={(e) => onRemove(e, resource)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRemove(e, resource)
            }}
            className='-translate-y-1/2 absolute top-1/2 right-[4px] flex items-center justify-center rounded-sm p-[2px] hover-hover:bg-[var(--surface-6)]'
            aria-label={`Close ${displayName}`}
          >
            <X strokeWidth={2.5} className='size-[10px] text-[var(--text-icon)]' />
          </span>
        )}
      </button>
      {showGapAfter && (
        <div className='-translate-y-1/2 pointer-events-none absolute top-1/2 right-0 z-10 h-[16px] w-[2px] translate-x-1/2 rounded-full bg-[var(--text-subtle)]' />
      )}
    </div>
  )
})

interface ResourceTabsProps {
  workspaceId: string
  chatId?: string
  resources: MothershipResource[]
  activeId: string | null
  onSelect: (id: string) => void
  onAddResource: (resource: MothershipResource) => void
  onRemoveResource: (resourceType: MothershipResourceType, resourceId: string) => void
  onReorderResources: (resources: MothershipResource[]) => void
  previewMode?: PreviewMode
  onCyclePreviewMode?: () => void
  actions?: ReactNode
  /**
   * Controls rendered before the tab strip (e.g. the sidebar toggle and
   * compact chat switcher while the chat pane is hidden).
   */
  leading?: ReactNode
  /**
   * `type:id` keys of the artifacts the active chat has surfaced — used to
   * group the switcher dropdown by provenance.
   */
  chatArtifactKeys?: ReadonlySet<string>
  /**
   * `type:id` keys of tabs whose artifact changed while unfocused — these
   * carry the update dot.
   */
  updatedTabKeys?: ReadonlySet<string>
}

export function ResourceTabs({
  workspaceId,
  chatId,
  resources,
  activeId,
  onSelect,
  onAddResource,
  onRemoveResource,
  onReorderResources,
  previewMode,
  onCyclePreviewMode,
  actions,
  leading,
  chatArtifactKeys,
  updatedTabKeys,
}: ResourceTabsProps) {
  const PreviewModeIcon = PREVIEW_MODE_ICONS[previewMode ?? 'split']
  const nameLookup = useResourceNameLookup(workspaceId)
  const stripRef = useRef<HTMLDivElement>(null)

  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null)
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null)
  const [dropGapIdx, setDropGapIdx] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const dragStartIdx = useRef<number | null>(null)
  const anchorIdRef = useRef<string | null>(null)
  const prevChatIdRef = useRef(chatId)

  // Reset selection when switching chats — component instance persists across
  // chat switches so stale IDs would otherwise carry over.
  if (prevChatIdRef.current !== chatId) {
    prevChatIdRef.current = chatId
    setSelectedIds(new Set())
    anchorIdRef.current = null
  }

  // Spotlight layout: the active resource renders as the title chip; the rest
  // compress inline up to a cap, with the tail collapsing into the +N chip.
  const activeResource = useMemo(
    () => resources.find((r) => r.id === activeId) ?? resources[0] ?? null,
    [resources, activeId]
  )
  const inactiveTabs = useMemo(
    () => resources.filter((r) => r !== activeResource),
    [resources, activeResource]
  )
  const inlineTabs = inactiveTabs.slice(0, MAX_INLINE_INACTIVE_TABS)
  const overflowTabs = inactiveTabs.slice(MAX_INLINE_INACTIVE_TABS)

  const resolveName = useCallback(
    (resource: MothershipResource) =>
      nameLookup.get(`${resource.type}:${resource.id}`) ?? resource.title,
    [nameLookup]
  )

  const switcherItems = useMemo(
    () =>
      resources.map((resource) => {
        const key = `${resource.type}:${resource.id}`
        return {
          resource,
          name: resolveName(resource),
          isActive: resource === activeResource,
          isChatArtifact: chatArtifactKeys?.has(key) ?? false,
          isUpdated: updatedTabKeys?.has(key) ?? false,
        }
      }),
    [resources, activeResource, resolveName, chatArtifactKeys, updatedTabKeys]
  )

  const existingKeys = useMemo(
    () => new Set(resources.map((r) => `${r.type}:${r.id}`)),
    [resources]
  )

  const handleAdd = useCallback(
    (resource: MothershipResource) => {
      onAddResource(resource)
    },
    [onAddResource]
  )

  const handleSwitcherSelect = useCallback(
    (id: string) => {
      setSwitcherOpen(false)
      onSelect(id)
    },
    [onSelect]
  )

  const handleSwitcherClose = useCallback(
    (resource: MothershipResource) => {
      onRemoveResource(resource.type, resource.id)
    },
    [onRemoveResource]
  )

  const handleTabClick = useCallback(
    (e: React.MouseEvent, idx: number) => {
      const resource = inactiveTabs[idx]
      if (!resource) return

      // Shift+click: contiguous range from anchor (within the inactive strip)
      if (e.shiftKey) {
        const anchorId = anchorIdRef.current
        const anchorIdx = anchorId ? inactiveTabs.findIndex((r) => r.id === anchorId) : -1
        if (anchorIdx !== -1) {
          const start = Math.min(anchorIdx, idx)
          const end = Math.max(anchorIdx, idx)
          const next = new Set<string>()
          for (let i = start; i <= end; i++) next.add(inactiveTabs[i].id)
          setSelectedIds(next)
          onSelect(resource.id)
          return
        }
      }

      // Cmd/Ctrl+click: toggle individual tab in/out of selection
      if (e.metaKey || e.ctrlKey) {
        const wasSelected = selectedIds.has(resource.id)
        if (wasSelected) {
          const next = new Set(selectedIds)
          next.delete(resource.id)
          setSelectedIds(next)
          if (activeId === resource.id) {
            const fallback =
              findNearestId(inactiveTabs, idx, next) ?? findNearestId(inactiveTabs, idx, null)
            if (fallback) onSelect(fallback)
          }
        } else {
          setSelectedIds((prev) => new Set(prev).add(resource.id))
          onSelect(resource.id)
        }
        if (!anchorIdRef.current) anchorIdRef.current = resource.id
        return
      }

      // Plain click: single-select
      anchorIdRef.current = resource.id
      setSelectedIds(new Set([resource.id]))
      onSelect(resource.id)
    },
    [inactiveTabs, onSelect, selectedIds, activeId]
  )

  const handleRemove = useCallback(
    (e: React.SyntheticEvent, resource: MothershipResource) => {
      e.stopPropagation()
      const isMulti = selectedIds.has(resource.id) && selectedIds.size > 1
      const targets = isMulti ? resources.filter((r) => selectedIds.has(r.id)) : [resource]
      // Closing tabs is a session action — it never detaches the artifact from
      // the chat that surfaced it.
      for (const r of targets) {
        onRemoveResource(r.type, r.id)
      }
      // Clear stale selection and anchor for all removed targets
      const removedIds = new Set(targets.map((r) => r.id))
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const id of removedIds) next.delete(id)
        return next
      })
      if (anchorIdRef.current && removedIds.has(anchorIdRef.current)) {
        anchorIdRef.current = null
      }
    },
    [onRemoveResource, resources, selectedIds]
  )

  const handleActiveDragStart = useCallback(
    (e: React.DragEvent) => {
      if (!activeResource) return
      e.dataTransfer.effectAllowed = 'copy'
      e.dataTransfer.setData(
        SIM_RESOURCE_DRAG_TYPE,
        JSON.stringify({
          type: activeResource.type,
          id: activeResource.id,
          title: activeResource.title,
        })
      )
    },
    [activeResource]
  )

  const handleDragStart = useCallback(
    (e: React.DragEvent, idx: number) => {
      const resource = inactiveTabs[idx]
      if (!resource) return
      const selected = inactiveTabs.filter((r) => selectedIds.has(r.id))
      const isMultiDrag = selected.length > 1 && selectedIds.has(resource.id)
      if (isMultiDrag) {
        e.dataTransfer.effectAllowed = 'copy'
        e.dataTransfer.setData(SIM_RESOURCES_DRAG_TYPE, JSON.stringify(selected))
        const dragImage = buildMultiDragImage(stripRef.current, selected)
        if (dragImage) {
          e.dataTransfer.setDragImage(dragImage, 16, 16)
          setTimeout(() => dragImage.remove(), 0)
        }
        // Skip dragStartIdx so internal reorder is disabled for multi-select drags
        dragStartIdx.current = null
        setDraggedIdx(null)
        return
      }
      dragStartIdx.current = idx
      setDraggedIdx(idx)
      e.dataTransfer.effectAllowed = 'copyMove'
      e.dataTransfer.setData('text/plain', String(idx))
      e.dataTransfer.setData(
        SIM_RESOURCE_DRAG_TYPE,
        JSON.stringify({ type: resource.type, id: resource.id, title: resource.title })
      )
    },
    [inactiveTabs, selectedIds]
  )

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const midpoint = rect.left + rect.width / 2
    const gap = e.clientX < midpoint ? idx : idx + 1
    setDropGapIdx(gap)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDropGapIdx(null)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const fromIdx = dragStartIdx.current
      const gapIdx = dropGapIdx
      setDraggedIdx(null)
      setDropGapIdx(null)
      dragStartIdx.current = null
      if (fromIdx === null || gapIdx === null) return
      const insertAt = gapIdx > fromIdx ? gapIdx - 1 : gapIdx
      if (insertAt === fromIdx) return
      const reorderedInline = [...inlineTabs]
      const [moved] = reorderedInline.splice(fromIdx, 1)
      reorderedInline.splice(insertAt, 0, moved)
      // The strip's visual order is [active, inline..., overflow...] — persist
      // exactly that so the view and store never disagree.
      onReorderResources([
        ...(activeResource ? [activeResource] : []),
        ...reorderedInline,
        ...overflowTabs,
      ])
    },
    [inlineTabs, overflowTabs, activeResource, onReorderResources, dropGapIdx]
  )

  const handleDragEnd = useCallback(() => {
    setDraggedIdx(null)
    setDropGapIdx(null)
    dragStartIdx.current = null
  }, [])

  return (
    <div
      className={cn(
        'flex h-[44px] shrink-0 items-center border-[var(--border)] border-b px-4',
        RESOURCE_TAB_GAP_CLASS
      )}
    >
      {leading}
      {/* Without leading controls, the strip starts at the bar's left edge —
          pull it out 9px so the title chip sits 7px from the edge, matching
          the edge icon buttons' equal-distance rhythm. */}
      <div
        ref={stripRef}
        className={cn(
          'flex min-w-0 flex-1 items-center',
          RESOURCE_TAB_GAP_CLASS,
          !leading && '-ml-[9px]'
        )}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {activeResource && (
          <Popover size='md' open={switcherOpen} onOpenChange={setSwitcherOpen}>
            <PopoverAnchor asChild>
              <button
                type='button'
                draggable
                data-resource-tab-id={activeResource.id}
                onDragStart={handleActiveDragStart}
                onClick={() => setSwitcherOpen((prev) => !prev)}
                aria-label='Switch resource'
                className={cn(
                  chipVariants({ variant: 'ghost', active: true, flush: true }),
                  'min-w-0 shrink-0 text-[var(--text-body)]'
                )}
              >
                {getResourceConfig(activeResource.type).renderTabIcon(
                  activeResource,
                  'size-[16px] shrink-0'
                )}
                <span className='max-w-[220px] truncate font-medium text-[var(--text-primary)]'>
                  {resolveName(activeResource)}
                </span>
                <ChevronDown className='h-[6px] w-[10px] flex-shrink-0 text-[var(--text-icon)]' />
              </button>
            </PopoverAnchor>
            {/* Anchored 6px below the 44px bar, matching the chat switcher. */}
            <PopoverContent
              side='bottom'
              align='start'
              sideOffset={13}
              minWidth={240}
              maxWidth={320}
              border
              className={cn(POPOVER_ANIMATION_CLASSES, 'bg-[var(--bg)] p-0 dark:bg-[var(--bg)]')}
            >
              <ResourceSwitcherList
                items={switcherItems}
                onSelect={handleSwitcherSelect}
                onClose={handleSwitcherClose}
              />
            </PopoverContent>
          </Popover>
        )}
        {inlineTabs.map((resource, idx) => (
          <ResourceTabItem
            key={resource.id}
            resource={resource}
            idx={idx}
            isHovered={hoveredTabId === resource.id}
            isDragging={draggedIdx === idx}
            isSelected={selectedIds.has(resource.id) && selectedIds.size > 1}
            showGapBefore={
              dropGapIdx === idx &&
              draggedIdx !== null &&
              draggedIdx !== idx &&
              draggedIdx !== idx - 1
            }
            showGapAfter={
              idx === inlineTabs.length - 1 &&
              dropGapIdx === inlineTabs.length &&
              draggedIdx !== null &&
              draggedIdx !== idx
            }
            displayName={resolveName(resource)}
            showDot={updatedTabKeys?.has(`${resource.type}:${resource.id}`) ?? false}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDragEnd={handleDragEnd}
            onTabClick={handleTabClick}
            setHoveredTabId={setHoveredTabId}
            onRemove={handleRemove}
          />
        ))}
        {overflowTabs.length > 0 && (
          <button
            type='button'
            onClick={() => setSwitcherOpen(true)}
            aria-label={`${overflowTabs.length} more tabs`}
            className={cn(
              chipVariants({ variant: 'ghost', flush: true }),
              'shrink-0 text-[var(--text-muted)]'
            )}
          >
            +{overflowTabs.length}
            <ChevronDown className='h-[6px] w-[10px] flex-shrink-0 text-[var(--text-icon)]' />
          </button>
        )}
        {chatId && (
          <AddResourceDropdown
            workspaceId={workspaceId}
            existingKeys={existingKeys}
            onAdd={handleAdd}
            onSwitch={onSelect}
            excludeTypes={ADD_RESOURCE_EXCLUDED_TYPES}
          />
        )}
      </div>
      <div className={cn('ml-auto flex shrink-0 items-center', RESOURCE_TAB_GAP_CLASS)}>
        {actions}
        {previewMode && onCyclePreviewMode && (
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
        )}
        {/* Inert spacer reserving the toggle's exact footprint at the far right.
            The real, interactive toggle is rendered absolutely in home.tsx and
            overlays this spot, so it never moves when the panel collapses. Pulled
            out 9px so the hover pill sits 7px from the edge (equal to its 7px
            top/bottom gap in the bar). */}
        <ResourcePanelToggle placeholder className='-mr-[9px]' />
      </div>
    </div>
  )
}
