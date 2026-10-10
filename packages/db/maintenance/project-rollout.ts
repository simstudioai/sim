import { getTransientDatabaseFailure } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import type { Sql, TransactionSql } from 'postgres'

type ProjectMembershipPhase = 'connector' | 'column'

/** Reads durable authority without inferring it from partially copied membership. */
export async function readProjectMembershipPhase(
  sql: Sql | TransactionSql
): Promise<ProjectMembershipPhase> {
  const [table] = await sql`SELECT
    to_regclass('public.project_membership_rollout') IS NOT NULL AS present,
    to_regclass('public.project_workspace') IS NULL
    AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.workspace')
      AND attname = 'project_id' AND attnotnull AND NOT attisdropped)
    AND (SELECT count(*) = 3 FROM pg_constraint
      WHERE conrelid = to_regclass('public.workspace') AND contype = 'f' AND convalidated
      AND conname IN ('workspace_project_id_project_id_fk',
        'workspace_project_organization_fk', 'workspace_fork_project_fk')) AS complete`
  if (!table?.present) {
    if (table?.complete) return 'column'
    throw new Error('Project membership rollout marker is missing before completed contraction')
  }
  const rows = await sql<
    { id: string; phase: string }[]
  >`SELECT id, phase FROM public.project_membership_rollout`
  const row = rows[0]
  if (rows.length !== 1 || row?.id !== 'membership' || !['connector', 'column'].includes(row.phase))
    throw new Error('Project membership rollout marker is missing or invalid')
  return row.phase as ProjectMembershipPhase
}

/** Mutating maintenance never writes columns while compatible applications still use the connector. */
export async function assertProjectColumnAuthority(sql: Sql | TransactionSql): Promise<void> {
  if ((await readProjectMembershipPhase(sql)) !== 'column')
    throw new Error(
      'Project membership authority must switch through db:migrate after verified server/worker drainage before maintenance writes'
    )
}

/** Commits the forward-only authority change before any discovery, backfill, or repair. */
export async function switchProjectMembershipAuthority(sql: Sql): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await sql.begin(async (tx) => {
        await tx`SET LOCAL statement_timeout = '3s'`
        await tx`SELECT set_config(CASE WHEN current_setting('transaction_timeout', true) IS NULL
          THEN 'idle_in_transaction_session_timeout' ELSE 'transaction_timeout' END, '5s', true)`
        await tx`LOCK TABLE public.workspace IN ACCESS EXCLUSIVE MODE NOWAIT`
        const [operator] = await tx`SELECT EXISTS (SELECT 1 FROM pg_locks
          WHERE pid = pg_backend_pid() AND locktype = 'advisory' AND granted
            AND classid = ((hashtextextended('sim:project-backfill-operator',0) >> 32) & 4294967295)::oid
            AND objid = (hashtextextended('sim:project-backfill-operator',0) & 4294967295)::oid
            AND objsubid = 1) AS held`
        if (!operator?.held)
          throw new Error('Project authority switch requires the operator session lock')
        const phase = await readProjectMembershipPhase(tx)
        if (phase === 'column') return
        const [state] = await tx`SELECT
          to_regclass('public.project_workspace') IS NOT NULL AS connector,
          EXISTS (SELECT 1 FROM public.workspace WHERE project_id IS NOT NULL) AS populated`
        if (!state?.connector || state.populated)
          throw new Error(
            'Connector authority requires an intact connector and no populated Project columns; reconcile the rollout state before switching'
          )
        await tx`UPDATE public.project_membership_rollout SET phase = 'column' WHERE id = 'membership'`
      })
      return
    } catch (error) {
      const transient = getTransientDatabaseFailure(error)
      if (attempt >= 2 || (transient !== 'capacity' && transient !== 'conflict')) throw error
      await sleep(backoffWithJitter(attempt, null, { baseMs: 100, maxMs: 500 }))
    }
  }
}
