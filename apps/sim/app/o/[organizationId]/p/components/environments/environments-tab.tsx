'use client'

import { useRef, useState } from 'react'
import { Chip, ChipSwitch, Skeleton } from '@sim/emcn'
import { useQueryState, useQueryStates } from 'nuqs'
import {
  LineageStrip,
  type PipelineFocus,
} from '@/app/o/[organizationId]/p/components/environments/lineage-strip'
import {
  EnvironmentTable,
  SkeletonRows,
  WorkflowGrid,
} from '@/app/o/[organizationId]/p/components/environments/mapping-grid'
import {
  lineageEdges,
  orderEnvironments,
  RESOURCE_TABS,
  type ResourceTabId,
  WORKFLOW_TAB,
} from '@/app/o/[organizationId]/p/components/environments/mapping-model'
import { ResourceMappingEditor } from '@/app/o/[organizationId]/p/components/environments/resource-mapping-editor'
import { ResourceTabs } from '@/app/o/[organizationId]/p/components/environments/resource-tabs'
import { SyncReview } from '@/app/o/[organizationId]/p/components/environments/sync-review'
import { useEnvironmentMappings } from '@/app/o/[organizationId]/p/components/environments/use-environment-mappings'
import { usePipelineChanges } from '@/app/o/[organizationId]/p/components/environments/use-pipeline-changes'
import type { Project } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { projectParsers } from '@/app/o/[organizationId]/p/search-params'
import { useOptionalWorkspacePermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useForkSync } from '@/ee/workspace-forking/components/fork-sync/use-fork-sync'
import { useForkingAvailability } from '@/ee/workspace-forking/hooks/use-forking-available'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

interface EnvironmentsTabProps {
  project: Project
}

/**
 * The project's fork lineage and the resource mappings between its environments: one row per
 * resource, one column per environment, a sub-tab per resource type. Managing the lineage
 * needs workspace admin and the fork entitlement; otherwise the strip is read-only.
 */
export function EnvironmentsTab({ project }: EnvironmentsTabProps) {
  const [resource, setResource] = useQueryState(
    'environment-resource',
    projectParsers.resource.withOptions({ history: 'replace', clearOnDefault: true })
  )
  const [{ edge: edgeParam, sync: syncParam }, setSync] = useQueryStates(
    { edge: projectParsers.edge, sync: projectParsers.sync },
    { history: 'replace', clearOnDefault: true }
  )
  const { data: workspaces } = useWorkspacesQuery()
  const availability = useForkingAvailability(project.id)
  const permissions = useOptionalWorkspacePermissionsContext()?.userPermissions
  const canAdmin = permissions?.canAdmin ?? false
  const gateLoading = availability.isLoading || (permissions?.isLoading ?? false)
  const canManage = availability.available && canAdmin

  /** A handful of workspaces, so the lookups are rebuilt each render rather than memoized. */
  const parentOf = new Map<string, string | null>()
  const nameOf = new Map<string, string>()
  for (const workspace of workspaces ?? []) {
    parentOf.set(workspace.id, workspace.forkedFromWorkspaceId ?? null)
    nameOf.set(workspace.id, workspace.name)
  }
  const columns = orderEnvironments(project.rootId, project.environments, parentOf, nameOf)
  const edges = lineageEdges(columns)
  const changeCounts = usePipelineChanges(edges, canManage)
  /**
   * The sync under review: the one the URL names, else the current environment's own edge to
   * its parent, else the edge into the root, so the tab opens on the sync that matters most.
   */
  const focusEdge =
    edges.find((edge) => edge.childId === edgeParam) ??
    edges.find((edge) => edge.childId === project.id) ??
    edges.find((edge) => edge.parentId === project.rootId) ??
    edges[0]
  const focus: PipelineFocus | null = focusEdge
    ? { childId: focusEdge.childId, direction: syncParam }
    : null
  const columnById = new Map(columns.map((column) => [column.id, column]))
  const focusChild = focusEdge ? columnById.get(focusEdge.childId) : undefined
  const focusParent = focusEdge ? columnById.get(focusEdge.parentId) : undefined
  const mappingsRef = useRef<HTMLElement>(null)
  const [focusSourceId, setFocusSourceId] = useState<string | undefined>()
  const controller = useForkSync({
    workspaceId: focusChild?.id ?? project.id,
    workspaceName: focusChild?.name ?? project.environment,
    otherWorkspaceId: focusParent?.id,
    otherWorkspaceName: focusParent?.name ?? '',
    direction: focus?.direction ?? 'push',
    enabled: canManage && Boolean(focusChild && focusParent),
  })
  const [mappingView, setMappingView] = useState<'all' | 'sync'>('all')
  const allMappings = useForkSync({
    workspaceId: focusChild?.id ?? project.id,
    workspaceName: focusChild?.name ?? project.environment,
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
  const data = useEnvironmentMappings({
    columns,
    edges,
    forksEnabled: canManage,
    workflowsEnabled: true,
  })
  const { workflowRows } = data

  const counts = new Map<ResourceTabId, number>([[WORKFLOW_TAB, workflowRows.length]])
  for (const group of visibleGroups) counts.set(group.kind, group.items.length)
  const tab = RESOURCE_TABS.find((candidate) => candidate.id === resource) ?? RESOURCE_TABS[0]

  const notice = gateLoading
    ? null
    : !availability.available
      ? 'Forking is not available for this workspace.'
      : !canAdmin
        ? 'Only workspace admins can manage environments.'
        : edges.length === 0
          ? 'This project has one environment. Create a fork to map resources between environments.'
          : null
  const showGrid = canManage && edges.length > 0

  return (
    <div className='flex h-full min-h-0 flex-col gap-6 overflow-y-auto px-6 py-5'>
      <LineageStrip
        project={project}
        columns={columns}
        canManage={canManage}
        focus={canManage ? focus : null}
        changeCounts={changeCounts}
        onFocus={(next) => void setSync({ edge: next.childId, sync: next.direction })}
      />
      {canManage && focus && focusChild && focusParent ? (
        <SyncReview
          key={focusChild.id}
          controller={controller}
          mappingChangesPending={allMappings.dirty || allMappings.saving}
          onResolveMapping={(kind, sourceId) => {
            setMappingView('sync')
            setFocusSourceId(sourceId)
            void setResource(kind)
            mappingsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
            mappingsRef.current?.focus({ preventScroll: true })
          }}
          child={focusChild}
          parent={focusParent}
          direction={focus.direction}
          onDirectionChange={(direction) => void setSync({ edge: focusChild.id, sync: direction })}
        />
      ) : null}
      {gateLoading ? <Skeleton className='h-[30px] w-[320px]' /> : null}
      {notice ? <p className='text-[var(--text-muted)] text-small'>{notice}</p> : null}
      {showGrid ? (
        <section
          ref={mappingsRef}
          tabIndex={-1}
          aria-label='Resource mappings'
          className='flex scroll-mt-4 flex-col gap-3'
        >
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <h2 className='text-[var(--text-body)] text-small'>Resource mappings</h2>
            {allMappings.dirty && (
              <div className='flex gap-2'>
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
              </div>
            )}
          </div>
          <ChipSwitch
            aria-label='Mapping scope'
            value={mappingView}
            onChange={setMappingView}
            options={[
              { value: 'all', label: 'All mappings' },
              { value: 'sync', label: 'Needed for this sync' },
            ]}
          />
          <ResourceTabs value={tab.id} counts={counts} onChange={(id) => void setResource(id)} />
          {data.errors.map(({ edge, message }) => (
            <p
              key={`${edge.parentId}:${edge.childId}`}
              className='text-[var(--text-error)] text-small'
            >
              Couldn't load the mapping between {nameOf.get(edge.parentId) ?? edge.parentId} and{' '}
              {nameOf.get(edge.childId) ?? edge.childId}: {message}
            </p>
          ))}
          {data.isPending ? (
            <EnvironmentTable columns={columns}>
              <SkeletonRows columns={columns} />
            </EnvironmentTable>
          ) : tab.id === WORKFLOW_TAB ? (
            <WorkflowGrid
              columns={columns}
              rows={workflowRows}
              empty='No deployed workflows to compare.'
            />
          ) : (
            <ResourceMappingEditor
              key={`${focus?.childId}:${focus?.direction}:${tab.id}`}
              controller={mappingEditor}
              kind={tab.id}
              focusSourceId={focusSourceId}
              sourceName={
                focus?.direction === 'push' ? (focusChild?.name ?? '') : (focusParent?.name ?? '')
              }
              targetName={controller.targetWorkspaceName}
            />
          )}
        </section>
      ) : null}
    </div>
  )
}
