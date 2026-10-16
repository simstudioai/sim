import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react'
import {
  Chip,
  ChipInput,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemLabel,
  DropdownMenuTrigger,
  OverflowText,
  Skeleton,
  toast,
} from '@sim/emcn'
import { ArrowLeft, ChevronDown, Globe, Loader, Search, TerminalWindow } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import { RESOURCE_SEARCH_TYPES, type ResourceSearchItem } from '@/lib/api/contracts/resource-search'
import { openBrowserTab } from '@/lib/browser-agent/transport'
import { getChatResourceSelectionId } from '@/lib/mothership/resources/types'
import { terminalResourceId } from '@/lib/terminal/resource-id'
import { openTerminal } from '@/lib/terminal/transport'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import {
  type PaneTab,
  projectPaneOptions,
  projectPaneParsers,
} from '@/app/o/[organizationId]/home/components/project-pane/search-params'
import { useProjects } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { useMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import { useAvailableResources } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/available-resources'
import { resourceFromItem } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-from-item'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import { useOrganizationResourceSearch } from '@/hooks/queries/resource-search'
import { useDebounce } from '@/hooks/use-debounce'
import { useLoadMoreSentinel } from '@/hooks/use-load-more-sentinel'

const EXCLUDED: readonly MothershipResourceType[] = [
  'sources',
  'search',
  'folder',
  'filefolder',
  'task',
  'integration',
  'generic',
  'dashboard',
]
interface ProjectResourceBrowserProps {
  tab: Extract<PaneTab, { kind: 'browse' }>
  resources: MothershipResource[]
  desktopScopeId: string
}
interface BrowseEntry {
  key: string
  icon: ReactNode
  label: string
  detail?: string
  onSelect: () => void
}
interface BrowseRowProps {
  entry: BrowseEntry
  index: number
  highlighted: boolean
  onHover: (index: number) => void
}
function BrowseRow({ entry, index, highlighted, onHover }: BrowseRowProps) {
  return (
    <button
      type='button'
      tabIndex={-1}
      data-browse-index={index}
      onClick={entry.onSelect}
      onMouseMove={() => onHover(index)}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-small',
        highlighted && 'bg-[var(--surface-active)]'
      )}
    >
      {entry.icon}
      <OverflowText label={entry.label} className='flex-1 text-[var(--text-body)]' />
      {entry.detail && (
        <span className='text-[var(--text-muted)] text-caption'>{entry.detail}</span>
      )}
    </button>
  )
}

/** Browse live resources without creating a chat or changing its ownership. */
export function ProjectResourceBrowser({
  tab,
  resources,
  desktopScopeId,
}: ProjectResourceBrowserProps) {
  const { id, workspaceId, resourceKind: kind } = tab
  const { organization } = useOrganizationContext()
  const { projects, roots, isPending } = useProjects(organization.id)
  const [, setParams] = useQueryStates(projectPaneParsers, projectPaneOptions)
  const { addResource, selectResource } = useMothershipResources()
  const [query, setQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  /** -1 until an arrow key or the pointer picks a row, so nothing is highlighted at rest. */
  const [highlight, setHighlight] = useState(-1)
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null)
  const project = projects.find((candidate) => candidate.id === workspaceId)
  const inventory = useAvailableResources(project?.id ?? '', {
    enabled: Boolean(project),
    excludeTypes: EXCLUDED,
  })
  const needle = query.trim().toLowerCase()
  const debouncedNeedle = useDebounce(query.trim(), SEARCH_DEBOUNCE_MS)
  const browse = (workspace = '', type = '') => {
    setHighlight(-1)
    void setParams(
      (current) => ({
        tabs: current.tabs.map((entry) =>
          entry.id === id
            ? { kind: 'browse', id, workspaceId: workspace, resourceKind: type }
            : entry
        ),
      }),
      { history: 'replace' }
    )
  }
  /** Like a browser's new-tab page, opening a resource from here replaces this tab. */
  const replaceWith = (show: () => void) => {
    show()
    void setParams((current) => ({ tabs: current.tabs.filter((entry) => entry.id !== id) }), {
      history: 'replace',
    })
  }
  const open = (resource: MothershipResource) => {
    if (resource.type === 'browser') {
      void openBrowserTab(desktopScopeId)
        .then((state) => {
          const tabId = state?.activeTabId
          if (tabId) replaceWith(() => selectResource(tabId))
        })
        .catch(() => toast.error('Could not open a browser tab.'))
    } else if (resource.type === 'terminal') {
      void openTerminal(undefined, desktopScopeId)
        .then((state) => {
          const terminalId = state.activeTerminalId
          if (terminalId) replaceWith(() => selectResource(terminalResourceId(terminalId)))
        })
        .catch(() => toast.error('Could not open a terminal.'))
    } else replaceWith(() => addResource(resource))
  }
  const resourceEntry = (resource: MothershipResource, detail?: string): BrowseEntry => ({
    key: getChatResourceSelectionId(resource),
    icon: getResourceConfig(resource.type).renderTabIcon(
      resource,
      'size-[14px] shrink-0 text-[var(--text-icon)]',
      desktopScopeId
    ),
    label: resource.title,
    detail,
    onSelect: () => open(resource),
  })
  const mentioned = resources.filter((resource) => !EXCLUDED.includes(resource.type))
  const groups = inventory.groups.filter((group) => !EXCLUDED.includes(group.type))
  const searchableKind = RESOURCE_SEARCH_TYPES.find((type) => type === kind)
  const environmentOptions = (project?.environments ?? []).map((environment) => ({
    value: environment.workspaceId,
    label: environment.label,
  }))
  /**
   * Search spans the project's environments; types the server cannot search by name stay scoped
   * to the environment being browsed.
   */
  const searchesServer = Boolean(project) && Boolean(needle) && (!kind || Boolean(searchableKind))
  const resourceSearch = useOrganizationResourceSearch(
    organization.id,
    {
      query: debouncedNeedle,
      types: searchableKind ? [searchableKind] : [],
      workspaceIds: environmentOptions.map((option) => option.value),
    },
    { enabled: searchesServer }
  )
  const searchItems = resourceSearch.data?.pages.flatMap((page) => page.items) ?? []
  const loadMoreRef = useLoadMoreSentinel({
    onLoadMore: () => void resourceSearch.fetchNextPage(),
    enabled: searchesServer && resourceSearch.hasNextPage && !resourceSearch.isFetchingNextPage,
  })
  /** Results for the typed text have not arrived: the debounce is pending or the request in flight. */
  const isSearching =
    searchesServer &&
    (debouncedNeedle !== query.trim() ||
      resourceSearch.isPending ||
      resourceSearch.isPlaceholderData)
  /** The environment being browsed ranks first. */
  const searchRank = (workspaceId: string) => (workspaceId === project?.id ? 0 : 1)
  const environmentLabel = (item: ResourceSearchItem) =>
    environmentOptions.find((option) => option.value === item.workspaceId)?.label ??
    item.workspaceName
  const scopedMatches = project
    ? groups.flatMap((group) =>
        !kind || group.type === kind
          ? group.items
              .filter((item) => !needle || item.name.toLowerCase().includes(needle))
              .map((item) => ({
                resource: resourceFromItem(group.type, { ...item, workspaceId: project.id }),
                detail: project.environment,
              }))
          : []
      )
    : []
  const matches = searchesServer
    ? [...searchItems]
        .sort((a, b) => searchRank(a.workspaceId) - searchRank(b.workspaceId))
        .map((item) => ({
          resource: resourceFromItem(item.type, item),
          detail: environmentLabel(item),
        }))
    : scopedMatches
  const isLoading = isPending || Boolean(project && inventory.isHydrating)
  const primary: BrowseEntry[] = isLoading
    ? []
    : !project
      ? roots.map((candidate) => ({
          key: candidate.projectId,
          icon: <IdentityTile initial={candidate.name[0]} />,
          label: candidate.name,
          onSelect: () => browse(candidate.id),
        }))
      : needle || kind
        ? matches.map(({ resource, detail }) => resourceEntry(resource, detail))
        : groups.map((group) => {
            const config = getResourceConfig(group.type)
            const Icon =
              group.type === 'browser'
                ? Globe
                : group.type === 'terminal'
                  ? TerminalWindow
                  : config.icon
            return {
              key: group.type,
              icon: <Icon className='size-[14px] text-[var(--text-icon)]' />,
              label: config.label,
              onSelect: () =>
                group.type === 'browser' || group.type === 'terminal'
                  ? open({ type: group.type, id: group.type, title: config.label })
                  : browse(project.id, group.type),
            }
          })
  const secondary = kind ? [] : mentioned.map((resource) => resourceEntry(resource))
  const entries = [...primary, ...secondary]
  const active = highlight < entries.length ? highlight : -1
  const moveHighlight = (next: number) => {
    setHighlight(next)
    listElement
      ?.querySelector(`[data-browse-index="${next}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!entries.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveHighlight((active + 1) % entries.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveHighlight(active <= 0 ? entries.length - 1 : active - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      entries[active]?.onSelect()
    }
  }
  const renderRow = (entry: BrowseEntry, index: number) => (
    <BrowseRow
      key={entry.key}
      entry={entry}
      index={index}
      highlighted={index === active}
      onHover={setHighlight}
    />
  )
  return (
    <div ref={setListElement} className='h-full min-h-0 overflow-y-auto px-8 py-8'>
      <div className='mx-auto flex w-full max-w-[560px] flex-col gap-6'>
        <section>
          {kind && (
            <div className='mb-2 flex'>
              <Chip leftIcon={ArrowLeft} onClick={() => browse(workspaceId)}>
                Resources
              </Chip>
            </div>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                aria-label='Browse project'
                className='mb-2 flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[var(--text-primary)] text-md transition-colors hover-hover:bg-[var(--surface-hover)]'
              >
                <OverflowText label={project?.name ?? 'Choose a project'} />
                <ChevronDown className='size-[14px] shrink-0 text-[var(--text-icon)]' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start'>
              {roots.map((root) => (
                <DropdownMenuItem
                  key={root.projectId}
                  active={root.projectId === project?.projectId}
                  onSelect={() => browse(root.id, kind)}
                >
                  <IdentityTile initial={root.name[0]} />
                  <DropdownMenuItemLabel label={root.name} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {project && (
            <ChipInput
              ref={searchInputRef}
              icon={Search}
              placeholder={`Search ${project.name}…`}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setHighlight(-1)
              }}
              onKeyDown={onSearchKeyDown}
              autoFocus
              className='mb-2 w-full'
            />
          )}
          {isLoading ? (
            <Skeleton className='h-24' />
          ) : (
            <>
              {primary.map(renderRow)}
              {searchesServer && resourceSearch.hasNextPage && (
                <div ref={loadMoreRef} aria-hidden='true' className='h-px' />
              )}
              {resourceSearch.isFetchingNextPage && (
                <div
                  role='status'
                  className='flex items-center gap-2 px-2 py-2 text-[var(--text-muted)] text-small'
                >
                  <Loader className='size-[14px]' animate />
                  Loading more…
                </div>
              )}
              {isSearching && !primary.length && (
                <div
                  role='status'
                  className='flex items-center gap-2 px-2 py-4 text-[var(--text-muted)] text-small'
                >
                  <Loader className='size-[14px]' animate />
                  Searching…
                </div>
              )}
              {(needle || kind) && !isSearching && !primary.length && (
                <p className='px-2 py-4 text-[var(--text-muted)] text-small'>No resources found.</p>
              )}
            </>
          )}
        </section>
        {secondary.length > 0 && (
          <section>
            <h2 className='mb-2 text-[var(--text-muted)] text-caption'>Mentioned in this chat</h2>
            {secondary.map((entry, index) => renderRow(entry, primary.length + index))}
          </section>
        )}
      </div>
    </div>
  )
}
