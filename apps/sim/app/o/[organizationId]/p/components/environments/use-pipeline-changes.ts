'use client'

import { type QueryFunctionContext, useQueries } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getForkDiffContract } from '@/lib/api/contracts/workspace-fork'
import type { LineageEdge } from '@/app/o/[organizationId]/p/components/environments/mapping-model'
import {
  type ForkDirection,
  forkKeys,
  WORKSPACE_FORK_DIFF_STALE_TIME,
} from '@/ee/workspace-forking/hooks/workspace-fork'

const DIRECTIONS: readonly ForkDirection[] = ['push', 'pull']

/**
 * How many deployed workflows each edge's sync would change, in both directions, from the same
 * sync previews the sync itself reads (shared cache keys), so the pipeline's counts and the
 * review below it always agree.
 */
export function usePipelineChanges(edges: readonly LineageEdge[], enabled: boolean) {
  const pairs = edges.flatMap((edge) => DIRECTIONS.map((direction) => ({ edge, direction })))
  const diffs = useQueries({
    queries: pairs.map((pair) => ({
      queryKey: forkKeys.diff(pair.edge.childId, pair.edge.parentId, pair.direction),
      queryFn: ({ signal }: QueryFunctionContext) =>
        requestJson(getForkDiffContract, {
          params: { id: pair.edge.childId },
          query: { otherWorkspaceId: pair.edge.parentId, direction: pair.direction },
          signal,
        }),
      staleTime: WORKSPACE_FORK_DIFF_STALE_TIME,
      enabled,
    })),
  })
  const counts = new Map<string, Partial<Record<ForkDirection, number>>>()
  pairs.forEach(({ edge, direction }, index) => {
    const workflows = diffs[index]?.data?.workflows
    if (!workflows) return
    const changed = workflows.filter(
      (change) => change.action !== 'update' || change.hasChanges
    ).length
    counts.set(edge.childId, { ...counts.get(edge.childId), [direction]: changed })
  })
  return counts
}
