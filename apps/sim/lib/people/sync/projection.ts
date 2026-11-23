import {
  peopleDirectoryEntry as entry,
  peopleDirectoryStage as stage,
  peopleDirectorySync as sync,
} from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import type { StageRun } from '@/lib/people/sync/stage'

/** Publishes one finished generation atomically. Existing external identities retain their public People IDs. */
export async function publishStagedSnapshot(
  tx: DbTransaction,
  run: StageRun,
  source: typeof sync.$inferSelect.source
) {
  const [current] = await tx
    .select({ id: sync.organizationId })
    .from(sync)
    .where(
      and(
        eq(sync.organizationId, run.organizationId),
        eq(sync.runId, run.runId),
        eq(sync.phase, 'publish'),
        eq(sync.source, source)
      )
    )
    .for('update')
  if (!current)
    throw new OrchestrationError(
      'conflict',
      'This directory generation is no longer ready to publish.'
    )
  if (source === 'entra') {
    const [unfinished] = await tx
      .select({ id: stage.externalId })
      .from(stage)
      .where(
        and(
          eq(stage.organizationId, run.organizationId),
          eq(stage.runId, run.runId),
          eq(stage.reportsComplete, false)
        )
      )
      .limit(1)
    if (unfinished)
      throw new OrchestrationError('conflict', 'Some directory relationships are still pending.')
  }
  await tx.execute(sql`
    WITH refs AS (
      SELECT external_id AS id, NULL::tid AS child FROM ${stage} WHERE organization_id = ${run.organizationId} AND run_id = ${run.runId}
      UNION ALL
      SELECT manager_external_id, ctid FROM ${stage} WHERE organization_id = ${run.organizationId} AND run_id = ${run.runId}
        AND manager_external_id IS NOT NULL
    ), classified AS (
      SELECT child, bool_or(child IS NULL) OVER (PARTITION BY id) AS present FROM refs
    )
    UPDATE ${stage} s SET manager_external_id = NULL FROM classified c
    WHERE c.child IS NOT NULL AND NOT c.present AND s.ctid = c.child
  `)
  // A person with an ancestor at least N steps away in an N-person directory must be in or below a cycle.
  const [graph] = await tx.execute<{ hasCycle: boolean }>(sql`
    WITH RECURSIVE size AS (
      SELECT count(*) AS n FROM ${stage} WHERE organization_id = ${run.organizationId} AND run_id = ${run.runId}
    ), jumps(distance, id, ancestor) AS (
      SELECT 1::bigint, external_id, manager_external_id FROM ${stage}
      WHERE organization_id = ${run.organizationId} AND run_id = ${run.runId} AND manager_external_id IS NOT NULL
      UNION ALL
      SELECT distance * 2, child, next FROM (
        SELECT j.distance, ref.child, max(ref.parent) OVER (PARTITION BY ref.id) AS next
        FROM jumps j CROSS JOIN size CROSS JOIN LATERAL (
          VALUES (j.id, NULL::text, j.ancestor), (j.ancestor, j.id, NULL::text)
        ) ref(id, child, parent)
        WHERE j.distance < size.n
      ) doubled WHERE child IS NOT NULL AND next IS NOT NULL
    )
    SELECT EXISTS (SELECT 1 FROM jumps CROSS JOIN size WHERE distance >= size.n) AS "hasCycle"
  `)
  if (graph.hasCycle)
    throw new OrchestrationError(
      'validation',
      'The directory contains a reporting loop. Correct the managers in your source and sync again.'
    )

  await tx.execute(sql`
    INSERT INTO ${entry} AS live (id,organization_id,source,external_id,email,name,title,department,location,manager_external_id)
    SELECT s.proposed_id, s.organization_id, ${source}, s.external_id, s.email, s.name, s.title, s.department, s.location,
      s.manager_external_id
    FROM ${stage} s
    WHERE s.organization_id = ${run.organizationId} AND s.run_id = ${run.runId}
    ON CONFLICT (organization_id,external_id) DO UPDATE SET email=excluded.email, name=excluded.name, title=excluded.title,
      department=excluded.department, location=excluded.location, manager_external_id=excluded.manager_external_id
    WHERE (live.email,live.name,live.title,live.department,live.location,live.manager_external_id)
      IS DISTINCT FROM (excluded.email,excluded.name,excluded.title,excluded.department,excluded.location,excluded.manager_external_id)
  `)
  // Physical row IDs live only within this statement and keep deletion independent of directory-wide join estimates.
  await tx.execute(sql`
    WITH entries AS (
      SELECT external_id, ctid AS target FROM ${entry} WHERE organization_id = ${run.organizationId}
      UNION ALL
      SELECT external_id, NULL::tid FROM ${stage} WHERE organization_id = ${run.organizationId} AND run_id = ${run.runId}
    ), classified AS (
      SELECT target, bool_or(target IS NULL) OVER (PARTITION BY external_id) AS present FROM entries
    )
    DELETE FROM ${entry} live USING classified c
    WHERE c.target IS NOT NULL AND NOT c.present AND live.ctid = c.target
  `)
}
