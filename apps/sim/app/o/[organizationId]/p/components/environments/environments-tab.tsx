'use client'

import { Skeleton } from '@sim/emcn'
import { useOpenSyncTab } from '@/app/o/[organizationId]/home/components/project-pane/use-open-sync-tab'
import { LineageStrip } from '@/app/o/[organizationId]/p/components/environments/lineage-strip'
import {
  lineageEdges,
  orderEnvironments,
} from '@/app/o/[organizationId]/p/components/environments/mapping-model'
import type { Project } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { useForkingAvailability } from '@/ee/workspace-forking/hooks/use-forking-available'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

interface EnvironmentsTabProps {
  project: Project
}

/**
 * The project's environments on a canvas. Push or pull opens that pair's sync in its own pane
 * tab; syncing needs admin on both environments and the fork entitlement.
 */
export function EnvironmentsTab({ project }: EnvironmentsTabProps) {
  const openSyncTab = useOpenSyncTab()
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

  const notice = gateLoading
    ? null
    : !availability.available
      ? 'Forking is not available for this project.'
      : manageableEdges.length === 0 && edges.length > 0
        ? 'Syncing a fork needs admin access to both environments.'
        : null

  return (
    <LineageStrip
      project={project}
      columns={columns}
      canCreateFork={availability.available && adminIds.size > 0}
      manageableIds={new Set(manageableEdges.map((edge) => edge.childId))}
      onSync={openSyncTab}
      forkGatePending={gateLoading}
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
