import {
  type ComponentProps,
  type Dispatch,
  memo,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
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

/**
 * Hard ceiling on a single tab's width — guards against pathological names.
 * Matches the inline tabs' max-w so measurement and render agree.
 */
const TAB_MAX_WIDTH = 240
/** Reserved width for the +N overflow chip when it renders. */
const OVERFLOW_CHIP_WIDTH = 56
/** Reserved width for the add-resource (+) button. */
const ADD_BUTTON_WIDTH = 30
/** Gap between strip items (gap-1.5). */
const STRIP_GAP = 6

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
  isActive: boolean
  isHovered: boolean
  isDragging: boolean
  isSelected: boolean
  showGapBefore: boolean
  showGapAfter: boolean
  displayName: string
  onDragStart: (e: React.DragEvent, idx: number) => void
  onDragOver: (e: React.DragEvent, idx: number) => void
  onDragLeave: () => void
  onDragEnd: () => void
  onTabClick: (e: React.MouseEvent, idx: number) => void
  setHoveredTabId: Dispatch<SetStateAction<string | null>>
  onRemove: (e: React.SyntheticEvent, resource: MothershipResource) => void
}

/**
 * A tab at its natural width — labels never truncate (beyond the
 * pathological-name ceiling); tabs that don't fit whole collapse into the +N
 * dropdown instead. The active tab is highlighted in place, never moved.
 */
const ResourceTabItem = memo(function ResourceTabItem({
  resource,
  idx,
  isActive,
  isHovered,
  isDragging,
  isSelected,
  showGapBefore,
  showGapAfter,
  displayName,
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
          chipVariants({ variant: 'ghost', active: isActive, flush: true }),
          'relative max-w-[240px] shrink-0 pr-[20px] text-[var(--text-body)]',
          isSelected && !isActive && 'bg-[var(--surface-active)]',
          isDragging && 'opacity-30'
        )}
      >
        {config.renderTabIcon(resource, 'size-[16px] shrink-0')}
        <span className='min-w-0 truncate'>{displayName}</span>
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
}: ResourceTabsProps) {
  const PreviewModeIcon = PREVIEW_MODE_ICONS[previewMode ?? 'split']
  const nameLookup = useResourceNameLookup(workspaceId)
  // Callback ref held in state so the capacity effect re-runs exactly when
  // the strip node attaches — a plain ref can be null on the effect's first
  // pass (hydration/transition commits), which would leave no observer behind
  // and freeze capacity at zero.
  const stripRef = useRef<HTMLDivElement | null>(null)
  const [stripNode, setStripNode] = useState<HTMLDivElement | null>(null)
  const attachStrip = useCallback((node: HTMLDivElement | null) => {
    stripRef.current = node
    setStripNode(node)
  }, [])

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

  // Tabs render in strip order and the active one is highlighted in place —
  // selecting never repositions a visible tab. Only a tab surfacing from the
  // +N dropdown joins the row (at the end), since it has no inline position.
  const activeResource = useMemo(
    () => resources.find((r) => r.id === activeId) ?? resources[0] ?? null,
    [resources, activeId]
  )

  // Width-aware capacity: a hidden measuring row holds every tab at natural
  // width; whole tabs are fitted in order. The inline renders don't affect the
  // measured nodes, so there's no layout feedback loop.
  const measureRef = useRef<HTMLDivElement>(null)
  // Permissive until the first trustworthy measurement: all tabs inline (the
  // panel's overflow-hidden clips any excess during the expand animation).
  const [stripLayout, setStripLayout] = useState({
    prefix: Number.MAX_SAFE_INTEGER,
    appendActive: false,
  })
  const resourceCount = resources.length
  const activeIdx = activeResource ? resources.indexOf(activeResource) : -1
  // Names participate in fitting (tabs render at natural width), so capacity
  // must recompute when any label changes — not just when counts do.
  const namesKey = resources
    .map((r) => nameLookup.get(`${r.type}:${r.id}`) ?? r.title)
    .join('\u0000')
  useEffect(() => {
    if (!stripNode) return
    const compute = () => {
      // Zero width means the strip isn't laid out yet (panel collapsed or
      // mid-animation) — keep the previous layout rather than trusting it.
      if (stripNode.clientWidth === 0) return
      const measureNode = measureRef.current
      if (!measureNode) return
      const tabWidths = Array.from(measureNode.children).map((child) =>
        Math.min((child as HTMLElement).offsetWidth, TAB_MAX_WIDTH)
      )
      const addWidth = chatId ? ADD_BUTTON_WIDTH + STRIP_GAP : 0
      const available = stripNode.clientWidth - addWidth
      const apply = (next: { prefix: number; appendActive: boolean }) =>
        setStripLayout((prev) =>
          prev.prefix === next.prefix && prev.appendActive === next.appendActive ? prev : next
        )
      const totalAll = tabWidths.reduce((sum, w) => sum + w + STRIP_GAP, 0)
      if (totalAll <= available + STRIP_GAP) {
        apply({ prefix: resourceCount, appendActive: false })
        return
      }
      const fitPrefix = (budget: number) => {
        let used = 0
        let fit = 0
        for (const width of tabWidths) {
          if (used + width > budget) break
          used += width + STRIP_GAP
          fit += 1
        }
        return fit
      }
      const budget = available - (OVERFLOW_CHIP_WIDTH + STRIP_GAP)
      const prefix = fitPrefix(budget)
      // The active tab must stay visible: when it lands beyond the fit, append
      // it after the prefix, reserving its width.
      if (activeIdx >= prefix && activeIdx >= 0) {
        apply({
          prefix: fitPrefix(budget - (tabWidths[activeIdx] + STRIP_GAP)),
          appendActive: true,
        })
        return
      }
      apply({ prefix, appendActive: false })
    }
    compute()
    // The strip resizes with every panel/sidebar/window change, so observing
    // it covers all reflow sources; the window listener is a fallback for the
    // first paint after the expand animation.
    const observer = new ResizeObserver(compute)
    observer.observe(stripNode)
    window.addEventListener('resize', compute)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', compute)
    }
  }, [stripNode, resourceCount, chatId, activeIdx, namesKey])

  const prefixTabs = resources.slice(0, Math.min(stripLayout.prefix, resources.length))
  const inlineTabs =
    stripLayout.appendActive && activeResource && !prefixTabs.includes(activeResource)
      ? [...prefixTabs, activeResource]
      : prefixTabs
  const overflowTabs = resources.filter((r) => !inlineTabs.includes(r))

  const resolveName = useCallback(
    (resource: MothershipResource) =>
      nameLookup.get(`${resource.type}:${resource.id}`) ?? resource.title,
    [nameLookup]
  )

  // Only the tabs that didn't fit inline — the dropdown never duplicates
  // what the strip already shows.
  const overflowItems = useMemo(
    () =>
      overflowTabs.map((resource) => {
        const key = `${resource.type}:${resource.id}`
        return {
          resource,
          name: resolveName(resource),
          isActive: false,
          isChatArtifact: chatArtifactKeys?.has(key) ?? false,
        }
      }),
    [overflowTabs, resolveName, chatArtifactKeys]
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
      const resource = inlineTabs[idx]
      if (!resource) return

      // Shift+click: contiguous range from anchor (within the visible strip)
      if (e.shiftKey) {
        const anchorId = anchorIdRef.current
        const anchorIdx = anchorId ? inlineTabs.findIndex((r) => r.id === anchorId) : -1
        if (anchorIdx !== -1) {
          const start = Math.min(anchorIdx, idx)
          const end = Math.max(anchorIdx, idx)
          const next = new Set<string>()
          for (let i = start; i <= end; i++) next.add(inlineTabs[i].id)
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
              findNearestId(inlineTabs, idx, next) ?? findNearestId(inlineTabs, idx, null)
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
    [inlineTabs, onSelect, selectedIds, activeId]
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

  const handleDragStart = useCallback(
    (e: React.DragEvent, idx: number) => {
      const resource = inlineTabs[idx]
      if (!resource) return
      const selected = inlineTabs.filter((r) => selectedIds.has(r.id))
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
    [inlineTabs, selectedIds]
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
      // The strip's visual order is [inline..., overflow...] — persist exactly
      // that so the view and store never disagree.
      onReorderResources([...reorderedInline, ...overflowTabs])
    },
    [inlineTabs, overflowTabs, onReorderResources, dropGapIdx]
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
          pull it out 9px so the first tab sits 7px from the edge, matching
          the edge icon buttons' equal-distance rhythm. */}
      <div
        ref={attachStrip}
        className={cn(
          'relative flex min-w-0 flex-1 items-center',
          RESOURCE_TAB_GAP_CLASS,
          !leading && '-ml-[9px]'
        )}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {/* Hidden measuring row: every tab at natural width, so the capacity
            pass fits whole tabs instead of guessing slot sizes. */}
        <div
          ref={measureRef}
          aria-hidden='true'
          className={cn(
            'pointer-events-none invisible absolute top-0 left-0 flex items-center',
            RESOURCE_TAB_GAP_CLASS
          )}
        >
          {resources.map((resource) => (
            <span
              key={resource.id}
              className={cn(
                chipVariants({ variant: 'ghost', flush: true }),
                'whitespace-nowrap pr-[20px] text-[var(--text-body)]'
              )}
            >
              {getResourceConfig(resource.type).renderTabIcon(resource, 'size-[16px] shrink-0')}
              <span>{resolveName(resource)}</span>
            </span>
          ))}
        </div>
        {inlineTabs.map((resource, idx) => (
          <ResourceTabItem
            key={resource.id}
            resource={resource}
            idx={idx}
            isActive={resource === activeResource}
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
          <Popover size='md' open={switcherOpen} onOpenChange={setSwitcherOpen}>
            <PopoverAnchor asChild>
              <button
                type='button'
                onClick={() => setSwitcherOpen((prev) => !prev)}
                aria-label={`${overflowTabs.length} more tabs`}
                className={cn(
                  chipVariants({ variant: 'ghost', flush: true }),
                  'shrink-0 text-[var(--text-muted)]',
                  switcherOpen && 'bg-[var(--surface-active)]'
                )}
              >
                +{overflowTabs.length}
                <ChevronDown className='h-[6px] w-[10px] flex-shrink-0 text-[var(--text-icon)]' />
              </button>
            </PopoverAnchor>
            {/* Anchored 6px below the 44px bar, matching the chat switcher.
                Keeps the popover's canonical 6px inset and rounded-xl so the
                chrome matches the workspace dropdown. */}
            <PopoverContent
              side='bottom'
              align='start'
              sideOffset={13}
              minWidth={180}
              maxWidth={320}
              border
              className={cn(POPOVER_ANIMATION_CLASSES, 'bg-[var(--bg)] dark:bg-[var(--bg)]')}
            >
              <ResourceSwitcherList
                items={overflowItems}
                onSelect={handleSwitcherSelect}
                onClose={handleSwitcherClose}
              />
            </PopoverContent>
          </Popover>
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
