'use client'

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemLabel,
  DropdownMenuLabel,
  DropdownMenuSearchInput,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT,
  OverflowText,
  TabStripAction,
  Tooltip,
} from '@sim/emcn'
import { Folder, Plus } from '@sim/emcn/icons'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import type { Project } from '@/lib/api/contracts/projects'
import { isBrowserAgentAvailable } from '@/lib/browser-agent/transport'
import { getChatResourceKey } from '@/lib/mothership/resources/types'
import { isTerminalAvailable } from '@/lib/terminal/transport'
import { getWorkspaceInitial } from '@/lib/workspaces/initials'
import {
  type AvailableItemsByType,
  type AvailableResources,
  BROWSER_LAUNCHER_ID,
  type StructureFolders,
  TERMINAL_LAUNCHER_ID,
  useAvailableResources,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/available-resources'
import {
  mergeOrganizationResourceInventories,
  OrganizationResourceInventory,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/organization-resource-inventory'
import {
  useAvailableProjectInventories,
  useAvailableProjectResources,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/project-resources'
import {
  buildResourceFolderTree,
  type ResourceTreeNode,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-folder-tree'
import { resourceFromItem } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-from-item'
import {
  byResourceMenuOrder,
  getResourceConfig,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import { RESOURCE_TAB_ICON_CLASS } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'
import { resourceMentionMatches } from '@/app/workspace/[workspaceId]/home/components/user-input/components/plus-menu-dropdown/resource-mention-items'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { useProjectInventory } from '@/hooks/queries/projects'
import { useOrderedWorkspacesQuery, type Workspace } from '@/hooks/queries/workspace'

export interface AddResourceDropdownProps {
  workspaceId?: string
  organizationId?: string
  onAdd: (resource: MothershipResource) => void
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

/** Hide Radix's still-mounted exit surface before a full-screen effect paints. */
function hideMountedMenuSurfaces(): void {
  for (const menu of document.querySelectorAll<HTMLElement>(
    '[data-native-surface-overlay][role="menu"]'
  )) {
    menu.style.setProperty('visibility', 'hidden', 'important')
  }
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
  subContentClassName?: string
}

/** Renders a {@link buildResourceFolderTree} result as nested dropdown submenus. */
export function ResourceFolderTreeItems({
  nodes,
  type,
  folderType,
  onSelect,
  subContentClassName,
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
            <DropdownMenuSubContent className={subContentClassName}>
              {folderType && node.selectable !== false && (
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
                subContentClassName={subContentClassName}
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
          ? [...itemsOf(spec.folders.type), ...(spec.type === 'file' ? structureFolders.file : [])]
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

        // The Browser and Terminal launchers are flat rows that open a new page
        // or shell. Live pages and shells offered as context are an ordinary
        // picker submenu.
        if (
          !section &&
          (items[0]?.id === BROWSER_LAUNCHER_ID || items[0]?.id === TERMINAL_LAUNCHER_ID)
        ) {
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
                  subContentClassName={subContentClassName}
                />
              ) : (
                items.map((item) => (
                  <DropdownMenuItem
                    key={getChatResourceKey(resourceFromItem(type, item))}
                    onClick={() => onSelect(resourceFromItem(type, item))}
                  >
                    {config.renderDropdownItem({ item })}
                    {typeof (item.projectName ?? item.workspaceName) === 'string' && (
                      <OverflowText
                        label={String(item.projectName ?? item.workspaceName)}
                        className='ml-auto max-w-[35%] shrink-0 text-[var(--text-muted)] text-xs'
                      />
                    )}
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

interface ResourceMenuSearchProps {
  groups: AvailableItemsByType[]
  isHydrating?: boolean
  children: ReactNode
  onSelect: (resource: MothershipResource) => void
}

function ResourceMenuSearch({
  groups: available,
  isHydrating,
  children,
  onSelect: select,
}: ResourceMenuSearchProps) {
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return null
    return available.flatMap(({ type, items }) =>
      items.filter((item) => resourceMentionMatches(item, q)).map((item) => ({ type, item }))
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
    <>
      <DropdownMenuSearchInput
        placeholder='Search resources'
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
                  key={getChatResourceKey(resourceFromItem(type, item))}
                  className={cn(index === activeIndex && 'bg-[var(--surface-hover)]')}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => select(resourceFromItem(type, item))}
                >
                  {config.renderDropdownItem({ item })}
                  {typeof (item.projectName ?? item.workspaceName) === 'string' && (
                    <OverflowText
                      label={String(item.projectName ?? item.workspaceName)}
                      className='ml-auto max-w-[35%] shrink-0 text-[var(--text-muted)] text-xs'
                    />
                  )}
                </DropdownMenuItem>
              )
            })
          ) : (
            <div className='px-2 py-1.5 text-center text-[var(--text-tertiary)] text-caption'>
              {isHydrating ? 'Loading resources' : 'No results'}
            </div>
          )
        ) : (
          children
        )}
      </div>
    </>
  )
}

interface WorkspaceResourceMenuContentProps {
  workspaceId: string
  enabled: boolean
  excludeTypes?: readonly MothershipResourceType[]
  searchable?: boolean
  includeProjectFiles?: boolean
  /** Offers every folder as an attachable entry, as chat does. */
  selectFolders?: boolean
  onSelect: (resource: MothershipResource) => void
  subContentClassName?: string
}

function WorkspaceResourceMenuContent({
  workspaceId,
  enabled,
  excludeTypes,
  searchable = true,
  includeProjectFiles,
  selectFolders,
  onSelect,
  subContentClassName,
}: WorkspaceResourceMenuContentProps) {
  const { groups, structureFolders, isHydrating } = useAvailableResources(workspaceId, {
    enabled,
    excludeTypes,
    includeProjectFiles,
  })
  const sections = useResourceTreeSections({ groups, structureFolders, selectFolders })
  const select = (resource: MothershipResource) =>
    onSelect(
      resource.type === 'browser' ||
        resource.type === 'terminal' ||
        resource.owner?.entityType === 'project'
        ? resource
        : { ...resource, workspaceId }
    )
  /** Lists fill in as they load, so a trailing row keeps a loading workspace from reading as empty. */
  const menu = (
    <>
      <ResourceMenuSections
        sections={sections}
        groups={groups}
        onSelect={select}
        subContentClassName={subContentClassName}
      />
      {isHydrating && <DropdownMenuItem disabled>Loading resources</DropdownMenuItem>}
    </>
  )
  return searchable ? (
    <ResourceMenuSearch groups={groups} isHydrating={isHydrating} onSelect={select}>
      {menu}
    </ResourceMenuSearch>
  ) : (
    menu
  )
}

interface WorkspaceResourceSubmenuProps {
  workspace: Pick<Workspace, 'id' | 'name' | 'logoUrl'>
  /** Must be referentially stable (a module constant) — it keys the group memo. */
  excludeTypes?: readonly MothershipResourceType[]
  selectFolders?: boolean
  onSelect: (resource: MothershipResource) => void
  /** Selects the workspace directly from its root row when the picker supports it. */
  onSelectWorkspace?: (workspace: Pick<Workspace, 'id' | 'name'>) => void
  subContentClassName?: string
}

/**
 * One workspace of an organization-wide picker: its own foldered resource menu,
 * fetched when the submenu first opens. Selections carry the workspace as owner.
 */
export function WorkspaceResourceSubmenu({
  workspace,
  excludeTypes,
  selectFolders,
  onSelect,
  onSelectWorkspace,
  subContentClassName,
}: WorkspaceResourceSubmenuProps) {
  const [open, setOpen] = useState(false)
  const icon = (
    <IdentityTile initial={getWorkspaceInitial(workspace.name)} logoUrl={workspace.logoUrl} />
  )
  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger
        onClick={(event) => {
          if (!onSelectWorkspace) return
          event.preventDefault()
          onSelectWorkspace(workspace)
        }}
        onKeyDown={(event) => {
          if (
            !onSelectWorkspace ||
            event.target !== event.currentTarget ||
            (event.key !== 'Enter' && event.key !== ' ')
          )
            return
          event.preventDefault()
          onSelectWorkspace(workspace)
        }}
      >
        {icon}
        <DropdownMenuItemLabel label={workspace.name} />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className={cn('flex w-[320px] flex-col overflow-hidden', subContentClassName)}
      >
        <WorkspaceResourceMenuContent
          workspaceId={workspace.id}
          enabled={open}
          excludeTypes={excludeTypes}
          searchable={false}
          includeProjectFiles={false}
          selectFolders={selectFolders}
          onSelect={onSelect}
          subContentClassName={subContentClassName}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

interface ProjectResourceSubmenuProps {
  project: Project
  workspaces: ReadonlyArray<Pick<Workspace, 'id' | 'name' | 'logoUrl'>>
  excludeTypes?: readonly MothershipResourceType[]
  selectFolders?: boolean
  onSelect: (resource: MothershipResource) => void
  onSelectProject?: (project: Pick<Project, 'id' | 'name'>) => void
  onSelectWorkspace?: (workspace: Pick<Workspace, 'id' | 'name'>) => void
  subContentClassName?: string
}

/** A Project owns shared files; its environments retain their workspace resources. */
export function ProjectResourceSubmenu({
  project,
  workspaces,
  excludeTypes,
  selectFolders,
  onSelect,
  onSelectProject,
  onSelectWorkspace,
  subContentClassName,
}: ProjectResourceSubmenuProps) {
  const [open, setOpen] = useState(false)
  const projectFilesEnabled = useFeatureFlag('project-files')
  const showFiles = projectFilesEnabled && !excludeTypes?.includes('file')
  const inventory = useAvailableProjectResources(project, open && showFiles)
  const sections = useResourceTreeSections(inventory)
  const fileNodes = sections.find((section) => section.type === 'file')?.nodes ?? []
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
  const environments = project.environments.map(
    (environment) => workspaceById.get(environment.id) ?? environment
  )
  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger
        onClick={(event) => {
          if (!onSelectProject) return
          event.preventDefault()
          onSelectProject(project)
        }}
        onKeyDown={(event) => {
          if (
            !onSelectProject ||
            event.target !== event.currentTarget ||
            (event.key !== 'Enter' && event.key !== ' ')
          )
            return
          event.preventDefault()
          onSelectProject(project)
        }}
      >
        <Folder className='size-[14px]' />
        <DropdownMenuItemLabel label={project.name} />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className={cn('w-[320px]', subContentClassName)}>
        <DropdownMenuLabel>Environments</DropdownMenuLabel>
        {environments.map((workspace) => (
          <WorkspaceResourceSubmenu
            key={workspace.id}
            workspace={workspace}
            excludeTypes={excludeTypes}
            selectFolders={selectFolders}
            onSelect={onSelect}
            onSelectWorkspace={onSelectWorkspace}
            subContentClassName={subContentClassName}
          />
        ))}
        {!environments.length && (
          <DropdownMenuItem disabled>No accessible environments</DropdownMenuItem>
        )}
        {showFiles && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Project files</DropdownMenuLabel>
            <ResourceFolderTreeItems
              nodes={fileNodes}
              type='file'
              onSelect={onSelect}
              subContentClassName={subContentClassName}
            />
            {!fileNodes.length && (
              <DropdownMenuItem disabled>
                {inventory.isHydrating ? 'Loading files' : 'No shared files'}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

const WORKSPACE_FLYOUT_EXCLUDED_TYPES: readonly MothershipResourceType[] = ['browser', 'terminal']

export function AddResourceDropdown({
  workspaceId: suppliedWorkspaceId,
  organizationId,
  onAdd,
  excludeTypes,
  onRequestOpen,
  onClose,
}: AddResourceDropdownProps) {
  const [open, setOpen] = useState(false)
  const projectsEnabled = useFeatureFlag('projects')
  const projectQuery = useProjectInventory(organizationId, open && projectsEnabled)
  const projects = projectsEnabled && !projectQuery.isError ? (projectQuery.data ?? []) : []
  const { data: allWorkspaces = [] } = useOrderedWorkspacesQuery(open && Boolean(organizationId))
  const workspaces = allWorkspaces.filter(
    (workspace) => workspace.organizationId === organizationId
  )
  const flyoutExcludedTypes = useMemo(
    () => [...(excludeTypes ?? []), ...WORKSPACE_FLYOUT_EXCLUDED_TYPES],
    [excludeTypes]
  )
  const [inventories, setInventories] = useState<Record<string, AvailableResources>>({})
  const receiveInventory = useCallback((workspaceId: string, inventory: AvailableResources) => {
    setInventories((current) =>
      current[workspaceId] === inventory ? current : { ...current, [workspaceId]: inventory }
    )
  }, [])
  const projectInventories = useAvailableProjectInventories(
    projects,
    open && Boolean(organizationId) && !excludeTypes?.includes('file')
  )
  const organizationInventory = mergeOrganizationResourceInventories(
    workspaces,
    inventories,
    projects,
    projectInventories
  )
  const contentRef = useRef<HTMLDivElement>(null)
  const { groups } = useAvailableResources('', {
    enabled: open && !suppliedWorkspaceId,
    excludeTypes,
  })
  const nativeGroups = groups.filter(
    (group) => group.type === 'browser' || group.type === 'terminal'
  )
  const hasNativeResourceSurface = isBrowserAgentAvailable() || isTerminalAvailable()
  const closeMenu = useCallback(() => {
    setOpen(false)
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
    void closeMenu().then(() => onAdd(resource))
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange} modal={false}>
      {open &&
        organizationId &&
        workspaces.map((workspace) => (
          <OrganizationResourceInventory
            key={workspace.id}
            workspaceId={workspace.id}
            onChange={receiveInventory}
          />
        ))}

      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <DropdownMenuTrigger asChild>
            <TabStripAction variant='subtle' aria-label='Add resource tab'>
              <Plus className={RESOURCE_TAB_ICON_CLASS} />
            </TabStripAction>
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
        {suppliedWorkspaceId ? (
          <WorkspaceResourceMenuContent
            workspaceId={suppliedWorkspaceId}
            enabled={open}
            excludeTypes={excludeTypes}
            onSelect={select}
          />
        ) : (
          <ResourceMenuSearch
            groups={[
              ...organizationInventory.groups.filter(
                (group) => !excludeTypes?.includes(group.type)
              ),
              ...nativeGroups,
            ]}
            isHydrating={
              organizationInventory.isHydrating || (projectsEnabled && projectQuery.isPending)
            }
            onSelect={select}
          >
            {projects.map((project) => (
              <ProjectResourceSubmenu
                key={project.id}
                project={project}
                workspaces={workspaces}
                excludeTypes={flyoutExcludedTypes}
                onSelect={select}
              />
            ))}
            {!projectsEnabled &&
              workspaces.map((workspace) => (
                <WorkspaceResourceSubmenu
                  key={workspace.id}
                  workspace={workspace}
                  excludeTypes={flyoutExcludedTypes}
                  onSelect={select}
                />
              ))}
            {projectsEnabled && !projects.length && (
              <DropdownMenuItem disabled>
                {projectQuery.isPending
                  ? 'Loading projects'
                  : projectQuery.isError
                    ? 'Unable to load projects'
                    : 'No accessible projects'}
              </DropdownMenuItem>
            )}
            <ResourceMenuSections sections={[]} groups={nativeGroups} onSelect={select} />
          </ResourceMenuSearch>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
