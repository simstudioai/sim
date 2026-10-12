import { type ReactNode, useCallback, useState } from 'react'
import { Chip, ChipInput, OverflowText, Skeleton, toast } from '@sim/emcn'
import { ArrowLeft, Globe, Search, TerminalWindow } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import { openBrowserTab } from '@/lib/browser-agent/transport'
import { getChatResourceSelectionId } from '@/lib/mothership/resources/types'
import { terminalResourceId } from '@/lib/terminal/resource-id'
import { openTerminal } from '@/lib/terminal/transport'
import {
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
  'dashboard',
  'sources',
  'search',
  'folder',
  'task',
  'integration',
  'generic',
]
interface ProjectResourceBrowserProps {
  tab: string
  resources: MothershipResource[]
  desktopScopeId: string
}
interface BrowseRowProps {
  icon: ReactNode
  label: string
  detail?: string
  onClick: () => void
}
function BrowseRow({ icon, label, detail, onClick }: BrowseRowProps) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-small hover-hover:bg-[var(--surface-active)]'
    >
      {icon}
      <OverflowText label={label} className='flex-1 text-[var(--text-body)]' />
      {detail && <span className='text-[var(--text-muted)] text-caption'>{detail}</span>}
    </button>
  )
}

/** Browse live resources without creating a chat or changing its ownership. */
export function ProjectResourceBrowser({
  tab,
  resources,
  desktopScopeId,
}: ProjectResourceBrowserProps) {
  const [id, workspaceId, kind] = tab.split(':')
  const { organization } = useOrganizationContext()
  const { projects, roots, isPending } = useProjects(organization.id)
  const [, setParams] = useQueryStates(projectPaneParsers, projectPaneOptions)
  const { addResource, selectResource } = useMothershipResources()
  const [query, setQuery] = useState('')
  const [inventories, setInventories] = useState<Record<string, AvailableResources>>({})
  const project = projects.find((candidate) => candidate.id === workspaceId)
  const inventory = useAvailableResources(project?.id ?? '', {
    enabled: Boolean(project),
    excludeTypes: EXCLUDED,
  })
  const needle = query.trim().toLowerCase()
  const browse = (workspace = '', type = '') =>
    void setParams(
      (current) => ({
        browse: current.browse.map((entry) =>
          entry.split(':')[0] === id ? `${id}:${workspace}:${type}` : entry
        ),
      }),
      { history: 'replace' }
    )
  const open = (resource: MothershipResource) => {
    if (resource.type === 'browser') {
      void openBrowserTab(desktopScopeId)
        .then((state) => {
          if (state?.activeTabId) selectResource(state.activeTabId)
        })
        .catch(() => toast.error('Could not open a browser tab.'))
    } else if (resource.type === 'terminal') {
      void openTerminal(undefined, desktopScopeId)
        .then((state) => {
          if (state.activeTerminalId) selectResource(terminalResourceId(state.activeTerminalId))
        })
        .catch(() => toast.error('Could not open a terminal.'))
    } else addResource(resource)
  }
  const renderResource = (resource: MothershipResource, detail?: string) => {
    const config = getResourceConfig(resource.type)
    return (
      <BrowseRow
        key={getChatResourceSelectionId(resource)}
        icon={config.renderTabIcon(
          resource,
          'size-[14px] shrink-0 text-[var(--text-icon)]',
          desktopScopeId
        )}
        label={resource.title}
        detail={detail}
        onClick={() => open(resource)}
      />
    )
  }
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
  const updateInventory = useCallback(
    (owner: string, next: AvailableResources) =>
      setInventories((current) =>
        current[owner] === next ? current : { ...current, [owner]: next }
      ),
    []
  )
  return (
    <div className='min-h-0 flex-1 overflow-y-auto px-8 py-8'>
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
            onChange={(event) => setQuery(event.target.value)}
            className='mb-2 w-full'
          />
          {isPending || (project && inventory.isHydrating) ? (
            <Skeleton className='h-24' />
          ) : needle || kind ? (
            <>
              {matches.map(({ resource, detail }) => renderResource(resource, detail))}
              {!matches.length && (
                <p className='px-2 py-4 text-[var(--text-muted)] text-small'>No resources found.</p>
              )}
            </>
          ) : project ? (
            groups.map((group) => {
              const config = getResourceConfig(group.type)
              const Icon =
                group.type === 'browser'
                  ? Globe
                  : group.type === 'terminal'
                    ? TerminalWindow
                    : config.icon
              return (
                <BrowseRow
                  key={group.type}
                  icon={<Icon className='size-[14px] text-[var(--text-icon)]' />}
                  label={config.label}
                  onClick={() =>
                    group.type === 'browser' || group.type === 'terminal'
                      ? open({ type: group.type, id: group.type, title: config.label })
                      : browse(project.id, group.type)
                  }
                />
              )
            })
          ) : (
            roots.map((candidate) => (
              <BrowseRow
                key={candidate.projectId}
                icon={<IdentityTile initial={candidate.name[0]} />}
                label={candidate.name}
                onClick={() => browse(candidate.id)}
              />
            ))
          )}
        </section>
        {!kind && mentioned.length > 0 && (
          <section>
            <h2 className='mb-2 text-[var(--text-muted)] text-caption'>Mentioned in this chat</h2>
            {mentioned.map((resource) => renderResource(resource))}
          </section>
        )}
      </div>
    </div>
  )
}
