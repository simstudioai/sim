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
import { isEphemeralResource } from '@/lib/copilot/resource-extraction'
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

  return useMemo(() => {
    const map = new Map<string, string>()
    for (const w of workflows) map.set(`workflow:${w.id}`, w.name)
    for (const t of tables) map.set(`table:${t.id}`, t.name)
    for (const f of files) map.set(`file:${f.id}`, f.name)
    for (const kb of knowledgeBases ?? []) map.set(`knowledgebase:${kb.id}`, kb.name)
    return map
  }, [workflows, tables, files, knowledgeBases])
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

  const addResource = useAddChatResource(chatId)
  const removeResource = useRemoveChatResource(chatId)
  const reorderResources = useReorderChatResources(chatId)

  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null)
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null)
  const [dropGapIdx, setDropGapIdx] = useState<number | null>(null)
  const dragStartIdx = useRef<number | null>(null)
  const autoScrollRaf = useRef<number | null>(null)

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

  const handleRemove = useCallback(
    (e: React.MouseEvent, resource: MothershipResource) => {
      e.stopPropagation()
      if (!chatId) return
      if (!isEphemeralResource(resource)) {
        removeResource.mutate({ chatId, resourceType: resource.type, resourceId: resource.id })
      }
      onRemoveResource(resource.type, resource.id)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatId, onRemoveResource]
  )

  const handleDragStart = useCallback(
    (e: React.DragEvent, idx: number) => {
      dragStartIdx.current = idx
      setDraggedIdx(idx)
      e.dataTransfer.effectAllowed = 'copyMove'
      e.dataTransfer.setData('text/plain', String(idx))
      const resource = resources[idx]
      if (resource) {
        e.dataTransfer.setData(
          'application/x-sim-resource',
          JSON.stringify({ type: resource.type, id: resource.id, title: resource.title })
        )
      }
    },
    [resources]
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
                      onDragStart={(e) => handleDragStart(e, idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDragLeave={handleDragLeave}
                      onDragEnd={handleDragEnd}
                      onMouseDown={(e) => {
                        if (e.button === 1 && chatId) {
                          e.preventDefault()
                          handleRemove(e, resource)
                        }
                      }}
                      onClick={() => onSelect(resource.id)}
                      onMouseEnter={() => setHoveredTabId(resource.id)}
                      onMouseLeave={() => setHoveredTabId(null)}
                      className={cn(
                        'group relative shrink-0 bg-transparent px-2 py-1 pr-[22px] text-caption transition-opacity duration-150',
                        isActive && 'bg-[var(--surface-4)]',
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
