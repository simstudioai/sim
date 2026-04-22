'use client'

import { useMemo, useState } from 'react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSearchInput,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Tooltip,
} from '@/components/emcn'
import { Folder, Plus } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import {
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
import { useTasks } from '@/hooks/queries/tasks'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

export interface AddResourceDropdownProps {
  workspaceId: string
  existingKeys: Set<string>
  onAdd: (resource: MothershipResource) => void
  onSwitch?: (resourceId: string) => void
  /** Resource types to hide from the dropdown (e.g. `['folder', 'task']`). */
  excludeTypes?: readonly MothershipResourceType[]
}

export type AvailableItem = { id: string; name: string; isOpen?: boolean; [key: string]: unknown }

interface AvailableItemsByType {
  type: MothershipResourceType
  items: AvailableItem[]
}

export function useAvailableResources(
  workspaceId: string,
  existingKeys: Set<string>,
  excludeTypes?: readonly MothershipResourceType[]
): AvailableItemsByType[] {
  const { data: workflows = [] } = useWorkflows(workspaceId)
  const { data: tables = [] } = useTablesList(workspaceId)
  const { data: files = [] } = useWorkspaceFiles(workspaceId)
  const { data: knowledgeBases } = useKnowledgeBasesQuery(workspaceId)
  const { data: folders = [] } = useFolders(workspaceId)
  const { data: tasks = [] } = useTasks(workspaceId)

  return useMemo(() => {
    const excluded = new Set<MothershipResourceType>(excludeTypes ?? [])
    const groups: AvailableItemsByType[] = [
      {
        type: 'workflow' as const,
        items: workflows.map((w) => ({
          id: w.id,
          name: w.name,
          color: w.color,
          folderId: w.folderId ?? null,
          sortOrder: w.sortOrder,
          isOpen: existingKeys.has(`workflow:${w.id}`),
        })),
      },
      {
        type: 'folder' as const,
        items: folders.map((f) => ({
          id: f.id,
          name: f.name,
          parentId: f.parentId ?? null,
          sortOrder: f.sortOrder,
          isOpen: existingKeys.has(`folder:${f.id}`),
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
      {
        type: 'task' as const,
        items: tasks.map((t) => ({
          id: t.id,
          name: t.name,
          isOpen: existingKeys.has(`task:${t.id}`),
        })),
      },
    ]
    return groups.filter((g) => !excluded.has(g.type))
  }, [workflows, folders, tables, files, knowledgeBases, tasks, existingKeys, excludeTypes])
}

export type WorkflowTreeNode =
  | { kind: 'workflow'; id: string; name: string; color: string; isOpen?: boolean }
  | { kind: 'folder'; id: string; name: string; children: WorkflowTreeNode[] }

export function buildWorkflowFolderTree(
  workflowItems: AvailableItem[],
  folderItems: AvailableItem[]
): WorkflowTreeNode[] {
  const knownFolderIds = new Set(folderItems.map((f) => f.id))

  const byFolder = new Map<string | null, AvailableItem[]>()
  for (const w of workflowItems) {
    const fid = (w.folderId as string | null | undefined) ?? null
    const key = fid && knownFolderIds.has(fid) ? fid : null
    const bucket = byFolder.get(key) ?? []
    bucket.push(w)
    byFolder.set(key, bucket)
  }

  const toWorkflowNode = (w: AvailableItem): WorkflowTreeNode => ({
    kind: 'workflow',
    id: w.id,
    name: w.name,
    color: (w.color as string) ?? '#808080',
    isOpen: w.isOpen,
  })

  const buildLevel = (parentId: string | null): WorkflowTreeNode[] => {
    const childFolders = folderItems.filter(
      (f) => ((f.parentId as string | null | undefined) ?? null) === parentId
    )
    const childWorkflows = byFolder.get(parentId) ?? []

    const mixed: Array<{ sortOrder: number; id: string; node: WorkflowTreeNode }> = []

    for (const f of childFolders) {
      const children = buildLevel(f.id)
      if (children.length === 0) continue
      mixed.push({
        sortOrder: (f.sortOrder as number) ?? 0,
        id: f.id,
        node: { kind: 'folder', id: f.id, name: f.name, children },
      })
    }

    for (const w of childWorkflows) {
      mixed.push({
        sortOrder: (w.sortOrder as number) ?? 0,
        id: w.id,
        node: toWorkflowNode(w),
      })
    }

    mixed.sort((a, b) =>
      a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.id.localeCompare(b.id)
    )
    return mixed.map((m) => m.node)
  }

  return buildLevel(null)
}

interface WorkflowFolderTreeItemsProps {
  nodes: WorkflowTreeNode[]
  onSelect: (resource: MothershipResource, isOpen?: boolean) => void
}

export function WorkflowFolderTreeItems({ nodes, onSelect }: WorkflowFolderTreeItemsProps) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === 'workflow' ? (
          <DropdownMenuItem
            key={node.id}
            onClick={() =>
              onSelect({ type: 'workflow', id: node.id, title: node.name }, node.isOpen)
            }
          >
            {getResourceConfig('workflow').renderDropdownItem({
              item: { id: node.id, name: node.name, color: node.color },
            })}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuSub key={node.id}>
            <DropdownMenuSubTrigger>
              <Folder className='h-[14px] w-[14px]' />
              <span>{node.name}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <WorkflowFolderTreeItems nodes={node.children} onSelect={onSelect} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )
      )}
    </>
  )
}

export function AddResourceDropdown({
  workspaceId,
  existingKeys,
  onAdd,
  onSwitch,
  excludeTypes,
}: AddResourceDropdownProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const available = useAvailableResources(workspaceId, existingKeys, excludeTypes)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setSearch('')
      setActiveIndex(0)
    }
  }

  const select = (resource: MothershipResource, isOpen?: boolean) => {
    if (isOpen && onSwitch) {
      onSwitch(resource.id)
    } else {
      onAdd(resource)
    }
    setOpen(false)
    setSearch('')
    setActiveIndex(0)
  }

  const workflowTree = useMemo(() => {
    const workflowGroup = available.find((g) => g.type === 'workflow')
    const folderGroup = available.find((g) => g.type === 'folder')
    return buildWorkflowFolderTree(workflowGroup?.items ?? [], folderGroup?.items ?? [])
  }, [available])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return null
    return available.flatMap(({ type, items }) =>
      items.filter((item) => item.name.toLowerCase().includes(q)).map((item) => ({ type, item }))
    )
  }, [search, available])

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!filtered) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      if (filtered.length > 0 && filtered[activeIndex]) {
        e.preventDefault()
        const { type, item } = filtered[activeIndex]
        select({ type, id: item.id, title: item.name }, item.isOpen)
      }
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant='subtle'
              className={RESOURCE_TAB_ICON_BUTTON_CLASS}
              aria-label='Add resource tab'
            >
              <Plus className={RESOURCE_TAB_ICON_CLASS} />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>Add resource</p>
        </Tooltip.Content>
      </Tooltip.Root>
      <DropdownMenuContent
        align='start'
        sideOffset={8}
        className='flex w-[320px] flex-col overflow-hidden'
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuSearchInput
          placeholder='Search resources...'
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={handleSearchKeyDown}
        />
        <div className='min-h-0 flex-1 overflow-y-auto'>
          {filtered ? (
            filtered.length > 0 ? (
              filtered.map(({ type, item }, index) => {
                const config = getResourceConfig(type)
                return (
                  <DropdownMenuItem
                    key={`${type}:${item.id}`}
                    className={cn(index === activeIndex && 'bg-[var(--surface-active)]')}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => select({ type, id: item.id, title: item.name }, item.isOpen)}
                  >
                    {config.renderDropdownItem({ item })}
                  </DropdownMenuItem>
                )
              })
            ) : (
              <div className='px-2 py-1.5 text-center font-medium text-[var(--text-tertiary)] text-caption'>
                No results
              </div>
            )
          ) : (
            <>
              {workflowTree.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <div
                      className='h-[14px] w-[14px] flex-shrink-0 rounded-[3px] border-[2px]'
                      style={{
                        backgroundColor: '#808080',
                        borderColor: '#80808060',
                        backgroundClip: 'padding-box',
                      }}
                    />
                    <span>Workflows</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <WorkflowFolderTreeItems nodes={workflowTree} onSelect={select} />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {available.map(({ type, items }) => {
                if (type === 'workflow' || type === 'folder') return null
                if (items.length === 0) return null
                const config = getResourceConfig(type)
                const Icon = config.icon
                return (
                  <DropdownMenuSub key={type}>
                    <DropdownMenuSubTrigger>
                      <Icon className='h-[14px] w-[14px]' />
                      <span>{config.label}</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {items.map((item) => (
                        <DropdownMenuItem
                          key={item.id}
                          onClick={() =>
                            select({ type, id: item.id, title: item.name }, item.isOpen)
                          }
                        >
                          {config.renderDropdownItem({ item })}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )
              })}
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
