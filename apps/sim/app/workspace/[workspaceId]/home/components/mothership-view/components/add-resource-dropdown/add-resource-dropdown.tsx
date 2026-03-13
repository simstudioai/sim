'use client'

import { type RefCallback, useCallback, useMemo, useState } from 'react'
import { ChevronRight, Folder } from 'lucide-react'
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
import { Plus, Search } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import { useFolders } from '@/hooks/queries/folders'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useFolderStore } from '@/stores/folders/store'
import type { FolderTreeNode } from '@/stores/folders/types'

export interface AddResourceDropdownProps {
  workspaceId: string
  existingKeys: Set<string>
  onAdd: (resource: MothershipResource) => void
  onSwitch?: (resourceId: string) => void
}

export type AvailableItem = { id: string; name: string; isOpen?: boolean; [key: string]: unknown }

interface AvailableItemsByType {
  type: MothershipResourceType
  items: AvailableItem[]
}

const EMPTY_SUBMENU = (
  <DropdownMenuItem disabled>
    <span className='text-[13px] text-[var(--text-tertiary)]'>None available</span>
  </DropdownMenuItem>
)

export function useAvailableResources(
  workspaceId: string,
  existingKeys: Set<string>
): AvailableItemsByType[] {
  const { data: workflows = [] } = useWorkflows(workspaceId, { syncRegistry: false })
  const { data: tables = [] } = useTablesList(workspaceId)
  const { data: files = [] } = useWorkspaceFiles(workspaceId)
  const { data: knowledgeBases } = useKnowledgeBasesQuery(workspaceId)

  return useMemo(
    () => [
      {
        type: 'workflow' as const,
        items: workflows.map((w) => ({
          id: w.id,
          name: w.name,
          color: w.color,
          folderId: w.folderId,
          isOpen: existingKeys.has(`workflow:${w.id}`),
        })),
      },
      {
        type: 'table' as const,
        items: tables.map((t) => ({
          id: t.id,
          name: t.name,
          isOpen: existingKeys.has(`table:${t.id}`),
        })),
      },
      {
        type: 'file' as const,
        items: files.map((f) => ({
          id: f.id,
          name: f.name,
          isOpen: existingKeys.has(`file:${f.id}`),
        })),
      },
      {
        type: 'knowledgebase' as const,
        items: (knowledgeBases ?? []).map((kb) => ({
          id: kb.id,
          name: kb.name,
          isOpen: existingKeys.has(`knowledgebase:${kb.id}`),
        })),
      },
    ],
    [workflows, tables, files, knowledgeBases, existingKeys]
  )
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
  const folderWorkflows = workflows.filter((w) => (w.folderId as string | null) === folder.id)
  const isExpanded = expanded.has(folder.id)
  const indent = level * 12

  return (
    <>
      <div
        role='button'
        tabIndex={0}
        onClick={(e) => {
          e.preventDefault()
          onToggle(folder.id)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onToggle(folder.id)
        }}
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
  const folders = useFolderStore((state) => state.folders)
  const getFolderTree = useFolderStore((state) => state.getFolderTree)
  const folderTree = useMemo(
    () => getFolderTree(workspaceId),
    [folders, getFolderTree, workspaceId]
  )
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

export function AddResourceDropdown({
  workspaceId,
  existingKeys,
  onAdd,
  onSwitch,
}: AddResourceDropdownProps) {
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
    (resource: MothershipResource, isOpen?: boolean) => {
      if (isOpen && onSwitch) {
        onSwitch(resource.id)
      } else {
        onAdd(resource)
      }
      setOpen(false)
      setSearch('')
    },
    [onAdd, onSwitch]
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
                    onClick={() => select({ type, id: item.id, title: item.name }, item.isOpen)}
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
                      onSelect={(item) =>
                        select({ type, id: item.id, title: item.name }, item.isOpen)
                      }
                    />
                  ) : items.length > 0 ? (
                    items.map((item) => (
                      <DropdownMenuItem
                        key={item.id}
                        onClick={() => select({ type, id: item.id, title: item.name }, item.isOpen)}
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
