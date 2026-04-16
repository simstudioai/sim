import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button, Tooltip } from '@/components/emcn'
import { Columns3, Eye, PanelLeft, Pencil } from '@/components/emcn/icons'
import { SIM_RESOURCE_DRAG_TYPE, SIM_RESOURCES_DRAG_TYPE } from '@/lib/copilot/resource-types'
import { isEphemeralResource } from '@/lib/copilot/resources/types'
import { cn } from '@/lib/core/utils/cn'
import type { PreviewMode } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { AddResourceDropdown } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
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
import {
  useAddChatResource,
  useRemoveChatResource,
  useReorderChatResources,
} from '@/hooks/queries/tasks'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

const EDGE_ZONE = 40
const SCROLL_SPEED = 8

const ADD_RESOURCE_EXCLUDED_TYPES: readonly MothershipResourceType[] = [
  'folder',
  'task',
  'log',
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
  scrollNode: HTMLElement | null,
  selected: MothershipResource[]
): HTMLElement | null {
  if (!scrollNode || selected.length === 0) return null
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
    const original = scrollNode.querySelector<HTMLElement>(
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

interface ResourceTabsProps {
  workspaceId: string
  chatId?: string
  resources: MothershipResource[]
  activeId: string | null
  onSelect: (id: string) => void
  onAddResource: (resource: MothershipResource) => void
  onRemoveResource: (resourceType: MothershipResourceType, resourceId: string) => void
  onReorderResources: (resources: MothershipResource[]) => void
  onCollapse: () => void
  previewMode?: PreviewMode
  onCyclePreviewMode?: () => void
  actions?: ReactNode
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
  onCollapse,
  previewMode,
  onCyclePreviewMode,
  actions,
}: ResourceTabsProps) {
  const PreviewModeIcon = PREVIEW_MODE_ICONS[previewMode ?? 'split']
  const nameLookup = useResourceNameLookup(workspaceId)
  const scrollNodeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = scrollNodeRef.current
    if (!node) return
    const handler = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        node.scrollLeft += e.deltaY
        e.preventDefault()
      }
    }
    node.addEventListener('wheel', handler, { passive: false })
    return () => node.removeEventListener('wheel', handler)
  }, [])

  useEffect(() => {
    const node = scrollNodeRef.current
    if (!node || !activeId) return
    const tab = node.querySelector<HTMLElement>(`[data-resource-tab-id="${CSS.escape(activeId)}"]`)
    if (!tab) return
    // Use bounding rects because the tab's offsetParent is a `position: relative`
    // wrapper, so `offsetLeft` is relative to that wrapper rather than `node`.
    const tabRect = tab.getBoundingClientRect()
    const nodeRect = node.getBoundingClientRect()
    const tabLeft = tabRect.left - nodeRect.left + node.scrollLeft
    const tabRight = tabLeft + tabRect.width
    const viewLeft = node.scrollLeft
    const viewRight = viewLeft + node.clientWidth
    if (tabLeft < viewLeft) {
      node.scrollTo({ left: tabLeft, behavior: 'smooth' })
    } else if (tabRight > viewRight) {
      node.scrollTo({ left: tabRight - node.clientWidth, behavior: 'smooth' })
    }
  }, [activeId])

  const addResource = useAddChatResource(chatId)
  const removeResource = useRemoveChatResource(chatId)
  const reorderResources = useReorderChatResources(chatId)

  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null)
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null)
  const [dropGapIdx, setDropGapIdx] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const dragStartIdx = useRef<number | null>(null)
  const autoScrollRaf = useRef<number | null>(null)
  const anchorIdRef = useRef<string | null>(null)
  const prevChatIdRef = useRef(chatId)

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

  const handleAdd = useCallback(
    (resource: MothershipResource) => {
      if (!chatId) return
      addResource.mutate({ chatId, resource })
      onAddResource(resource)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatId, onAddResource]
  )

  const handleTabClick = useCallback(
    (e: React.MouseEvent, idx: number) => {
      const resource = resources[idx]
      if (!resource) return

      // Shift+click: contiguous range from anchor
      if (e.shiftKey) {
        // Fall back to activeId when no explicit anchor exists (e.g. tab opened via sidebar)
        const anchorId = anchorIdRef.current ?? activeId
        const anchorIdx = anchorId ? resources.findIndex((r) => r.id === anchorId) : -1
        if (anchorIdx !== -1) {
          const start = Math.min(anchorIdx, idx)
          const end = Math.max(anchorIdx, idx)
          const next = new Set<string>()
          for (let i = start; i <= end; i++) next.add(resources[i].id)
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
          // Only switch active if we just deselected the currently-active tab
          if (activeId === resource.id) {
            const fallback =
              findNearestId(resources, idx, next) ?? findNearestId(resources, idx, null)
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
    [resources, onSelect, selectedIds, activeId]
  )

  const handleRemove = useCallback(
    (e: React.MouseEvent, resource: MothershipResource) => {
      e.stopPropagation()
      if (!chatId) return
      const isMulti = selectedIds.has(resource.id) && selectedIds.size > 1
      const targets = isMulti ? resources.filter((r) => selectedIds.has(r.id)) : [resource]
      // Update parent state immediately for all targets
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
      for (const r of targets) {
        if (isEphemeralResource(r)) continue
        removeResource.mutate({ chatId, resourceType: r.type, resourceId: r.id })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatId, onRemoveResource, resources, selectedIds]
  )

  const handleDragStart = useCallback(
    (e: React.DragEvent, idx: number) => {
      const resource = resources[idx]
      if (!resource) return
      const selected = resources.filter((r) => selectedIds.has(r.id))
      const isMultiDrag = selected.length > 1 && selectedIds.has(resource.id)
      if (isMultiDrag) {
        e.dataTransfer.effectAllowed = 'copy'
        e.dataTransfer.setData(SIM_RESOURCES_DRAG_TYPE, JSON.stringify(selected))
        const dragImage = buildMultiDragImage(scrollNodeRef.current, selected)
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
    [resources, selectedIds]
  )

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRaf.current) {
      cancelAnimationFrame(autoScrollRaf.current)
      autoScrollRaf.current = null
    }
  }, [])

  const startEdgeScroll = useCallback(
    (clientX: number) => {
      const container = scrollNodeRef.current
      if (!container) return
      const cRect = container.getBoundingClientRect()
      if (autoScrollRaf.current) cancelAnimationFrame(autoScrollRaf.current)
      if (clientX < cRect.left + EDGE_ZONE) {
        const tick = () => {
          container.scrollLeft -= SCROLL_SPEED
          autoScrollRaf.current = requestAnimationFrame(tick)
        }
        autoScrollRaf.current = requestAnimationFrame(tick)
      } else if (clientX > cRect.right - EDGE_ZONE) {
        const tick = () => {
          container.scrollLeft += SCROLL_SPEED
          autoScrollRaf.current = requestAnimationFrame(tick)
        }
        autoScrollRaf.current = requestAnimationFrame(tick)
      } else {
        stopAutoScroll()
      }
    },
    [stopAutoScroll]
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent, idx: number) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const rect = e.currentTarget.getBoundingClientRect()
      const midpoint = rect.left + rect.width / 2
      const gap = e.clientX < midpoint ? idx : idx + 1
      setDropGapIdx(gap)
      startEdgeScroll(e.clientX)
    },
    [startEdgeScroll]
  )

  const handleDragLeave = useCallback(() => {
    setDropGapIdx(null)
    stopAutoScroll()
  }, [stopAutoScroll])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      stopAutoScroll()
      const fromIdx = dragStartIdx.current
      const gapIdx = dropGapIdx
      if (fromIdx === null || gapIdx === null) {
        setDraggedIdx(null)
        setDropGapIdx(null)
        dragStartIdx.current = null
        return
      }
      const insertAt = gapIdx > fromIdx ? gapIdx - 1 : gapIdx
      if (insertAt === fromIdx) {
        setDraggedIdx(null)
        setDropGapIdx(null)
        dragStartIdx.current = null
        return
      }
      const reordered = [...resources]
      const [moved] = reordered.splice(fromIdx, 1)
      reordered.splice(insertAt, 0, moved)
      onReorderResources(reordered)
      if (chatId) {
        const persistable = reordered.filter((r) => !isEphemeralResource(r))
        if (persistable.length > 0) {
          reorderResources.mutate({ chatId, resources: persistable })
        }
      }
      setDraggedIdx(null)
      setDropGapIdx(null)
      dragStartIdx.current = null
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatId, resources, onReorderResources, dropGapIdx, stopAutoScroll]
  )

  const handleDragEnd = useCallback(() => {
    stopAutoScroll()
    setDraggedIdx(null)
    setDropGapIdx(null)
    dragStartIdx.current = null
  }, [stopAutoScroll])

  return (
    <div
      className={cn(
        'flex shrink-0 items-center border-[var(--border)] border-b px-4 py-[8.5px]',
        RESOURCE_TAB_GAP_CLASS
      )}
    >
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant='subtle'
            onClick={onCollapse}
            className={RESOURCE_TAB_ICON_BUTTON_CLASS}
            aria-label='Collapse resource view'
          >
            <PanelLeft className={cn(RESOURCE_TAB_ICON_CLASS, '-scale-x-100')} />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>Collapse</p>
        </Tooltip.Content>
      </Tooltip.Root>
      <div className={cn('flex min-w-0 flex-1 items-center', RESOURCE_TAB_GAP_CLASS)}>
        <div
          ref={scrollNodeRef}
          className={cn(
            'flex min-w-0 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            RESOURCE_TAB_GAP_CLASS
          )}
          onDragOver={(e) => {
            e.preventDefault()
            startEdgeScroll(e.clientX)
          }}
          onDrop={handleDrop}
        >
          {resources.map((resource, idx) => {
            const config = getResourceConfig(resource.type)
            const displayName = nameLookup.get(`${resource.type}:${resource.id}`) ?? resource.title
            const isActive = activeId === resource.id
            const isHovered = hoveredTabId === resource.id
            const isDragging = draggedIdx === idx
            const isSelected = selectedIds.has(resource.id) && selectedIds.size > 1
            const showGapBefore =
              dropGapIdx === idx &&
              draggedIdx !== null &&
              draggedIdx !== idx &&
              draggedIdx !== idx - 1
            const showGapAfter =
              idx === resources.length - 1 &&
              dropGapIdx === resources.length &&
              draggedIdx !== null &&
              draggedIdx !== idx

            return (
              <div key={resource.id} className='relative flex shrink-0 items-center'>
                {showGapBefore && (
                  <div className='-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-0 z-10 h-[16px] w-[2px] rounded-full bg-[var(--text-subtle)]' />
                )}
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      variant='subtle'
                      draggable
                      data-resource-tab-id={resource.id}
                      onDragStart={(e) => handleDragStart(e, idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDragLeave={handleDragLeave}
                      onDragEnd={handleDragEnd}
                      onMouseDown={(e) => {
                        if (e.button === 1) {
                          e.preventDefault()
                          if (chatId) handleRemove(e, resource)
                        }
                      }}
                      onClick={(e) => handleTabClick(e, idx)}
                      onMouseEnter={() => setHoveredTabId(resource.id)}
                      onMouseLeave={() => setHoveredTabId(null)}
                      className={cn(
                        'group relative shrink-0 bg-transparent px-2 py-1 pr-[22px] text-caption transition-opacity duration-150',
                        isActive && 'bg-[var(--surface-4)]',
                        isSelected && !isActive && 'bg-[var(--surface-3)]',
                        isDragging && 'opacity-30'
                      )}
                    >
                      {config.renderTabIcon(resource, 'mr-1.5 h-[14px] w-[14px]')}
                      {displayName}
                      {(isHovered || isActive) && chatId && (
                        <span
                          role='button'
                          tabIndex={-1}
                          onClick={(e) => handleRemove(e, resource)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter')
                              handleRemove(e as unknown as React.MouseEvent, resource)
                          }}
                          className='-translate-y-1/2 absolute top-1/2 right-[4px] flex items-center justify-center rounded-sm p-[1px] hover-hover:bg-[var(--surface-5)]'
                          aria-label={`Close ${displayName}`}
                        >
                          <svg
                            className='h-[10px] w-[10px] text-[var(--text-icon)]'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            strokeWidth='2.5'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                          >
                            <path d='M18 6 6 18M6 6l12 12' />
                          </svg>
                        </span>
                      )}
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='bottom'>
                    <p>{displayName}</p>
                  </Tooltip.Content>
                </Tooltip.Root>
                {showGapAfter && (
                  <div className='-translate-y-1/2 pointer-events-none absolute top-1/2 right-0 z-10 h-[16px] w-[2px] translate-x-1/2 rounded-full bg-[var(--text-subtle)]' />
                )}
              </div>
            )
          })}
        </div>
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
      {(actions || (previewMode && onCyclePreviewMode)) && (
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
        </div>
      )}
    </div>
  )
}
