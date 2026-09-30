'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { type QueryFunctionContext, useQueries } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { WorkspaceCredential } from '@/lib/api/contracts/credentials'
import {
  type GetForkLineageResponse,
  getForkDiffContract,
  getForkLineageContract,
  getForkMappingContract,
} from '@/lib/api/contracts/workspace-fork'
import {
  buildMappingRows,
  buildWorkflowRows,
  type EnvironmentColumn,
  type LineageEdge,
  type MappingRow,
  type WorkflowRow,
} from '@/app/playground/org/components/environments/mapping-model'
import {
  forkKeys,
  WORKSPACE_FORK_DIFF_STALE_TIME,
  WORKSPACE_FORK_LINEAGE_STALE_TIME,
  WORKSPACE_FORK_MAPPING_STALE_TIME,
} from '@/ee/workspace-forking/hooks/workspace-fork'
import { workspaceCredentialListQueryOptions } from '@/hooks/queries/utils/fetch-workspace-credentials'
import { getWorkflowListQueryOptions } from '@/hooks/queries/utils/workflow-list-query'

/** A mapping or diff request for one edge that failed, phrased for the grid. */
export interface EdgeError {
  edge: LineageEdge
  message: string
}

interface UseEnvironmentMappingsProps {
  columns: readonly EnvironmentColumn[]
  edges: readonly LineageEdge[]
  /** Admin with forking available; the fork routes 404 or 403 otherwise. */
  forksEnabled: boolean
  /** Off for a mock project, whose environments are not workspaces. */
  workflowsEnabled: boolean
}

/**
 * The per-edge mapping and sync preview for every direct edge of the lineage (each fork
 * pulling from its parent), each environment's lineage node, and each environment's workflow
 * list, joined into one row per resource. Shares its cache entries with the forks settings
 * page through the same key factory, so an edit here shows there without a refetch.
 */
export function useEnvironmentMappings({
  columns,
  edges,
  forksEnabled,
  workflowsEnabled,
}: UseEnvironmentMappingsProps) {
  const mappings = useQueries({
    queries: edges.map((edge) => ({
      queryKey: forkKeys.mapping(edge.childId, edge.parentId, 'pull'),
      queryFn: ({ signal }: QueryFunctionContext) =>
        requestJson(getForkMappingContract, {
          params: { id: edge.childId },
          query: { otherWorkspaceId: edge.parentId, direction: 'pull' },
          signal,
        }),
      staleTime: WORKSPACE_FORK_MAPPING_STALE_TIME,
      enabled: forksEnabled,
    })),
  })
  const diffs = useQueries({
    queries: edges.map((edge) => ({
      queryKey: forkKeys.diff(edge.childId, edge.parentId, 'pull'),
      queryFn: ({ signal }: QueryFunctionContext) =>
        requestJson(getForkDiffContract, {
          params: { id: edge.childId },
          query: { otherWorkspaceId: edge.parentId, direction: 'pull' },
          signal,
        }),
      staleTime: WORKSPACE_FORK_DIFF_STALE_TIME,
      enabled: forksEnabled,
    })),
  })
  const lineages = useQueries({
    queries: columns.map((column) => ({
      queryKey: forkKeys.lineage(column.id),
      queryFn: ({ signal }: QueryFunctionContext) =>
        requestJson(getForkLineageContract, { params: { id: column.id }, signal }),
      staleTime: WORKSPACE_FORK_LINEAGE_STALE_TIME,
      enabled: forksEnabled,
    })),
  })
  const credentialLists = useQueries({
    queries: columns.map((column) => ({
      ...workspaceCredentialListQueryOptions(column.id),
      enabled: forksEnabled,
    })),
  })
  const workflowLists = useQueries({
    queries: columns.map((column) => ({
      ...getWorkflowListQueryOptions(column.id),
      enabled: workflowsEnabled,
    })),
  })

  /** A handful of edges and rows, so deriving them each render is cheaper than memoizing. */
  const lineageByEnv = new Map<string, GetForkLineageResponse | undefined>()
  columns.forEach((column, index) => lineageByEnv.set(column.id, lineages[index]?.data))

  /** Credentials by environment, so a credential row can show its provider's mark. */
  const credentialsByEnv = new Map<string, Map<string, WorkspaceCredential>>()
  columns.forEach((column, index) => {
    const byId = new Map<string, WorkspaceCredential>()
    for (const credential of credentialLists[index]?.data ?? []) byId.set(credential.id, credential)
    credentialsByEnv.set(column.id, byId)
  })

  const deployedByEnv = new Map<string, Map<string, boolean>>()
  columns.forEach((column, index) => {
    const byName = new Map<string, boolean>()
    for (const workflow of workflowLists[index]?.data ?? []) {
      byName.set(workflow.name, workflow.isDeployed ?? false)
    }
    deployedByEnv.set(column.id, byName)
  })

  const errors: EdgeError[] = []
  edges.forEach((edge, index) => {
    const mappingError = mappings[index]?.error
    const diffError = diffs[index]?.error
    if (mappingError) errors.push({ edge, message: getErrorMessage(mappingError) })
    else if (diffError) errors.push({ edge, message: getErrorMessage(diffError) })
  })

  const rows: MappingRow[] = buildMappingRows(
    edges.map((edge, index) => ({ edge, entries: mappings[index]?.data?.entries ?? [] }))
  )
  const workflowRows: WorkflowRow[] = buildWorkflowRows(
    edges.map((edge, index) => ({ edge, workflows: diffs[index]?.data?.workflows ?? [] })),
    deployedByEnv
  )

  const isPending =
    forksEnabled &&
    (mappings.some((query) => query.isPending) || diffs.some((query) => query.isPending))

  return { rows, workflowRows, lineageByEnv, credentialsByEnv, errors, isPending }
}
