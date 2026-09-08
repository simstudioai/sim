'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemLabel,
  DropdownMenuSearchInput,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT,
  Tooltip,
} from '@sim/emcn'
import { Folder, Plus } from '@sim/emcn/icons'
import { isBrowserAgentAvailable } from '@/lib/browser-agent/transport'
import {
  BROWSER_SESSION_RESOURCE_ID,
  TERMINAL_SESSION_RESOURCE_ID,
} from '@/lib/copilot/resources/types'
import { subscribeDesktopPreferences } from '@/lib/desktop'
import { isTerminalAvailable } from '@/lib/terminal/transport'
import {
  type AvailableItem,
  buildResourceFolderTree,
  type ResourceTreeNode,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-folder-tree'
import { resourceFromItem } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-from-item'
import {
  byResourceMenuOrder,
  getResourceConfig,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import {
  RESOURCE_TAB_ICON_BUTTON_CLASS,
  RESOURCE_TAB_ICON_CLASS,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import { formatDate } from '@/app/workspace/[workspaceId]/logs/utils'
import { listIntegrationsByPopularity } from '@/blocks/integration-matcher'
import { useFolders } from '@/hooks/queries/folders'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useLogsList } from '@/hooks/queries/logs'
import { useMothershipChats } from '@/hooks/queries/mothership-chats'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFileFolders } from '@/hooks/queries/workspace-file-folders'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

export interface AddResourceDropdownProps {
  workspaceId: string
  existingKeys: Set<string>
  onAdd: (resource: MothershipResource) => void
  onOpenExisting?: (resource: MothershipResource) => void
  /**
   * Resource types to hide from the dropdown. Must be referentially stable
   * (a module constant) — it keys the underlying group memo.
   */
  excludeTypes?: readonly MothershipResourceType[]
  /** Delays mounting the menu until a native surface beneath it is hidden. */
  onRequestOpen?: (open: () => void) => void
  /** Restores any native surface hidden for this menu. */
  onClose?: () => Promise<void>
}

interface AvailableItemsByType {
  type: MothershipResourceType
  items: AvailableItem[]
}

/**
 * Table and knowledge-base folder hierarchies. Chat also offers these as folder
 * mentions, while the resource tab picker uses them only for navigation.
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
  /** Chat can attach every folder family, so these lists also gate mention hydration. */
  includeFolderMentions?: boolean
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

/** Hide Radix's still-mounted exit surface before a full-screen effect paints. */
function hideMountedMenuSurfaces(): void {
  for (const menu of document.querySelectorAll<HTMLElement>(
    '[data-native-surface-overlay][role="menu"]'
  )) {
    menu.style.setProperty('visibility', 'hidden', 'important')
  }
}

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
  const browserAvailable = useSyncExternalStore(
    subscribeDesktopPreferences,
    isBrowserAgentAvailable,
    () => false
  )
  const terminalAvailable = useSyncExternalStore(
    subscribeDesktopPreferences,
    isTerminalAvailable,
    () => false
  )
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
  const { data: tableFolders, isPending: tableFoldersPending } = useFolders(workspaceId, {
    enabled: enabled && !excludeTypes?.includes('table'),
    resourceType: 'table',
  })
  const { data: knowledgeBaseFolders, isPending: knowledgeBaseFoldersPending } = useFolders(
    workspaceId,
    {
      enabled: enabled && !excludeTypes?.includes('knowledgebase'),
      resourceType: 'knowledge_base',
    }
  )
  const { data: fileFolders, isPending: fileFoldersPending } = useWorkspaceFileFolders(
    workspaceId,
    'active',
    { enabled }
  )
  const { data: tasks, isPending: tasksPending } = useMothershipChats(workspaceId, { enabled })
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
   * Chat includes table and knowledge-base folders as candidates. Its Enter
   * handling must wait for those lists too, or an unresolved mention can submit.
   */
  const isHydrating =
    enabled &&
    (workflowsPending ||
      tablesPending ||
      filesPending ||
      knowledgeBasesPending ||
      foldersPending ||
      (options?.includeFolderMentions &&
        ((!excludeTypes?.includes('table') && tableFoldersPending) ||
          (!excludeTypes?.includes('knowledgebase') && knowledgeBaseFoldersPending))) ||
      fileFoldersPending ||
      tasksPending ||
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
        items: listIntegrationsByPopularity().map((integration) => ({
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
      /**
       * The chip's `name` keeps the absolute timestamp because it is persisted
       * with the chat, where "2m ago" would age into a lie; the row renders the
       * relative form, which is what reads at a glance. `mentionFamily` is what
       * lets `@logs` reach rows named after their workflow.
       */
      {
        type: 'log' as const,
        items: logs.map((log) => {
          const workflowName = log.workflow?.name ?? log.workflowId ?? 'Unknown'
          const when = formatDate(log.createdAt)
          return {
            id: log.id,
            name: `${workflowName} · ${when.compact}`,
            mentionFamily: getResourceConfig('log').label,
            executionId: log.executionId ?? undefined,
            workflowName,
            time: when.relative,
            status: log.status,
          }
        }),
      },
    ]
    // The live browser panel — desktop app only (needs the agent-browser
    // bridge). There is one top-level panel; repeated launches open inner tabs.
    if (browserAvailable) {
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
    // single top-level panel like the browser.
    if (terminalAvailable) {
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
    return groups.filter((g) => !excluded.has(g.type)).sort(byResourceMenuOrder)
  }, [
    enabled,
    browserAvailable,
    terminalAvailable,
    workflows,
    folders,
    fileFolders,
    tables,
    files,
    knowledgeBases,
    tasks,
    logs,
    excludeTypes,
  ])

  /**
   * Left in source order: `buildResourceFolderTree` orders each level by name,
   * interleaved with the items, matching the Tables and Knowledge pages. These
   * folders carry no user-defined ordering the way workflow folders do.
   */
  const structureFolders = useMemo<StructureFolders>(() => {
    const toFolderItems = (source: typeof tableFolders): AvailableItem[] =>
      (source ?? []).map((f) => ({ id: f.id, name: f.name, parentId: f.parentId ?? null }))
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
   * Offers the folder itself as the first entry of its submenu when selectable.
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
            onClick={() => onSelect(resourceFromItem(type, node.item))}
          >
            {config.renderDropdownItem({ item: node.item })}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuSub key={node.id}>
            <DropdownMenuSubTrigger>
              <Folder className='size-[14px]' />
              <DropdownMenuItemLabel label={node.name} />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {folderType && (
                <DropdownMenuItem
                  onClick={() => onSelect({ type: folderType, id: node.id, title: node.name })}
                >
                  <Folder className='size-[14px]' />
                  <DropdownMenuItemLabel label={node.name} />
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

/**
 * Single source of truth for the foldered submenus. Declared in
 * {@link RESOURCE_MENU_ORDER}; the merge in {@link ResourceMenuSections} is what
 * actually positions them among the flat families, so this order only has to agree
 * with the canonical one rather than carry it.
 */
const FOLDERED_SECTION_SPECS: readonly FolderedSectionSpec[] = [
  { type: 'table', folders: { kind: 'structure', key: 'table' } },
  { type: 'file', folders: { kind: 'group', type: 'filefolder' }, folderType: 'filefolder' },
  { type: 'knowledgebase', folders: { kind: 'structure', key: 'knowledgebase' } },
  { type: 'workflow', folders: { kind: 'group', type: 'folder' }, orderBySortOrder: true },
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
  selectFolders = false,
}: Pick<AvailableResources, 'groups' | 'structureFolders'> & {
  selectFolders?: boolean
}): ResourceTreeSection[] {
  return useMemo(() => {
    const itemsOf = (type: MothershipResourceType) =>
      groups.find((group) => group.type === type)?.items ?? []
    return FOLDERED_SECTION_SPECS.map((spec) => ({
      type: spec.type,
      folderType: spec.folderType ?? (selectFolders ? 'folder' : undefined),
      nodes: buildResourceFolderTree(
        itemsOf(spec.type),
        spec.folders.kind === 'group'
          ? itemsOf(spec.folders.type)
          : structureFolders[spec.folders.key],
        { orderBySortOrder: spec.orderBySortOrder, pruneEmpty: !selectFolders && !spec.folderType }
      ),
    })).filter((section) => section.nodes.length > 0)
  }, [groups, structureFolders, selectFolders])
}

interface ResourceMenuSectionsProps {
  /** Foldered families, from {@link useResourceTreeSections}. */
  sections: ResourceTreeSection[]
  /** Every available family. Foldered ones are taken from `sections` instead. */
  groups: AvailableItemsByType[]
  onSelect: (resource: MothershipResource) => void
  /**
   * Width override for the submenu panels. The chat menu widens them past the
   * canonical 280px and clamps to the viewport so a deep folder path cannot
   * overflow a narrow window.
   */
  subContentClassName?: string
}

/**
 * Renders every resource family as one submenu, foldered and flat interleaved in
 * {@link RESOURCE_MENU_ORDER}. Rendering the two kinds in one pass is what lets a
 * foldered family (Tables) sit above a flat one (Logs) — emitting all the trees
 * and then all the flat families would pin every tree to the top regardless of the
 * canonical order.
 */
export function ResourceMenuSections({
  sections,
  groups,
  onSelect,
  subContentClassName,
}: ResourceMenuSectionsProps) {
  const sectionByType = new Map(sections.map((section) => [section.type, section]))
  const entries = groups
    .filter(({ type, items }) =>
      FOLDERED_RESOURCE_TYPES.has(type) ? sectionByType.has(type) : items.length > 0
    )
    .sort(byResourceMenuOrder)

  return (
    <>
      {entries.map(({ type, items }) => {
        const config = getResourceConfig(type)
        const Icon = config.icon
        const section = sectionByType.get(type)

        // Browser and terminal each have one top-level panel — a flat launcher
        // here creates inner tabs when that panel already exists.
        if (!section && (type === 'browser' || type === 'terminal')) {
          const item = items[0]
          return (
            <DropdownMenuItem key={type} onClick={() => onSelect(resourceFromItem(type, item))}>
              <Icon className='size-[14px]' />
              <DropdownMenuItemLabel label={config.label} />
            </DropdownMenuItem>
          )
        }

        return (
          <DropdownMenuSub key={type}>
            <DropdownMenuSubTrigger>
              <Icon className='size-[14px]' />
              <DropdownMenuItemLabel label={config.label} />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className={subContentClassName}>
              {section ? (
                <ResourceFolderTreeItems
                  nodes={section.nodes}
                  type={section.type}
                  folderType={section.folderType}
                  onSelect={onSelect}
                />
              ) : (
                items.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    onClick={() => onSelect(resourceFromItem(type, item))}
                  >
                    {config.renderDropdownItem({ item })}
                  </DropdownMenuItem>
                ))
              )}
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
  onOpenExisting,
  excludeTypes,
  onRequestOpen,
  onClose,
}: AddResourceDropdownProps) {
  const [open, setOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  // Gated on `open` so an idle tab bar never fetches the workspace lists.
  const { groups: available, structureFolders } = useAvailableResources(workspaceId, {
    enabled: open,
    excludeTypes,
  })
  const treeSections = useResourceTreeSections({ groups: available, structureFolders })
  const hasNativeResourceSurface = isBrowserAgentAvailable() || isTerminalAvailable()
  const closeMenu = useCallback(() => {
    setOpen(false)
    setSearch('')
    setActiveIndex(0)
    return onClose?.() ?? Promise.resolve()
  }, [onClose])

  // This popover is shared by Browser and Terminal and sits above the modal
  // z-layer. Close it inside the pre-paint handshake so resource chrome cannot
  // remain floating over a newly opened full-screen effect.
  useEffect(() => {
    if (!hasNativeResourceSurface) return
    const handlePrepare = () => {
      if (open || contentRef.current) hideMountedMenuSurfaces()
      if (open) void closeMenu()
    }
    window.addEventListener(NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT, handlePrepare)
    return () => window.removeEventListener(NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT, handlePrepare)
  }, [closeMenu, hasNativeResourceSurface, open])

  const handleOpenChange = (next: boolean) => {
    if (next) {
      if (onRequestOpen) {
        onRequestOpen(() => setOpen(true))
      } else {
        setOpen(true)
      }
      return
    }
    void closeMenu()
  }

  const select = (resource: MothershipResource) => {
    void closeMenu().then(() => {
      if (onOpenExisting && existingKeys.has(`${resource.type}:${resource.id}`)) {
        onOpenExisting(resource)
      } else {
        onAdd(resource)
      }
    })
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
        select(resourceFromItem(type, item))
      }
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange} modal={false}>
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
        ref={contentRef}
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
                /* The search box keeps focus, so rows never take DOM focus and the menu's
                   own `focus:` highlight never fires — `activeIndex` is this list's
                   cursor, so it paints the hover surface rather than the selected one. */
                return (
                  <DropdownMenuItem
                    key={`${type}:${item.id}`}
                    className={cn(index === activeIndex && 'bg-[var(--surface-hover)]')}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => select(resourceFromItem(type, item))}
                  >
                    {config.renderDropdownItem({ item })}
                  </DropdownMenuItem>
                )
              })
            ) : (
              <div className='px-2 py-1.5 text-center text-[var(--text-tertiary)] text-caption'>
                No results
              </div>
            )
          ) : (
            <ResourceMenuSections sections={treeSections} groups={available} onSelect={select} />
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
