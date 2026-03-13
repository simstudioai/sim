'use client'

import {
  type ReactNode,
  type RefCallback,
  type SVGProps,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Tooltip,
} from '@/components/emcn'
import { PanelLeft, Plus, Search } from '@/components/emcn/icons'
import { ChevronRight, Folder } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useFolders } from '@/hooks/queries/folders'
import { useTablesList } from '@/hooks/queries/tables'
import { useAddChatResource, useRemoveChatResource, useReorderChatResources } from '@/hooks/queries/tasks'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useFolderStore } from '@/stores/folders/store'
import type { FolderTreeNode } from '@/stores/folders/types'
import type { PreviewMode } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import { getResourceConfig, RESOURCE_TYPES } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'

const LEFT_HALF =
  'M10.25 0.75H3.25C1.86929 0.75 0.75 1.86929 0.75 3.25V16.25C0.75 17.6307 1.86929 18.75 3.25 18.75H10.25V0.75Z'
const RIGHT_HALF =
  'M10.25 0.75H17.25C18.6307 0.75 19.75 1.86929 19.75 3.25V16.25C19.75 17.6307 18.6307 18.75 17.25 18.75H10.25V0.75Z'
const OUTLINE =
  'M0.75 3.25C0.75 1.86929 1.86929 0.75 3.25 0.75H17.25C18.6307 0.75 19.75 1.86929 19.75 3.25V16.25C19.75 17.6307 18.6307 18.75 17.25 18.75H3.25C1.86929 18.75 0.75 17.6307 0.75 16.25V3.25Z'

function PreviewModeIcon({ mode, ...props }: { mode: PreviewMode } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='-1 -2 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.75'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      {mode !== 'preview' && <path d={LEFT_HALF} fill='var(--surface-active)' stroke='none' />}
      {mode !== 'editor' && <path d={RIGHT_HALF} fill='var(--surface-active)' stroke='none' />}
      <path d={OUTLINE} />
      <path d='M10.25 0.75V18.75' />
    </svg>
  )
}

const EDGE_ZONE = 40
const SCROLL_SPEED = 8

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
  const scrollNodeRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useCallback<RefCallback<HTMLDivElement>>((node) => {
    scrollNodeRef.current = node
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
      removeResource.mutate({ chatId, resourceType: resource.type, resourceId: resource.id })
      onRemoveResource(resource.type, resource.id)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatId, onRemoveResource]
  )

  const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
    dragStartIdx.current = idx
    setDraggedIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const midpoint = rect.left + rect.width / 2
    const gap = e.clientX < midpoint ? idx : idx + 1
    setDropGapIdx(gap)

    const container = scrollNodeRef.current
    if (!container) return
    const cRect = container.getBoundingClientRect()
    const x = e.clientX
    if (autoScrollRaf.current) cancelAnimationFrame(autoScrollRaf.current)
    if (x < cRect.left + EDGE_ZONE) {
      const tick = () => {
        container.scrollLeft -= SCROLL_SPEED
        autoScrollRaf.current = requestAnimationFrame(tick)
      }
      autoScrollRaf.current = requestAnimationFrame(tick)
    } else if (x > cRect.right - EDGE_ZONE) {
      const tick = () => {
        container.scrollLeft += SCROLL_SPEED
        autoScrollRaf.current = requestAnimationFrame(tick)
      }
      autoScrollRaf.current = requestAnimationFrame(tick)
    } else {
      autoScrollRaf.current = null
    }
  }, [])

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRaf.current) {
      cancelAnimationFrame(autoScrollRaf.current)
      autoScrollRaf.current = null
    }
  }, [])

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
        reorderResources.mutate({ chatId, resources: reordered })
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
    <div className='flex shrink-0 items-center border-[var(--border)] border-b px-[16px] py-[8.5px]'>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant='subtle'
            onClick={onCollapse}
            className='shrink-0 bg-transparent px-[8px] py-[5px] text-[12px]'
            aria-label='Collapse resource view'
          >
            <PanelLeft className='-scale-x-100 h-[16px] w-[16px] text-[var(--text-icon)]' />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>Collapse</p>
        </Tooltip.Content>
      </Tooltip.Root>
      <div
        ref={scrollRef}
        className='mx-[2px] flex min-w-0 items-center gap-[6px] overflow-x-auto px-[6px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        onDragOver={(e) => {
          e.preventDefault()
          const container = scrollNodeRef.current
          if (!container) return
          const cRect = container.getBoundingClientRect()
          const x = e.clientX
          if (autoScrollRaf.current) cancelAnimationFrame(autoScrollRaf.current)
          if (x < cRect.left + EDGE_ZONE) {
            const tick = () => {
              container.scrollLeft -= SCROLL_SPEED
              autoScrollRaf.current = requestAnimationFrame(tick)
            }
            autoScrollRaf.current = requestAnimationFrame(tick)
          } else if (x > cRect.right - EDGE_ZONE) {
            const tick = () => {
              container.scrollLeft += SCROLL_SPEED
              autoScrollRaf.current = requestAnimationFrame(tick)
            }
            autoScrollRaf.current = requestAnimationFrame(tick)
          } else {
            stopAutoScroll()
          }
        }}
        onDrop={handleDrop}
      >
        {resources.map((resource, idx) => {
          const config = getResourceConfig(resource.type)
          const isActive = activeId === resource.id
          const isHovered = hoveredTabId === resource.id
          const isDragging = draggedIdx === idx
          const showGapBefore = dropGapIdx === idx && draggedIdx !== null && draggedIdx !== idx && draggedIdx !== idx - 1
          const showGapAfter = idx === resources.length - 1 && dropGapIdx === resources.length && draggedIdx !== null && draggedIdx !== idx

          return (
            <div key={resource.id} className='relative flex shrink-0 items-center'>
              {showGapBefore && (
                <div className='pointer-events-none absolute top-1/2 left-0 z-10 h-[16px] w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--text-subtle)]' />
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
                      'group relative shrink-0 bg-transparent px-[8px] py-[4px] pr-[22px] text-[12px] transition-opacity duration-150',
                      isActive && 'bg-[var(--surface-4)]',
                      isDragging && 'opacity-30'
                    )}
                  >
                    {config.renderTabIcon(resource, 'mr-[6px] h-[14px] w-[14px]')}
                    {resource.title}
                    {(isHovered || isActive) && chatId && (
                      <span
                        role='button'
                        tabIndex={-1}
                        onClick={(e) => handleRemove(e, resource)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleRemove(e as unknown as React.MouseEvent, resource) }}
                        className='absolute right-[4px] top-1/2 flex -translate-y-1/2 items-center justify-center rounded-[4px] p-[1px] hover:bg-[var(--surface-5)]'
                        aria-label={`Close ${resource.title}`}
                      >
                        <svg className='h-[10px] w-[10px] text-[var(--text-tertiary)]' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'>
                          <path d='M18 6 6 18M6 6l12 12' />
                        </svg>
                      </span>
                    )}
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content side='bottom'>
                  <p>{resource.title}</p>
                </Tooltip.Content>
              </Tooltip.Root>
              {showGapAfter && (
                <div className='pointer-events-none absolute top-1/2 right-0 z-10 h-[16px] w-[2px] translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--text-subtle)]' />
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
        />
      )}
      {(actions || (previewMode && onCyclePreviewMode)) && (
        <div className='ml-auto flex shrink-0 items-center gap-[6px]'>
          {actions}
          {previewMode && onCyclePreviewMode && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='subtle'
                  onClick={onCyclePreviewMode}
                  className='shrink-0 bg-transparent px-[8px] py-[5px] text-[12px]'
                  aria-label='Cycle preview mode'
                >
                  <PreviewModeIcon
                    mode={previewMode}
                    className='h-[16px] w-[16px] text-[var(--text-icon)]'
                  />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content side='bottom'>
                <p>Preview mode</p>
              </Tooltip.Content>
            </Tooltip.Root>
          )}
        </div>
      )}
    </div>
  )
}

interface AddResourceDropdownProps {
  workspaceId: string
  existingKeys: Set<string>
  onAdd: (resource: MothershipResource) => void
}

const EMPTY_SUBMENU = (
  <DropdownMenuItem disabled>
    <span className='text-[13px] text-[var(--text-tertiary)]'>None available</span>
  </DropdownMenuItem>
)

type AvailableItem = { id: string; name: string; [key: string]: unknown }

interface AvailableItemsByType {
  type: MothershipResourceType
  items: AvailableItem[]
}

function useAvailableResources(workspaceId: string, existingKeys: Set<string>): AvailableItemsByType[] {
  const { data: workflows = [] } = useWorkflows(workspaceId, { syncRegistry: false })
  const { data: tables = [] } = useTablesList(workspaceId)
  const { data: files = [] } = useWorkspaceFiles(workspaceId)
  const { data: knowledgeBases } = useKnowledgeBasesQuery(workspaceId)

  return useMemo(() => [
    {
      type: 'workflow' as const,
      items: workflows
        .filter((w) => !existingKeys.has(`workflow:${w.id}`))
        .map((w) => ({ id: w.id, name: w.name, color: w.color, folderId: w.folderId })),
    },
    {
      type: 'table' as const,
      items: tables
        .filter((t) => !existingKeys.has(`table:${t.id}`))
        .map((t) => ({ id: t.id, name: t.name })),
    },
    {
      type: 'file' as const,
      items: files
        .filter((f) => !existingKeys.has(`file:${f.id}`))
        .map((f) => ({ id: f.id, name: f.name })),
    },
    {
      type: 'knowledgebase' as const,
      items: (knowledgeBases ?? [])
        .filter((kb) => !existingKeys.has(`knowledgebase:${kb.id}`))
        .map((kb) => ({ id: kb.id, name: kb.name })),
    },
  ], [workflows, tables, files, knowledgeBases, existingKeys])
}

function CollapsibleFolder({
  folder,
  workflows,
  expanded,
  onToggle,
  onSelect,
  config,
  level,
}: {
  folder: FolderTreeNode
  workflows: AvailableItem[]
  expanded: Set<string>
  onToggle: (id: string) => void
  onSelect: (item: AvailableItem) => void
  config: ReturnType<typeof getResourceConfig>
  level: number
}) {
  const folderWorkflows = workflows.filter(
    (w) => (w.folderId as string | null) === folder.id
  )
  const isExpanded = expanded.has(folder.id)
  const indent = level * 12

  return (
    <>
      <div
        role='button'
        tabIndex={0}
        onClick={(e) => { e.preventDefault(); onToggle(folder.id) }}
        onKeyDown={(e) => { if (e.key === 'Enter') onToggle(folder.id) }}
        className='flex cursor-pointer items-center gap-[6px] rounded-sm px-[8px] py-[6px] text-[13px] hover:bg-[var(--surface-active)]'
        style={{ paddingLeft: `${8 + indent}px` }}
      >
        <ChevronRight
          className={cn(
            'h-[12px] w-[12px] shrink-0 text-[var(--text-tertiary)] transition-transform duration-100',
            isExpanded && 'rotate-90'
          )}
        />
        <Folder className='h-[14px] w-[14px] shrink-0 text-[var(--text-icon)]' />
        <span className='truncate text-[var(--text-primary)]'>{folder.name}</span>
      </div>
      {isExpanded && (
        <>
          {folder.children.map((child) => (
            <CollapsibleFolder
              key={child.id}
              folder={child}
              workflows={workflows}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              config={config}
              level={level + 1}
            />
          ))}
          {folderWorkflows.map((item) => (
            <DropdownMenuItem
              key={item.id}
              onClick={() => onSelect(item)}
              style={{ paddingLeft: `${8 + (level + 1) * 12}px` }}
            >
              {config.renderDropdownItem({ item })}
            </DropdownMenuItem>
          ))}
        </>
      )}
    </>
  )
}

function WorkflowSubmenuContent({
  workspaceId,
  items,
  config,
  onSelect,
}: {
  workspaceId: string
  items: AvailableItem[]
  config: ReturnType<typeof getResourceConfig>
  onSelect: (item: AvailableItem) => void
}) {
  useFolders(workspaceId)
  const getFolderTree = useFolderStore((state) => state.getFolderTree)
  const folderTree = useMemo(() => getFolderTree(workspaceId), [getFolderTree, workspaceId])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleFolder = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const workflowsByFolder = useMemo(() => {
    const grouped: Record<string, AvailableItem[]> = {}
    for (const item of items) {
      const fId = (item.folderId as string | null) ?? 'root'
      if (!grouped[fId]) grouped[fId] = []
      grouped[fId].push(item)
    }
    return grouped
  }, [items])

  const rootWorkflows = workflowsByFolder.root ?? []

  const folderTreeHasItems = useCallback(
    (folder: FolderTreeNode): boolean => {
      if (workflowsByFolder[folder.id]?.length) return true
      return folder.children.some(folderTreeHasItems)
    },
    [workflowsByFolder]
  )

  const visibleFolders = useMemo(
    () => folderTree.filter(folderTreeHasItems),
    [folderTree, folderTreeHasItems]
  )

  if (items.length === 0) return EMPTY_SUBMENU

  return (
    <>
      {visibleFolders.map((folder) => (
        <CollapsibleFolder
          key={folder.id}
          folder={folder}
          workflows={items}
          expanded={expanded}
          onToggle={toggleFolder}
          onSelect={onSelect}
          config={config}
          level={0}
        />
      ))}
      {rootWorkflows.map((item) => (
        <DropdownMenuItem key={item.id} onClick={() => onSelect(item)}>
          {config.renderDropdownItem({ item })}
        </DropdownMenuItem>
      ))}
    </>
  )
}

function AddResourceDropdown({ workspaceId, existingKeys, onAdd }: AddResourceDropdownProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const available = useAvailableResources(workspaceId, existingKeys)
  const inputRef = useCallback<RefCallback<HTMLInputElement>>((node) => {
    if (node) setTimeout(() => node.focus(), 0)
  }, [])

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    if (!next) setSearch('')
  }, [])

  const select = useCallback(
    (resource: MothershipResource) => {
      onAdd(resource)
      setOpen(false)
      setSearch('')
    },
    [onAdd]
  )

  const query = search.trim().toLowerCase()

  const filtered = useMemo(() => {
    if (!query) return null
    return available.flatMap(({ type, items }) =>
      items
        .filter((item) => item.name.toLowerCase().includes(query))
        .map((item) => ({ type, item }))
    )
  }, [available, query])

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant='subtle'
              className='shrink-0 bg-transparent px-[8px] py-[5px] text-[12px]'
              aria-label='Add resource tab'
            >
              <Plus className='h-[14px] w-[14px] text-[var(--text-icon)]' />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>Add resource</p>
        </Tooltip.Content>
      </Tooltip.Root>
      <DropdownMenuContent align='start' className='w-[240px]'>
        <div className='flex items-center gap-[8px] px-[8px] py-[6px]'>
          <Search className='h-[14px] w-[14px] shrink-0 text-[var(--text-tertiary)]' />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder='Search resources…'
            className='h-[20px] w-full bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]'
          />
        </div>
        <DropdownMenuSeparator />
        {filtered ? (
          filtered.length > 0 ? (
            <div className='max-h-[280px] overflow-y-auto'>
              {filtered.map(({ type, item }) => {
                const config = getResourceConfig(type)
                return (
                  <DropdownMenuItem
                    key={`${type}:${item.id}`}
                    onClick={() => select({ type, id: item.id, title: item.name })}
                  >
                    {config.renderDropdownItem({ item })}
                    <span className='ml-auto pl-[8px] text-[11px] text-[var(--text-tertiary)]'>
                      {config.label}
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </div>
          ) : (
            <div className='px-[8px] py-[6px] text-[13px] text-[var(--text-tertiary)]'>
              No results
            </div>
          )
        ) : (
          available.map(({ type, items }) => {
            const config = getResourceConfig(type)
            const Icon = config.icon
            return (
              <DropdownMenuSub key={type}>
                <DropdownMenuSubTrigger>
                  <Icon className='mr-[8px] h-[14px] w-[14px] text-[var(--text-icon)]' />
                  {config.label}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className='max-h-[280px] w-[220px] overflow-y-auto'>
                  {type === 'workflow' ? (
                    <WorkflowSubmenuContent
                      workspaceId={workspaceId}
                      items={items}
                      config={config}
                      onSelect={(item) => select({ type, id: item.id, title: item.name })}
                    />
                  ) : items.length > 0 ? (
                    items.map((item) => (
                      <DropdownMenuItem
                        key={item.id}
                        onClick={() => select({ type, id: item.id, title: item.name })}
                      >
                        {config.renderDropdownItem({ item })}
                      </DropdownMenuItem>
                    ))
                  ) : (
                    EMPTY_SUBMENU
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
