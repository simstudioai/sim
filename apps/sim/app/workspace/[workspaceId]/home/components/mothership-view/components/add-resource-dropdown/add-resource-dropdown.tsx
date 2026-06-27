'use client'

import { useMemo, useState } from 'react'
import { truncate } from '@sim/utils/string'
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
import { Folder, Plus, Workflow } from '@/components/emcn/icons'
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
import { formatDate } from '@/app/workspace/[workspaceId]/logs/utils'
import { listIntegrations } from '@/blocks/integration-matcher'
import { useFolders } from '@/hooks/queries/folders'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useLogsList } from '@/hooks/queries/logs'
import { useMothershipChats } from '@/hooks/queries/mothership-chats'
import { useWorkspaceSchedules } from '@/hooks/queries/schedules'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFileFolders } from '@/hooks/queries/workspace-file-folders'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useTranslations } from 'next-intl'

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

const LOG_DROPDOWN_LIMIT = 50

const LOG_DROPDOWN_FILTERS = {
  timeRange: 'All time' as const,
  level: 'all',
  workflowIds: [] as string[],
  folderIds: [] as string[],
  triggers: [] as string[],
  searchQuery: '',
  limit: LOG_DROPDOWN_LIMIT,
  sortBy: 'date' as const,
  sortOrder: 'desc' as const,
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
  const { data: fileFolders = [] } = useWorkspaceFileFolders(workspaceId)
  const { data: tasks = [] } = useMothershipChats(workspaceId)
  const { data: schedules = [] } = useWorkspaceSchedules(workspaceId)
  const { data: logsData } = useLogsList(workspaceId, LOG_DROPDOWN_FILTERS)
  const logs = useMemo(() => (logsData?.pages ?? []).flatMap((page) => page.logs), [logsData])

  return useMemo(() => {
    const excluded = new Set<MothershipResourceType>(excludeTypes ?? [])
    const groups: AvailableItemsByType[] = [
      {
        type: 'workflow' as const,
        items: workflows.map((w) => ({
          id: w.id,
          name: w.name,
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
          folderId: f.folderId ?? null,
          isOpen: existingKeys.has(`file:${f.id}`),
        })),
      },
      {
        type: 'filefolder' as const,
        items: fileFolders.map((f) => ({
          id: f.id,
          name: f.name,
          parentId: f.parentId ?? null,
          isOpen: existingKeys.has(`filefolder:${f.id}`),
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
        type: 'integration' as const,
        items: listIntegrations().map((integration) => ({
          id: integration.blockType,
          name: integration.name,
          iconComponent: integration.icon,
          bgColor: integration.bgColor,
          isOpen: existingKeys.has(`integration:${integration.blockType}`),
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
      {
        type: 'scheduledtask' as const,
        items: schedules
          .filter((s) => s.sourceType === 'job')
          .map((s) => ({
            id: s.id,
            name: s.jobTitle || truncate(s.prompt ?? '', 40) || 'Scheduled Task',
            isOpen: existingKeys.has(`scheduledtask:${s.id}`),
          })),
      },
      {
        type: 'log' as const,
        items: logs.map((log) => {
          const workflowName = log.workflow?.name ?? log.workflowId ?? 'Unknown'
          const time = formatDate(log.createdAt).compact
          return {
            id: log.id,
            name: `${workflowName} · ${time}`,
            workflowName,
            time,
            isOpen: existingKeys.has(`log:${log.id}`),
          }
        }),
      },
    ]
    return groups.filter((g) => !excluded.has(g.type))
  }, [
    workflows,
    folders,
    fileFolders,
    tables,
    files,
    knowledgeBases,
    tasks,
    schedules,
    logs,
    existingKeys,
    excludeTypes,
  ])
}

export type WorkflowTreeNode =
  | { kind: 'workflow'; id: string; name: string; isOpen?: boolean }
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
              item: { id: node.id, name: node.name },
            })}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuSub key={node.id}>
            <DropdownMenuSubTrigger>
              <Folder className='size-[14px]' />
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

export type FileFolderTreeNode =
  | { kind: 'file'; id: string; name: string; isOpen?: boolean }
  | { kind: 'folder'; id: string; name: string; isOpen?: boolean; children: FileFolderTreeNode[] }

export function buildFileFolderTree(
  fileItems: AvailableItem[],
  folderItems: AvailableItem[]
): FileFolderTreeNode[] {
  const byFolder = new Map<string | null, AvailableItem[]>()
  for (const f of fileItems) {
    const key = (f.folderId as string | null | undefined) ?? null
    const bucket = byFolder.get(key) ?? []
    bucket.push(f)
    byFolder.set(key, bucket)
  }

  const buildLevel = (parentId: string | null): FileFolderTreeNode[] => {
    const childFolders = folderItems.filter(
      (f) => ((f.parentId as string | null | undefined) ?? null) === parentId
    )
    const childFiles = byFolder.get(parentId) ?? []
    const nodes: FileFolderTreeNode[] = []
    for (const folder of childFolders) {
      const children = buildLevel(folder.id)
      nodes.push({
        kind: 'folder',
        id: folder.id,
        name: folder.name,
        isOpen: folder.isOpen,
        children,
      })
    }
    for (const file of childFiles) {
      nodes.push({ kind: 'file', id: file.id, name: file.name, isOpen: file.isOpen })
    }
    return nodes
  }

  return buildLevel(null)
}

interface FileFolderTreeItemsProps {
  nodes: FileFolderTreeNode[]
  onSelect: (resource: MothershipResource, isOpen?: boolean) => void
}

export function FileFolderTreeItems({ nodes, onSelect }: FileFolderTreeItemsProps) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === 'file' ? (
          <DropdownMenuItem
            key={node.id}
            onClick={() => onSelect({ type: 'file', id: node.id, title: node.name }, node.isOpen)}
          >
            {getResourceConfig('file').renderDropdownItem({
              item: { id: node.id, name: node.name },
            })}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuSub key={node.id}>
            <DropdownMenuSubTrigger>
              <Folder className='size-[14px]' />
              <span>{node.name}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                onClick={() =>
                  onSelect({ type: 'filefolder', id: node.id, title: node.name }, node.isOpen)
                }
              >
                <Folder className='size-[14px]' />
                <span>{node.name}</span>
              </DropdownMenuItem>
              {node.children.length > 0 && (
                <FileFolderTreeItems nodes={node.children} onSelect={onSelect} />
              )}
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
  const t = useTranslations('auto')
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const available = useAvailableResources(workspaceId, existingKeys, [
    ...(excludeTypes ?? []),
    'integration',
  ])
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

  const fileFolderTree = useMemo(() => {
    const fileGroup = available.find((g) => g.type === 'file')
    const fileFolderGroup = available.find((g) => g.type === 'filefolder')
    return buildFileFolderTree(fileGroup?.items ?? [], fileFolderGroup?.items ?? [])
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
              aria-label={t('add_resource_tab')}
            >
              <Plus className={RESOURCE_TAB_ICON_CLASS} />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>{t('add_resource')}</p>
        </Tooltip.Content>
      </Tooltip.Root>
      <DropdownMenuContent
        align='start'
        sideOffset={8}
        className='flex w-[320px] flex-col overflow-hidden'
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuSearchInput
          placeholder={t('search_resources')}
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
                {t('no_results')}
              </div>
            )
          ) : (
            <>
              {workflowTree.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Workflow className='size-[14px]' />
                    <span>{t('workflows')}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <WorkflowFolderTreeItems nodes={workflowTree} onSelect={select} />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {fileFolderTree.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    {(() => {
                      const Icon = getResourceConfig('file').icon
                      return <Icon className='size-[14px]' />
                    })()}
                    <span>{t('files')}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <FileFolderTreeItems nodes={fileFolderTree} onSelect={select} />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {available.map(({ type, items }) => {
                if (
                  type === 'workflow' ||
                  type === 'folder' ||
                  type === 'file' ||
                  type === 'filefolder'
                )
                  return null
                if (items.length === 0) return null
                const config = getResourceConfig(type)
                const Icon = config.icon
                return (
                  <DropdownMenuSub key={type}>
                    <DropdownMenuSubTrigger>
                      <Icon className='size-[14px]' />
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
