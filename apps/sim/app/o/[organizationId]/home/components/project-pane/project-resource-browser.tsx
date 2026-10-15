import { type KeyboardEvent, type ReactNode, useCallback, useState } from 'react'
import { Chip, ChipInput, cn, OverflowText, Skeleton, toast } from '@sim/emcn'
import { ArrowLeft, Globe, Search, TerminalWindow } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import { openBrowserTab } from '@/lib/browser-agent/transport'
import { getChatResourceSelectionId } from '@/lib/mothership/resources/types'
import { terminalResourceId } from '@/lib/terminal/resource-id'
import { openTerminal } from '@/lib/terminal/transport'
import {
  type PaneTab,
  projectPaneOptions,
  projectPaneParsers,
} from '@/app/o/[organizationId]/home/components/project-pane/search-params'
import { useProjects } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { useMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import {
  type AvailableResources,
  useAvailableResources,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/available-resources'
import { OrganizationResourceInventory } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/organization-resource-inventory'
import { resourceFromItem } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-from-item'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'

const EXCLUDED: readonly MothershipResourceType[] = [
  'sources',
  'search',
  'folder',
  'filefolder',
  'task',
  'integration',
  'generic',
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
  const [highlight, setHighlight] = useState(0)
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null)
  const [inventories, setInventories] = useState<Record<string, AvailableResources>>({})
  const project = projects.find((candidate) => candidate.id === workspaceId)
  const inventory = useAvailableResources(project?.id ?? '', {
    enabled: Boolean(project),
    excludeTypes: EXCLUDED,
  })
  const needle = query.trim().toLowerCase()
  const browse = (workspace = '', type = '') => {
    setHighlight(0)
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
  const matches = project
    ? groups.flatMap((group) =>
        !kind || group.type === kind
          ? group.items
              .filter((item) => !needle || item.name.toLowerCase().includes(needle))
              .map((item) => ({
                resource: resourceFromItem(group.type, { ...item, workspaceId: project.id }),
                detail: getResourceConfig(group.type).label,
              }))
          : []
      )
    : projects.flatMap((candidate) =>
        (inventories[candidate.id]?.groups ?? [])
          .filter(
            (group) =>
              !EXCLUDED.includes(group.type) &&
              group.type !== 'browser' &&
              group.type !== 'terminal'
          )
          .flatMap((group) =>
            group.items
              .filter((item) => item.name.toLowerCase().includes(needle))
              .map((item) => ({
                resource: resourceFromItem(group.type, { ...item, workspaceId: candidate.id }),
                detail: `${candidate.name} · ${candidate.environment}`,
              }))
          )
      )
  const isLoading = isPending || Boolean(project && inventory.isHydrating)
  const primary: BrowseEntry[] = isLoading
    ? []
    : needle || kind
      ? matches.map(({ resource, detail }) => resourceEntry(resource, detail))
      : project
        ? groups.map((group) => {
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
        : roots.map((candidate) => ({
            key: candidate.projectId,
            icon: <IdentityTile initial={candidate.name[0]} />,
            label: candidate.name,
            onSelect: () => browse(candidate.id),
          }))
  const secondary = kind ? [] : mentioned.map((resource) => resourceEntry(resource))
  const entries = [...primary, ...secondary]
  const active = Math.min(highlight, entries.length - 1)
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
      moveHighlight((active - 1 + entries.length) % entries.length)
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
  const updateInventory = useCallback(
    (owner: string, next: AvailableResources) =>
      setInventories((current) =>
        current[owner] === next ? current : { ...current, [owner]: next }
      ),
    []
  )
  return (
    <div ref={setListElement} className='min-h-0 flex-1 overflow-y-auto px-8 py-8'>
      <div className='mx-auto flex w-full max-w-[560px] flex-col gap-6'>
        {!project &&
          needle &&
          projects.map((candidate) => (
            <OrganizationResourceInventory
              key={candidate.id}
              workspaceId={candidate.id}
              onChange={updateInventory}
            />
          ))}
        <section>
          <div className='mb-2 flex items-center gap-2'>
            {kind && (
              <Chip
                leftIcon={ArrowLeft}
                aria-label='Back to resource types'
                onClick={() => browse(workspaceId)}
              />
            )}
            <h2 className='flex-1 text-[var(--text-muted)] text-caption'>
              Browse {project?.name ?? organization.name}
            </h2>
            {project && <Chip onClick={() => browse()}>Change</Chip>}
          </div>
          <ChipInput
            icon={Search}
            placeholder={`Search ${project?.name ?? organization.name}…`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setHighlight(0)
            }}
            onKeyDown={onSearchKeyDown}
            autoFocus
            className='mb-2 w-full'
          />
          {isLoading ? (
            <Skeleton className='h-24' />
          ) : (
            <>
              {primary.map(renderRow)}
              {(needle || kind) && !primary.length && (
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
