import { db } from '@sim/db'
import { workflowDeploymentVersion, workflowExecutionLogs } from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import type { PausePoint } from '@/executor/types'
import { stripCloneSuffixes, stripLoopDigest } from '@/executor/utils/subflow-node-id-codec'

type NameablePausePoint = Pick<PausePoint, 'blockId' | 'contextId' | 'blockName'>

/**
 * The workflow block a pause point waits on, without any loop iteration, parallel branch, or
 * subflow clone suffix. The loop digest goes first: a context ID ends in it (`block₍N₎_loopK`).
 */
export function pauseBaseBlockId(point: Pick<PausePoint, 'blockId' | 'contextId'>): string {
  return stripCloneSuffixes(stripLoopDigest(point.blockId ?? point.contextId))
}

/**
 * Names of `blockIds` in the deployment version the run executed, read inside the
 * database so the version's state never leaves it. Empty for a run with no recorded
 * version (a manual run) or whose version no longer exists.
 */
async function readRunBlockNames(
  workflowId: string,
  executionId: string,
  blockIds: string[]
): Promise<Map<string, string>> {
  const [row] = await db
    .select({
      names: sql<Record<string, string | null> | null>`(
        select jsonb_object_agg(b.key, b.value ->> 'name')
        from json_each(${workflowDeploymentVersion.state} -> 'blocks') as b
        where b.key in (${sql.join(
          blockIds.map((id) => sql`${id}`),
          sql`, `
        )})
      )`,
    })
    .from(workflowExecutionLogs)
    .innerJoin(
      workflowDeploymentVersion,
      eq(workflowDeploymentVersion.id, workflowExecutionLogs.deploymentVersionId)
    )
    .where(
      and(
        eq(workflowExecutionLogs.executionId, executionId),
        eq(workflowExecutionLogs.workflowId, workflowId)
      )
    )
    .limit(1)
  const names = new Map<string, string>()
  for (const [id, name] of Object.entries(row?.names ?? {})) {
    if (typeof name === 'string' && name) names.set(id, name)
  }
  return names
}

/**
 * Gives every pause point its block's name. A point carries the name it was captured
 * with; a point persisted before names were recorded is named from the run's
 * deployment version, and stays unnamed for a manual run. The execution snapshot is
 * never read, and the version is queried only when some point lacks a name.
 */
export async function namePausePoints<T extends NameablePausePoint>(
  workflowId: string,
  executionId: string,
  points: T[]
): Promise<T[]> {
  const unnamed = [...new Set(points.filter((point) => !point.blockName).map(pauseBaseBlockId))]
  if (unnamed.length === 0) return points

  const names = await readRunBlockNames(workflowId, executionId, unnamed)
  return points.map((point) => {
    const blockName = point.blockName || names.get(pauseBaseBlockId(point))
    return blockName ? { ...point, blockName } : point
  })
}
