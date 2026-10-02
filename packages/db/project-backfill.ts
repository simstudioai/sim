import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { classifyDatabaseFailure, getPostgresErrorCode } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { backoffWithJitter } from '@sim/utils/retry'
import { compareStrings, truncate } from '@sim/utils/string'
import postgres, { type Sql, type TransactionSql } from 'postgres'

type BackfillSql = Sql | TransactionSql

const logger = createLogger('ProjectBackfill', { enabled: true, logLevel: 'INFO' })
const MAX_FAMILY = 10_000
const MAX_WORKSPACES = 250_000
const RUN_LOCK = 'sim-project-backfill-v1'

interface LegacyWorkspace {
  id: string
  name: string
  organization_id: string | null
  owner_id: string
  archived_at: string | null
  forked_from_workspace_id: string | null
}

interface FamilyPlan {
  rootId: string
  projectId: string
  workspaceIds: string[]
  fingerprint: string
  name: string
}

interface Conflict {
  workspaceId: string
  projectIds: string[]
  workspaceIds: string[]
  reason: string
}

export interface ProjectBackfillReport {
  version: 1
  databaseId: string
  mode: 'dry-run' | 'apply' | 'verify'
  startedAt: string
  finishedAt?: string
  completed: boolean
  ready: boolean
  stopped?: string
  errorCode?: string
  scanned: number
  families: number
  createdProjects: number
  assignedWorkspaces: number
  unchangedFamilies: number
  retries: number
  plan: FamilyPlan[]
  conflicts: Conflict[]
}

interface BackfillOptions {
  mode: ProjectBackfillReport['mode']
  databaseId: string
  plan?: ProjectBackfillReport
  maxFamilySize?: number
  seconds?: number
  shouldStop?: () => boolean
  onProgress?: (report: ProjectBackfillReport) => Promise<void>
}

function fingerprint(family: LegacyWorkspace[]): string {
  return createHash('sha256').update(JSON.stringify(family)).digest('hex')
}

function conflict(
  rootId: string,
  reason: string,
  ids: string[],
  projects: string[] = []
): Conflict {
  return { workspaceId: rootId, reason, workspaceIds: ids, projectIds: projects }
}

/** Only reads and transactions known to have rolled back may be retried. */
async function withDatabaseRetry<T>(
  operation: () => Promise<T>,
  write: boolean,
  report: ProjectBackfillReport,
  stopped: () => boolean
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      const code = getPostgresErrorCode(error)
      const category = classifyDatabaseFailure(error)
      const retryable = write
        ? ['40001', '40P01', '55P03'].includes(code ?? '')
        : category === 'connection' || ['53300', '57P03'].includes(code ?? '')
      if (!retryable || attempt >= 3 || stopped()) throw error
      report.retries++
      logger.warn('Retrying Project backfill database operation', { code, write, attempt })
      await sleep(backoffWithJitter(attempt, null, { baseMs: 250, maxMs: 2000 }))
    }
  }
}

async function configureTransaction(tx: BackfillSql) {
  await tx`SET LOCAL lock_timeout = '2s'`
  await tx`SET LOCAL statement_timeout = '30s'`
  await tx`SET LOCAL idle_in_transaction_session_timeout = '30s'`
  await tx`SET LOCAL transaction_timeout = '30s'`
}

async function discoverFamily(tx: BackfillSql, rootId: string, maximum: number) {
  const family = await tx<LegacyWorkspace[]>`
    WITH RECURSIVE family AS (
      SELECT id, name, organization_id, owner_id, archived_at::text AS archived_at, forked_from_workspace_id FROM workspace WHERE id = ${rootId}
      UNION
      SELECT w.id, w.name, w.organization_id, w.owner_id, w.archived_at::text, w.forked_from_workspace_id
      FROM workspace w JOIN family f ON w.forked_from_workspace_id = f.id
    ) SELECT * FROM family LIMIT ${maximum + 1}
  `
  return family.sort((a, b) => compareStrings(a.id, b.id))
}

async function inspectFamily(tx: BackfillSql, rootId: string, maximum: number) {
  const family = await discoverFamily(tx, rootId, maximum)
  const root = family.find((row) => row.id === rootId)
  const ids = family.map((row) => row.id)
  if (!root || root.forked_from_workspace_id !== null)
    return { conflict: conflict(rootId, 'Root missing or now attached to another family', ids) }
  if (family.length > maximum)
    return { conflict: conflict(rootId, 'Family exceeds batch limit', ids) }
  if (family.some((row) => row.organization_id !== root.organization_id))
    return { conflict: conflict(rootId, 'Family spans organizations', ids) }
  const memberships = await tx<{ project_id: string }[]>`
    SELECT DISTINCT project_id FROM project_workspace WHERE workspace_id = ANY(${ids}::text[]) ORDER BY project_id
  `
  const projectIds = memberships.map((row) => row.project_id)
  if (projectIds.length > 1)
    return { conflict: conflict(rootId, 'Family spans multiple Projects', ids, projectIds) }
  const existingId = projectIds[0]
  if (existingId) {
    const [existing] = await tx<{ organization_id: string | null; archived_at: Date | null }[]>`
      SELECT organization_id, archived_at FROM project WHERE id = ${existingId}
    `
    if (!existing || existing.organization_id !== root.organization_id)
      return { conflict: conflict(rootId, 'Project organization differs', ids, projectIds) }
    const outside =
      await tx`SELECT workspace_id FROM project_workspace WHERE project_id = ${existingId} AND NOT (workspace_id = ANY(${ids}::text[])) LIMIT 1`
    if (outside.length)
      return { conflict: conflict(rootId, 'Project includes another lineage', ids, projectIds) }
    if (Boolean(existing.archived_at) !== family.every((row) => row.archived_at !== null))
      return { conflict: conflict(rootId, 'Project archive state differs', ids, projectIds) }
  }
  const [{ missing }] = await tx<{ missing: number }[]>`
    SELECT count(*)::int AS missing FROM workspace w WHERE w.id = ANY(${ids}::text[])
    AND NOT EXISTS (SELECT 1 FROM project_workspace pw WHERE pw.workspace_id = w.id)
  `
  return { root, family, ids, existingId, missing }
}

async function applyFamily(tx: BackfillSql, planned: FamilyPlan, maximum: number) {
  // NOWAIT prevents waiting behind application writers with an opposite row/advisory lock order.
  await tx`LOCK TABLE workspace, project, project_workspace IN SHARE ROW EXCLUSIVE MODE NOWAIT`
  const state = await inspectFamily(tx, planned.rootId, maximum)
  if (state.conflict) return { conflict: state.conflict, created: 0, assigned: 0 }
  if (fingerprint(state.family) !== planned.fingerprint)
    return {
      conflict: conflict(
        planned.rootId,
        'Family changed since dry-run; produce a new plan',
        state.ids
      ),
      created: 0,
      assigned: 0,
    }
  if (state.existingId && state.existingId !== planned.projectId)
    return {
      conflict: conflict(planned.rootId, 'Project assignment changed since dry-run', state.ids, [
        state.existingId,
        planned.projectId,
      ]),
      created: 0,
      assigned: 0,
    }
  if (!state.existingId) {
    await tx`INSERT INTO project (id, name, organization_id, owner_id, archived_at)
      SELECT ${planned.projectId}, ${planned.name}, ${state.root.organization_id}, ${state.root.owner_id},
        CASE WHEN count(archived_at) = count(*) THEN max(archived_at) ELSE NULL END
      FROM workspace WHERE id = ANY(${state.ids}::text[])`
  }
  const inserted = await tx`INSERT INTO project_workspace (project_id, workspace_id)
    SELECT ${planned.projectId}, id FROM workspace WHERE id = ANY(${state.ids}::text[])
    AND NOT EXISTS (SELECT 1 FROM project_workspace pw WHERE pw.workspace_id = workspace.id)`
  return { created: state.existingId ? 0 : 1, assigned: inserted.count }
}

async function inspectGlobalState(tx: BackfillSql) {
  const rows = await tx<{ id: string; reason: string }[]>`
    SELECT p.id, 'Empty Project' AS reason FROM project p
    WHERE NOT EXISTS (SELECT 1 FROM project_workspace pw WHERE pw.project_id = p.id)
    UNION ALL
    SELECT pw.project_id, 'Orphan membership or organization mismatch' FROM project_workspace pw
    LEFT JOIN project p ON p.id = pw.project_id LEFT JOIN workspace w ON w.id = pw.workspace_id
    WHERE p.id IS NULL OR w.id IS NULL OR p.organization_id IS DISTINCT FROM w.organization_id
    LIMIT 1001
  `
  if (rows.length > 1000) throw new Error('Global anomaly report limit exceeded; repair and rerun')
  return rows.map((row) => conflict('', row.reason, [], [row.id]))
}

/** Validate the operator artifact before it can select any write target. */
export function readProjectBackfillPlan(value: unknown, databaseId: string): ProjectBackfillReport {
  if (!value || typeof value !== 'object') throw new Error('Invalid dry-run artifact')
  const plan = value as Partial<ProjectBackfillReport>
  if (
    plan.version !== 1 ||
    plan.mode !== 'dry-run' ||
    !plan.completed ||
    plan.databaseId !== databaseId ||
    !Array.isArray(plan.plan) ||
    !Array.isArray(plan.conflicts) ||
    plan.conflicts.length
  )
    throw new Error('Apply requires a completed, conflict-free dry-run for this database')
  let total = 0
  const roots = new Set<string>()
  const projects = new Set<string>()
  const members = new Set<string>()
  for (const family of plan.plan) {
    if (
      !family ||
      typeof family.rootId !== 'string' ||
      !family.rootId ||
      typeof family.projectId !== 'string' ||
      !family.projectId ||
      typeof family.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(family.fingerprint) ||
      typeof family.name !== 'string' ||
      family.name.trim().length < 1 ||
      family.name.length > 100 ||
      !Array.isArray(family.workspaceIds) ||
      !family.workspaceIds.length ||
      family.workspaceIds.length > MAX_FAMILY
    )
      throw new Error('Malformed family in dry-run artifact')
    if (roots.has(family.rootId) || projects.has(family.projectId))
      throw new Error('Duplicate planned root or Project')
    roots.add(family.rootId)
    projects.add(family.projectId)
    for (const id of family.workspaceIds) {
      if (typeof id !== 'string' || !id || members.has(id))
        throw new Error('Invalid or repeated planned environment')
      members.add(id)
    }
    if (!family.workspaceIds.includes(family.rootId))
      throw new Error('Root missing from dry-run family')
    total += family.workspaceIds.length
    if (total > MAX_WORKSPACES) throw new Error('Dry-run artifact exceeds workspace limit')
  }
  return plan as ProjectBackfillReport
}

/** Bounded operator backfill. Reports are checkpointed before writes and after each commit. */
export async function backfillProjects(
  sql: Sql,
  options: BackfillOptions
): Promise<ProjectBackfillReport> {
  const maximum = options.maxFamilySize ?? MAX_FAMILY
  const seconds = options.seconds ?? 600
  if (
    !Number.isInteger(maximum) ||
    maximum < 1 ||
    maximum > MAX_FAMILY ||
    !Number.isInteger(seconds) ||
    seconds < 1 ||
    seconds > 3600
  )
    throw new Error('Invalid family or runtime limit')
  const source =
    options.mode === 'apply' ? readProjectBackfillPlan(options.plan, options.databaseId) : null
  const report: ProjectBackfillReport = {
    version: 1,
    databaseId: options.databaseId,
    mode: options.mode,
    startedAt: new Date().toISOString(),
    completed: false,
    ready: false,
    scanned: 0,
    families: 0,
    createdProjects: 0,
    assignedWorkspaces: 0,
    unchangedFamilies: 0,
    retries: 0,
    plan: [],
    conflicts: [],
  }
  const deadline = Date.now() + seconds * 1000
  const stopped = () => Boolean(options.shouldStop?.()) || Date.now() >= deadline
  const checkpoint = async () => {
    await options.onProgress?.(report)
  }
  let lockLost = false
  if (sql.options.host.length !== 1 || sql.options.port.length !== 1)
    throw new Error('Backfill requires a single direct primary endpoint')
  const lockClient = postgres({
    host: sql.options.host[0],
    port: sql.options.port[0],
    database: sql.options.database,
    user: sql.options.user,
    password: sql.options.pass ?? undefined,
    ssl: sql.options.ssl,
    connection: sql.options.connection,
    onnotice: sql.options.onnotice,
    max: 1,
    idle_timeout: 0,
    max_lifetime: null,
    connect_timeout: 10,
    onclose: () => {
      lockLost = true
    },
  })
  const connection = await lockClient.reserve()
  let locked = false
  let backendPid = 0
  try {
    // Session settings also bound discovery and the first lock attempt.
    await connection`SET statement_timeout = '30s'`
    await connection`SET lock_timeout = '2s'`
    const [identity] = await connection<{ pid: number; locked: boolean }[]>`
      SELECT pg_backend_pid() AS pid, pg_try_advisory_lock(hashtextextended(${RUN_LOCK}, 0)) AS locked
    `
    locked = identity.locked
    backendPid = identity.pid
    if (!locked) throw new Error('Another Project backfill run holds the maintenance lock')
    const assertLock = async () => {
      if (lockLost) throw new Error('Project backfill maintenance lock was lost')
      const [state] = await connection<{ held: boolean }[]>`
        SELECT pg_backend_pid() = ${backendPid} AND EXISTS (
          SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()
          AND classid = ((hashtextextended(${RUN_LOCK}, 0) >> 32) & 4294967295)::oid
          AND objid = (hashtextextended(${RUN_LOCK}, 0) & 4294967295)::oid AND objsubid = 1 AND granted
        ) AS held
      `
      if (!state.held) throw new Error('Project backfill maintenance lock was lost')
    }
    const transaction = async <T>(
      work: (tx: BackfillSql) => Promise<T>,
      write = false
    ): Promise<T> =>
      withDatabaseRetry(
        async () => {
          await assertLock()
          const result = await sql.begin(async (tx) => {
            await configureTransaction(tx)
            const value = await work(tx)
            await assertLock()
            return value
          })
          return result as T
        },
        write,
        report,
        stopped
      )
    await checkpoint()
    if (source) {
      for (const family of source.plan) {
        if (stopped()) break
        const outcome = await transaction((tx) => applyFamily(tx, family, maximum), true)
        report.scanned += family.workspaceIds.length
        report.families++
        if (outcome.conflict) report.conflicts.push(outcome.conflict)
        report.createdProjects += outcome.created
        report.assignedWorkspaces += outcome.assigned
        if (!outcome.conflict && outcome.assigned === 0) report.unchangedFamilies++
        await checkpoint()
      }
      report.completed = report.families === source.plan.length
    } else {
      let afterId = ''
      for (;;) {
        if (stopped()) break
        const page = await transaction(
          (tx) =>
            tx<
              { id: string }[]
            >`SELECT id FROM workspace WHERE id > ${afterId} ORDER BY id LIMIT 100`
        )
        if (!page.length) {
          report.completed = true
          break
        }
        for (const candidate of page) {
          if (stopped()) break
          if (++report.scanned > MAX_WORKSPACES) throw new Error('Workspace scan limit exceeded')
          const discovery = await transaction(async (tx) => {
            const [root] = await tx<{ id: string; parent: string | null; cycle: boolean }[]>`
              WITH RECURSIVE ancestors AS (
                SELECT id, forked_from_workspace_id AS parent, ARRAY[id] AS path, false AS cycle, 0 AS depth FROM workspace WHERE id = ${candidate.id}
                UNION ALL
                SELECT w.id, w.forked_from_workspace_id, a.path || w.id, w.id = ANY(a.path), a.depth + 1
                FROM workspace w JOIN ancestors a ON w.id = a.parent WHERE NOT a.cycle AND a.depth < 1000
              ) SELECT id, parent, cycle FROM ancestors ORDER BY depth DESC LIMIT 1
            `
            if (!root || root.cycle || root.parent !== null)
              return {
                conflict: conflict(
                  candidate.id,
                  'Cycle, missing parent, or lineage depth exceeds 1000',
                  [candidate.id]
                ),
              }
            if (root.id !== candidate.id) return null
            return inspectFamily(tx, root.id, maximum)
          })
          if (discovery) {
            if (discovery.conflict) report.conflicts.push(discovery.conflict)
            else {
              report.families++
              const suffix = ' - Project'
              report.plan.push({
                rootId: candidate.id,
                projectId: discovery.existingId ?? generateId(),
                workspaceIds: discovery.ids,
                fingerprint: fingerprint(discovery.family),
                name: `${truncate(discovery.root.name.trim() || 'Untitled', 100 - suffix.length, '')}${suffix}`,
              })
              report.createdProjects += discovery.existingId ? 0 : 1
              report.assignedWorkspaces += discovery.missing
              if (discovery.missing === 0) report.unchangedFamilies++
            }
          }
          afterId = candidate.id
        }
        await checkpoint()
      }
      if (report.completed) report.conflicts.push(...(await transaction(inspectGlobalState)))
    }
    report.ready =
      options.mode === 'verify' &&
      report.completed &&
      !report.conflicts.length &&
      report.assignedWorkspaces === 0
    if (!report.completed)
      report.stopped = 'Interrupted or runtime budget exhausted; rerun from the same plan'
    report.finishedAt = new Date().toISOString()
    await checkpoint()
    return report
  } catch (error) {
    report.completed = false
    report.ready = false
    report.errorCode = getPostgresErrorCode(error)
    report.stopped = report.errorCode
      ? `Database operation failed (${report.errorCode}); reconcile before retrying writes`
      : 'Run failed; inspect operator logs and last checkpoint'
    report.finishedAt = new Date().toISOString()
    await checkpoint()
    throw error
  } finally {
    try {
      if (locked && !lockLost)
        await connection`SELECT pg_advisory_unlock(hashtextextended(${RUN_LOCK}, 0))`
    } finally {
      connection.release()
      await lockClient.end({ timeout: 2 })
    }
  }
}
