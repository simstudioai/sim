'use client'

import { Skeleton } from '@sim/emcn'
import { useQueryState } from 'nuqs'
import { LineageStrip } from '@/app/playground/org/components/environments/lineage-strip'
import {
  EnvironmentTable,
  MappingGrid,
  SkeletonRows,
  WorkflowGrid,
} from '@/app/playground/org/components/environments/mapping-grid'
import {
  lineageEdges,
  orderEnvironments,
  RESOURCE_TABS,
  type ResourceTabId,
  WORKFLOW_TAB,
} from '@/app/playground/org/components/environments/mapping-model'
import {
  MOCK_MAPPING_ROWS,
  MOCK_WORKFLOW_ROWS,
  mockEnvironments,
} from '@/app/playground/org/components/environments/mock-mappings'
import { ResourceTabs } from '@/app/playground/org/components/environments/resource-tabs'
import { useEnvironmentMappings } from '@/app/playground/org/components/environments/use-environment-mappings'
import { type Project, realWorkspaceId } from '@/app/playground/org/lib/project'
import { protoParsers } from '@/app/playground/org/lib/search-params'
import { useOptionalWorkspacePermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
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
    'resource',
    protoParsers.resource.withOptions({ history: 'replace', clearOnDefault: true })
  )
  const realId = realWorkspaceId(project)
  const { data: workspaces } = useWorkspacesQuery(!project.isMock)
  const availability = useForkingAvailability(realId || undefined)
  const permissions = useOptionalWorkspacePermissionsContext()?.userPermissions
  const canAdmin = permissions?.canAdmin ?? false
  const gateLoading =
    !project.isMock && (availability.isLoading || (permissions?.isLoading ?? false))
  const canManage = !project.isMock && availability.available && canAdmin

  /** A handful of workspaces, so the lookups are rebuilt each render rather than memoized. */
  const parentOf = new Map<string, string | null>()
  const nameOf = new Map<string, string>()
  for (const workspace of workspaces ?? []) {
    parentOf.set(workspace.id, workspace.forkedFromWorkspaceId ?? null)
    nameOf.set(workspace.id, workspace.name)
  }
  const columns = project.isMock
    ? mockEnvironments(project.name)
    : orderEnvironments(project.rootId, project.environments, parentOf, nameOf)
  const edges = lineageEdges(columns)
  const data = useEnvironmentMappings({
    columns,
    edges,
    forksEnabled: canManage,
    workflowsEnabled: !project.isMock,
  })
  const rows = project.isMock ? MOCK_MAPPING_ROWS : data.rows
  const workflowRows = project.isMock ? MOCK_WORKFLOW_ROWS : data.workflowRows

  const counts = new Map<ResourceTabId, number>([[WORKFLOW_TAB, workflowRows.length]])
  for (const row of rows) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1)
  const tab = RESOURCE_TABS.find((candidate) => candidate.id === resource) ?? RESOURCE_TABS[0]

  const notice = project.isMock
    ? 'Example mappings: this project has no workspace yet.'
    : gateLoading
      ? null
      : !availability.available
        ? 'Forking is not available for this workspace.'
        : !canAdmin
          ? 'Only workspace admins can manage environments.'
          : edges.length === 0
            ? 'This project has one environment. Create a fork to map resources between environments.'
            : null
  const showGrid = project.isMock || (canManage && edges.length > 0)

  return (
    <div className='flex h-full min-h-0 flex-col gap-6 overflow-y-auto px-6 py-5'>
      <LineageStrip
        project={project}
        columns={columns}
        lineageByEnv={data.lineageByEnv}
        canManage={canManage}
      />
      {gateLoading ? <Skeleton className='h-[30px] w-[320px]' /> : null}
      {notice ? <p className='text-[var(--text-muted)] text-small'>{notice}</p> : null}
      {showGrid ? (
        <section className='flex flex-col gap-3'>
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
            <MappingGrid
              columns={columns}
              rows={rows.filter((row) => row.kind === tab.id)}
              canEdit={canManage}
              credentialsByEnv={data.credentialsByEnv}
              empty={`No ${tab.label} referenced by deployed workflows.`}
            />
          )}
        </section>
      ) : null}
    </div>
  )
}
