'use client'

import { useState } from 'react'
import { Chip, ChipCombobox, Skeleton } from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { useQueryState, useQueryStates } from 'nuqs'
import { LineageStrip } from '@/app/o/[organizationId]/p/components/environments/lineage-strip'
import {
  lineageEdges,
  orderEnvironments,
  RESOURCE_TABS,
} from '@/app/o/[organizationId]/p/components/environments/mapping-model'
import { ResourceMappingEditor } from '@/app/o/[organizationId]/p/components/environments/resource-mapping-editor'
import { SyncReview } from '@/app/o/[organizationId]/p/components/environments/sync-review'
import type { Project } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { projectParsers } from '@/app/o/[organizationId]/p/search-params'
import {
  type FilterTag,
  ResourceFilterPanel,
  ResourceFilterSection,
  ResourceOptions,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-options'
import { useForkSync } from '@/ee/workspace-forking/components/fork-sync/use-fork-sync'
import { useForkingAvailability } from '@/ee/workspace-forking/hooks/use-forking-available'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

const MAPPING_VIEW_OPTIONS = [
  { value: 'all', label: 'All mappings' },
  { value: 'sync', label: 'Needed for this sync' },
]

interface EnvironmentsTabProps {
  project: Project
}

/**
 * The project's environments, and one fork's sync with its parent when a push or pull is
 * opened: the workflows it would change and the resource mappings between the pair. Syncing a
 * pair needs admin on both environments and the fork entitlement.
 */
export function EnvironmentsTab({ project }: EnvironmentsTabProps) {
  const [kinds, setKinds] = useQueryState(
    'environment-resource',
    projectParsers.resource.withOptions({ history: 'replace', clearOnDefault: true })
  )
  const [mappingSearch, setMappingSearchParam] = useQueryState(
    'mapping-search',
    projectParsers.mappingSearch.withOptions({ history: 'replace', clearOnDefault: true })
  )
  const setMappingSearch = useDebouncedSearchSetter(setMappingSearchParam)
  const [{ edge: edgeParam, sync: syncParam }, setSync] = useQueryStates(
    { edge: projectParsers.edge, sync: projectParsers.sync },
    { history: 'replace', clearOnDefault: true }
  )
  const { data: workspaces, isPending: workspacesPending } = useWorkspacesQuery()
  const availability = useForkingAvailability(project.rootId)
  const gateLoading = availability.isLoading || workspacesPending

  /** A handful of workspaces, so the lookups are rebuilt each render rather than memoized. */
  const parentOf = new Map<string, string | null>()
  const nameOf = new Map<string, string>()
  for (const workspace of workspaces ?? []) {
    parentOf.set(workspace.id, workspace.forkedFromWorkspaceId ?? null)
    nameOf.set(workspace.id, workspace.name)
  }
  const columns = orderEnvironments(project.rootId, project.environments, parentOf, nameOf)
  const edges = lineageEdges(columns)
  /** A sync reads one side and replaces the other, so it needs admin on both (as the server does). */
  const adminIds = new Set(
    workspaces
      ?.filter((workspace) => workspace.permissions === 'admin')
      .map((workspace) => workspace.id)
  )
  const manageableEdges = availability.available
    ? edges.filter((edge) => adminIds.has(edge.childId) && adminIds.has(edge.parentId))
    : []
  const canManage = manageableEdges.length > 0
  /** The sync opened from a fork's push or pull; the graph shows until one is opened. */
  const focusEdge = manageableEdges.find((edge) => edge.childId === edgeParam)
  const focus = focusEdge ? { childId: focusEdge.childId, direction: syncParam } : null
  const columnById = new Map(columns.map((column) => [column.id, column]))
  const focusChild = focusEdge ? columnById.get(focusEdge.childId) : undefined
  const focusParent = focusEdge ? columnById.get(focusEdge.parentId) : undefined
  const controller = useForkSync({
    workspaceId: focusChild?.id ?? project.rootId,
    workspaceName: focusChild?.name ?? '',
    otherWorkspaceId: focusParent?.id,
    otherWorkspaceName: focusParent?.name ?? '',
    direction: focus?.direction ?? 'push',
    enabled: canManage && Boolean(focusChild && focusParent),
  })
  const [mappingView, setMappingView] = useState<'all' | 'sync'>('all')
  const allMappings = useForkSync({
    workspaceId: focusChild?.id ?? project.rootId,
    workspaceName: focusChild?.name ?? '',
    otherWorkspaceId: focusParent?.id,
    otherWorkspaceName: focusParent?.name ?? '',
    direction: focus?.direction ?? 'push',
    enabled: canManage && Boolean(focusChild && focusParent),
    mappingScope: 'all',
  })
  const visibleGroups = allMappings.groups.map((group) => ({
    ...group,
    items:
      mappingView === 'all'
        ? group.items
        : group.items.filter((entry) =>
            controller.groups.some(
              (syncGroup) =>
                syncGroup.kind === group.kind &&
                syncGroup.items.some((item) => item.sourceId === entry.sourceId)
            )
          ),
  }))
  const mappingEditor = { ...allMappings, groups: visibleGroups }
  const countOf = new Map(visibleGroups.map((group) => [group.kind, group.items.length]))
  const labelOf = new Map(RESOURCE_TABS.map((tab) => [tab.id, tab.label]))
  const kindsLabel =
    kinds.length === 0
      ? 'All'
      : kinds.length === 1
        ? (labelOf.get(kinds[0]) ?? kinds[0])
        : `${kinds.length} types`
  const filterTags: FilterTag[] = [
    ...(kinds.length > 0
      ? [{ label: `Type: ${kindsLabel}`, onRemove: () => void setKinds(null) }]
      : []),
    ...(mappingView === 'sync'
      ? [{ label: 'Needed for this sync', onRemove: () => setMappingView('all') }]
      : []),
  ]
  const filterContent = (
    <ResourceFilterPanel>
      <ResourceFilterSection label='Type'>
        <ChipCombobox
          options={RESOURCE_TABS.map((tab) => ({
            value: tab.id,
            label: countOf.get(tab.id) ? `${tab.label} (${countOf.get(tab.id)})` : tab.label,
          }))}
          multiSelect
          multiSelectValues={kinds}
          onMultiSelectChange={(next) =>
            void setKinds(RESOURCE_TABS.filter((tab) => next.includes(tab.id)).map((tab) => tab.id))
          }
          overlayLabel={kindsLabel}
          overlayContent={kindsLabel}
          showAllOption
          allOptionLabel='All'
          className='w-full'
        />
      </ResourceFilterSection>
      <ResourceFilterSection label='Show'>
        <ChipCombobox
          options={MAPPING_VIEW_OPTIONS}
          value={mappingView}
          onChange={(next) => setMappingView(next === 'sync' ? 'sync' : 'all')}
          className='w-full'
        />
      </ResourceFilterSection>
    </ResourceFilterPanel>
  )

  const notice = gateLoading
    ? null
    : !availability.available
      ? 'Forking is not available for this project.'
      : edges.length === 0
        ? 'This project has one environment. Create a fork to map resources between environments.'
        : !canManage
          ? 'Syncing a fork needs admin access to both environments.'
          : null

  if (!focus || !focusChild || !focusParent) {
    return (
      <LineageStrip
        project={project}
        columns={columns}
        canCreateFork={availability.available && adminIds.size > 0}
        manageableIds={new Set(manageableEdges.map((edge) => edge.childId))}
        onSync={(childId, direction) =>
          void setSync({ edge: childId, sync: direction }, { history: 'push' })
        }
        notice={
          gateLoading ? (
            <Skeleton className='h-[18px] w-[240px]' />
          ) : notice ? (
            <p className='text-[var(--text-muted)] text-small'>{notice}</p>
          ) : null
        }
      />
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col overflow-y-auto'>
      <div className='flex flex-col gap-6 px-6 py-5'>
        <Chip
          leftIcon={ArrowLeft}
          className='self-start'
          onClick={() => void setSync({ edge: null, sync: null })}
        >
          Environments
        </Chip>
        <SyncReview
          key={focusChild.id}
          controller={controller}
          mappingChangesPending={allMappings.dirty || allMappings.saving}
          child={focusChild}
          parent={focusParent}
          direction={focus.direction}
        />
      </div>
      <section
        aria-label='Resource mappings'
        className='flex flex-col border-[var(--border)] border-t'
      >
        <ResourceOptions
          search={{
            value: mappingSearch,
            onChange: setMappingSearch,
            onClearAll: () => setMappingSearch(''),
            placeholder: 'Search mappings...',
          }}
          filter={{ content: filterContent, active: filterTags.length > 0 }}
          filterTags={filterTags}
          trailing={
            allMappings.dirty ? (
              <>
                <Chip
                  disabled={allMappings.saving || allMappings.submitting}
                  onClick={allMappings.discard}
                >
                  Discard
                </Chip>
                <Chip
                  variant='primary'
                  disabled={
                    allMappings.saving ||
                    allMappings.submitting ||
                    allMappings.diffIsStale ||
                    allMappings.isLoading
                  }
                  onClick={allMappings.save}
                >
                  {allMappings.saving ? 'Saving…' : 'Save mappings'}
                </Chip>
              </>
            ) : undefined
          }
        />
        {allMappings.isLoading ? (
          <Skeleton className='m-6 h-24' />
        ) : (
          <ResourceMappingEditor
            key={`${focus.childId}:${focus.direction}`}
            controller={mappingEditor}
            kinds={kinds}
            search={mappingSearch}
            sourceName={focus.direction === 'push' ? focusChild.name : focusParent.name}
            targetName={controller.targetWorkspaceName}
          />
        )}
      </section>
    </div>
  )
}
