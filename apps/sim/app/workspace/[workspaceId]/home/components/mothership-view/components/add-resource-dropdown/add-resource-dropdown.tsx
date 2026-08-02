'use client'

import { useMemo, useState } from 'react'
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSearchInput,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Tooltip,
} from '@sim/emcn'
import { Folder, Plus } from '@sim/emcn/icons'
import { truncate } from '@sim/utils/string'
import { isBrowserAgentAvailable } from '@/lib/browser-agent/transport'
import {
  BROWSER_SESSION_RESOURCE_ID,
  TERMINAL_SESSION_RESOURCE_ID,
} from '@/lib/copilot/resources/types'
import { isTerminalAvailable } from '@/lib/terminal/transport'
import {
  type AvailableItem,
  buildResourceFolderTree,
  type ResourceTreeNode,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-folder-tree'
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

export interface AddResourceDropdownProps {
  workspaceId: string
  existingKeys: Set<string>
  onAdd: (resource: MothershipResource) => void
  onSwitch?: (resourceId: string) => void
  /**
   * Resource types to hide from the dropdown. Must be referentially stable
   * (a module constant) — it keys the underlying group memo.
   */
  excludeTypes?: readonly MothershipResourceType[]
}

interface AvailableItemsByType {
  type: MothershipResourceType
  items: AvailableItem[]
}

/**
 * Folder hierarchies that exist purely to structure the browse menus. Unlike
 * workflow (`folder`) and workspace-file (`filefolder`) folders these are not
 * attachable resources, so they stay out of `groups` — which also feeds the
 * flat search results, where a non-attachable row would be a dead end.
 */
interface StructureFolders {
  table: AvailableItem[]
  knowledgebase: AvailableItem[]
}

interface AvailableResources {
  groups: AvailableItemsByType[]
  structureFolders: StructureFolders
  /**
   * True while enabled and at least one list has yet to produce data. Callers
   * that act on "no candidates" must check this first — an empty result during
   * hydration means "not known yet", not "no match".
   */
  isHydrating: boolean
}

interface UseAvailableResourcesOptions {
  /**
   * Skips the underlying list queries and the group construction they feed
   * while `false`, returning a stable empty result. Menus pass their own open
   * state so a closed one costs nothing; the lists fetch on first open.
   *
   * Note this only defers the lists nothing else on the surface already needs —
   * the mothership tab bar independently resolves tab names from the workflow,
   * table, file, knowledge-base, and folder lists, so those stay warm there.
   */
  enabled?: boolean
  /**
   * Resource types to omit from the result. Must be referentially stable
   * (a module constant) — it keys the group memo.
   */
  excludeTypes?: readonly MothershipResourceType[]
}

/** Stable identity for the disabled result, so downstream memos never bust. */
const NO_RESOURCE_GROUPS: AvailableItemsByType[] = []

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
  options?: UseAvailableResourcesOptions
): AvailableResources {
  const enabled = options?.enabled ?? true
  const excludeTypes = options?.excludeTypes
  // Destructured without `= []` defaults on purpose: a literal default allocates a
  // fresh array every render while `data` is undefined (exactly the disabled state),
  // which would bust the group memo below on every render. Undefined is stable.
  const { data: workflows, isPending: workflowsPending } = useWorkflows(workspaceId, { enabled })
  const { data: tables, isPending: tablesPending } = useTablesList(workspaceId, 'active', {
    enabled,
  })
  const { data: files, isPending: filesPending } = useWorkspaceFiles(workspaceId, 'active', {
    enabled,
  })
  const { data: knowledgeBases, isPending: knowledgeBasesPending } = useKnowledgeBasesQuery(
    workspaceId,
    { enabled }
  )
  const { data: folders, isPending: foldersPending } = useFolders(workspaceId, { enabled })
  // Folder lists exist only to shape their family's submenu, so they skip the
  // fetch entirely when that family is excluded.
  const { data: tableFolders } = useFolders(workspaceId, {
    enabled: enabled && !excludeTypes?.includes('table'),
    resourceType: 'table',
  })
  const { data: knowledgeBaseFolders } = useFolders(workspaceId, {
    enabled: enabled && !excludeTypes?.includes('knowledgebase'),
    resourceType: 'knowledge_base',
  })
  const { data: fileFolders, isPending: fileFoldersPending } = useWorkspaceFileFolders(
    workspaceId,
    'active',
    { enabled }
  )
  const { data: tasks, isPending: tasksPending } = useMothershipChats(workspaceId, { enabled })
  const { data: schedules, isPending: schedulesPending } = useWorkspaceSchedules(workspaceId, {
    enabled,
  })
  const { data: logsData, isPending: logsPending } = useLogsList(
    workspaceId,
    LOG_DROPDOWN_FILTERS,
    { enabled }
  )
  const logs = useMemo(() => (logsData?.pages ?? []).flatMap((page) => page.logs), [logsData])

  /**
   * Keyed off `isPending` rather than `data === undefined` so a failed list
   * settles to "not hydrating" — an errored query must not block the caller
   * forever.
   *
   * Only the lists feeding `groups` count. The table and knowledge-base folder
   * lists shape submenus but never add candidates, so gating on them would
   * swallow an `@`-mention Enter behind two round-trips that cannot change the
   * answer.
   */
  const isHydrating =
    enabled &&
    (workflowsPending ||
      tablesPending ||
      filesPending ||
      knowledgeBasesPending ||
      foldersPending ||
      fileFoldersPending ||
      tasksPending ||
      schedulesPending ||
      logsPending)

  const groups = useMemo(() => {
    if (!enabled) return NO_RESOURCE_GROUPS
    const excluded = new Set<MothershipResourceType>(excludeTypes ?? [])
    const groups: AvailableItemsByType[] = [
      {
        type: 'workflow' as const,
        items: (workflows ?? []).map((w) => ({
          id: w.id,
          name: w.name,
          folderId: w.folderId ?? null,
          sortOrder: w.sortOrder,
        })),
      },
      {
        type: 'folder' as const,
        items: (folders ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          parentId: f.parentId ?? null,
          sortOrder: f.sortOrder,
        })),
      },
      {
        type: 'table' as const,
        items: (tables ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          folderId: t.folderId ?? null,
        })),
      },
      {
        type: 'file' as const,
        items: (files ?? []).map((f) => ({ id: f.id, name: f.name, folderId: f.folderId ?? null })),
      },
      {
        type: 'filefolder' as const,
        items: (fileFolders ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          parentId: f.parentId ?? null,
        })),
      },
      {
        type: 'knowledgebase' as const,
        items: (knowledgeBases ?? []).map((kb) => ({
          id: kb.id,
          name: kb.name,
          folderId: kb.folderId ?? null,
        })),
      },
      {
        type: 'integration' as const,
        items: listIntegrations().map((integration) => ({
          id: integration.blockType,
          name: integration.name,
          iconComponent: integration.icon,
          bgColor: integration.bgColor,
        })),
      },
      {
        type: 'task' as const,
        items: (tasks ?? []).map((t) => ({ id: t.id, name: t.name })),
      },
      {
        type: 'scheduledtask' as const,
        items: (schedules ?? [])
          .filter((s) => s.sourceType === 'job')
          .map((s) => ({
            id: s.id,
            name: s.jobTitle || truncate(s.prompt ?? '', 40) || 'Scheduled Task',
          })),
      },
      {
        type: 'log' as const,
        items: logs.map((log) => {
          const workflowName = log.workflow?.name ?? log.workflowId ?? 'Unknown'
          const time = formatDate(log.createdAt).compact
          return { id: log.id, name: `${workflowName} · ${time}`, workflowName, time }
        }),
      },
    ]
    // The live browser panel — desktop app only (needs the agent-browser
    // bridge). A singleton: opening it again just activates the existing tab.
    if (isBrowserAgentAvailable()) {
      groups.push({
        type: 'browser' as const,
        items: [
          {
            id: BROWSER_SESSION_RESOURCE_ID,
            name: 'Browser',
          },
        ],
      })
    }
    // The live terminal — desktop app only (needs the PTY bridge), and a
    // singleton like the browser.
    if (isTerminalAvailable()) {
      groups.push({
        type: 'terminal' as const,
        items: [
          {
            id: TERMINAL_SESSION_RESOURCE_ID,
            name: 'Terminal',
          },
        ],
      })
    }
    return groups.filter((g) => !excluded.has(g.type))
  }, [
    enabled,
    workflows,
    folders,
    fileFolders,
    tables,
    files,
    knowledgeBases,
    tasks,
    schedules,
    logs,
    excludeTypes,
  ])

  /**
   * Sorted by name to match how the Tables and Knowledge pages order folders —
   * the list endpoint makes no ordering guarantee, and these folders carry no
   * user-defined ordering the way workflow folders do.
   */
  const structureFolders = useMemo<StructureFolders>(() => {
    const toFolderItems = (source: typeof tableFolders): AvailableItem[] =>
      (source ?? [])
        .map((f) => ({ id: f.id, name: f.name, parentId: f.parentId ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name))
    return {
      table: toFolderItems(tableFolders),
      knowledgebase: toFolderItems(knowledgeBaseFolders),
    }
  }, [tableFolders, knowledgeBaseFolders])

  // `groups` and `structureFolders` keep their own stable identities so the
  // consumers' downstream memos still key on them; only this wrapper changes
  // when hydration settles.
  return useMemo(
    () => ({ groups, structureFolders, isHydrating }),
    [groups, structureFolders, isHydrating]
  )
}

interface ResourceFolderTreeItemsProps {
  nodes: ResourceTreeNode[]
  /** Resource type of the leaf items. */
  type: MothershipResourceType
  /**
   * Set when the folder is itself an attachable resource (workspace files): the
   * folder is then offered as the first entry of its own submenu. Omitted for
   * folders that only provide structure (workflows, tables, knowledge bases).
   */
  folderType?: MothershipResourceType
  onSelect: (resource: MothershipResource) => void
}

/** Renders a {@link buildResourceFolderTree} result as nested dropdown submenus. */
export function ResourceFolderTreeItems({
  nodes,
  type,
  folderType,
  onSelect,
}: ResourceFolderTreeItemsProps) {
  const config = getResourceConfig(type)
  return (
    <>
      {nodes.map((node) =>
        node.kind === 'item' ? (
          <DropdownMenuItem
            key={node.id}
            onClick={() => onSelect({ type, id: node.id, title: node.item.name })}
          >
            {config.renderDropdownItem({ item: node.item })}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuSub key={node.id}>
            <DropdownMenuSubTrigger>
              <Folder className='size-[14px]' />
              <span>{node.name}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {folderType && (
                <DropdownMenuItem
                  onClick={() => onSelect({ type: folderType, id: node.id, title: node.name })}
                >
                  <Folder className='size-[14px]' />
                  <span>{node.name}</span>
                </DropdownMenuItem>
              )}
              <ResourceFolderTreeItems
                nodes={node.children}
                type={type}
                folderType={folderType}
                onSelect={onSelect}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )
      )}
    </>
  )
}

interface FolderedSectionSpec {
  /** Leaf resource type — also supplies the submenu's label and icon. */
  type: MothershipResourceType
  /**
   * Where this family's folders come from: another entry in `groups` when the
   * folders are attachable resources, or `structureFolders` when they are not.
   */
  folders:
    | { kind: 'group'; type: MothershipResourceType }
    | { kind: 'structure'; key: keyof StructureFolders }
  /**
   * Set when the folder is itself attachable. Doubles as the pruning rule: a
   * folder the user cannot select is dead UI when empty, while a selectable one
   * must stay reachable.
   */
  folderType?: MothershipResourceType
  /** Interleave folders and items by `sortOrder` — the workflow sidebar's manual ordering. */
  orderBySortOrder?: boolean
}

/** Single source of truth for the foldered submenus, in display order. */
const FOLDERED_SECTION_SPECS: readonly FolderedSectionSpec[] = [
  { type: 'workflow', folders: { kind: 'group', type: 'folder' }, orderBySortOrder: true },
  { type: 'file', folders: { kind: 'group', type: 'filefolder' }, folderType: 'filefolder' },
  { type: 'table', folders: { kind: 'structure', key: 'table' } },
  { type: 'knowledgebase', folders: { kind: 'structure', key: 'knowledgebase' } },
]

/**
 * Every resource type the foldered submenus already render, derived from the
 * specs so a new family cannot be added to one list and missed in the other —
 * which would render it twice, once as a submenu and again in the flat tail.
 */
export const FOLDERED_RESOURCE_TYPES = new Set<MothershipResourceType>(
  FOLDERED_SECTION_SPECS.flatMap((spec) =>
    spec.folders.kind === 'group' ? [spec.type, spec.folders.type] : [spec.type]
  )
)

export interface ResourceTreeSection {
  type: MothershipResourceType
  folderType?: MothershipResourceType
  nodes: ResourceTreeNode[]
}

/**
 * Builds the foldered submenus every browse menu shares, in display order and
 * with empty families dropped.
 */
export function useResourceTreeSections({
  groups,
  structureFolders,
}: Pick<AvailableResources, 'groups' | 'structureFolders'>): ResourceTreeSection[] {
  return useMemo(() => {
    const itemsOf = (type: MothershipResourceType) =>
      groups.find((group) => group.type === type)?.items ?? []
    return FOLDERED_SECTION_SPECS.map((spec) => ({
      type: spec.type,
      folderType: spec.folderType,
      nodes: buildResourceFolderTree(
        itemsOf(spec.type),
        spec.folders.kind === 'group'
          ? itemsOf(spec.folders.type)
          : structureFolders[spec.folders.key],
        { orderBySortOrder: spec.orderBySortOrder, pruneEmpty: !spec.folderType }
      ),
    })).filter((section) => section.nodes.length > 0)
  }, [groups, structureFolders])
}

interface ResourceTreeSectionsProps {
  sections: ResourceTreeSection[]
  onSelect: (resource: MothershipResource) => void
  /**
   * Width override for the submenu panels. The chat menu widens them past the
   * canonical 280px and clamps to the viewport so a deep folder path cannot
   * overflow a narrow window.
   */
  subContentClassName?: string
}

/** Renders {@link useResourceTreeSections} output as one submenu per family. */
export function ResourceTreeSections({
  sections,
  onSelect,
  subContentClassName,
}: ResourceTreeSectionsProps) {
  return (
    <>
      {sections.map((section) => {
        const config = getResourceConfig(section.type)
        const SectionIcon = config.icon
        return (
          <DropdownMenuSub key={section.type}>
            <DropdownMenuSubTrigger>
              <SectionIcon className='size-[14px]' />
              <span>{config.label}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className={subContentClassName}>
              <ResourceFolderTreeItems
                nodes={section.nodes}
                type={section.type}
                folderType={section.folderType}
                onSelect={onSelect}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )
      })}
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
  // Gated on `open` so an idle tab bar never fetches the workspace lists.
  const { groups: available, structureFolders } = useAvailableResources(workspaceId, {
    enabled: open,
    excludeTypes,
  })
  const treeSections = useResourceTreeSections({ groups: available, structureFolders })
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setSearch('')
      setActiveIndex(0)
    }
  }

  const select = (resource: MothershipResource) => {
    if (onSwitch && existingKeys.has(`${resource.type}:${resource.id}`)) {
      onSwitch(resource.id)
    } else {
      onAdd(resource)
    }
    setOpen(false)
    setSearch('')
    setActiveIndex(0)
  }

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
        select({ type, id: item.id, title: item.name })
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
                    onClick={() => select({ type, id: item.id, title: item.name })}
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
              <ResourceTreeSections sections={treeSections} onSelect={select} />
              {available.map(({ type, items }) => {
                if (FOLDERED_RESOURCE_TYPES.has(type)) return null
                if (items.length === 0) return null
                const config = getResourceConfig(type)
                const Icon = config.icon
                // The browser and terminal panels are singletons — flat
                // items, not one-entry submenus.
                if (type === 'browser' || type === 'terminal') {
                  const item = items[0]
                  return (
                    <DropdownMenuItem
                      key={type}
                      onClick={() => select({ type, id: item.id, title: item.name })}
                    >
                      <Icon className='size-[14px]' />
                      <span>{config.label}</span>
                    </DropdownMenuItem>
                  )
                }
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
                          onClick={() => select({ type, id: item.id, title: item.name })}
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
