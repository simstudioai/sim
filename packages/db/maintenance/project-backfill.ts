import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { countPendingProjectArchiveRepairs } from '@sim/db/maintenance/project-repairs'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { compareStrings, truncateAtCodePoint } from '@sim/utils/string'
import type { Sql, TransactionSql } from 'postgres'

const logger = createLogger('ProjectBackfill')
const MAX_WORKSPACES = 250_000
const MAX_FAMILY = 1_000

export type ProjectBackfillWorkspace = {
  id: string
  parentId: string | null
  ownerId: string
  organizationId: string | null
  archivedAt: string | null
  projectId: string | null
  legacyProjectId: string | null
}

interface ProjectBackfillFamily {
  rootId: string
  members: ProjectBackfillWorkspace[]
  projectMembers?: ProjectBackfillWorkspace[]
}

export interface ProjectArchiveRepair {
  workspaceId: string
  archivedAt: string
  workflowIds: string[]
}

export interface ProjectGroupingReview {
  projectId: string
  evidence: string
  members: ProjectBackfillWorkspace[]
  destinationProjectId: string
  roots: string[]
  decision: 'pending' | 'retain' | 'detach'
  detachRootId?: string
}

interface ProjectBackfillManifest {
  version: 1
  databaseId: string
  createdAt: string
  families: ProjectBackfillFamily[]
  repairs: ProjectArchiveRepair[]
  groupings: ProjectGroupingReview[]
  conflicts: { id: string; reason: string }[]
}

/** A changed plan or ambiguous legacy state requires new discovery, never a guessed merge. */
export class ProjectBackfillConflict extends Error {
  readonly code = '55000'
}

/** Contention releases the whole transaction before the controller defers the work. */
export class ProjectBackfillBusy extends Error {}

/** Non-secret identity binds reviewed intent to one database endpoint and database name. */
export function projectBackfillDatabaseId(url: string): string {
  const target = new URL(url)
  return createHash('sha256')
    .update(
      JSON.stringify({
        host: target.hostname.toLowerCase() || process.env.PGHOST || 'localhost',
        port: target.port || process.env.PGPORT || '5432',
        database: target.pathname,
        routing: [
          'host',
          'hostaddr',
          'hostname',
          'port',
          'database',
          'dbname',
          'service',
          'servicefile',
          'target_session_attrs',
        ].map((key) => [key, target.searchParams.getAll(key)]),
      })
    )
    .digest('hex')
}

/** Binds an explicit grouping decision to membership, lineage, lifecycle and ownership evidence. */
export function projectGroupingEvidence(rows: ProjectBackfillWorkspace[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        [...rows]
          .sort((a, b) => compareStrings(a.id, b.id))
          .map((row) => ({
            id: row.id,
            parentId: row.parentId,
            ownerId: row.ownerId,
            organizationId: row.organizationId,
            archivedAt: row.archivedAt,
            projectId: effectiveProjectId(row),
          }))
      )
    )
    .digest('hex')
}

function isProjectBackfillWorkspace(value: unknown): value is ProjectBackfillWorkspace {
  return (
    isRecordLike(value) &&
    typeof value.id === 'string' &&
    typeof value.ownerId === 'string' &&
    ['parentId', 'organizationId', 'archivedAt', 'projectId', 'legacyProjectId'].every(
      (key) => value[key] === null || typeof value[key] === 'string'
    )
  )
}

/** Exceptional operator review stays in the existing private manifest, never the retiring connector. */
export async function readProjectGroupingReviews(
  path: string,
  databaseId: string
): Promise<ProjectGroupingReview[]> {
  if ((await stat(path)).size > 128 * 1024 * 1024)
    throw new Error('Project review exceeds artifact size limit')
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (
    !isRecordLike(value) ||
    value.version !== 1 ||
    value.databaseId !== databaseId ||
    !Array.isArray(value.groupings)
  )
    throw new Error('Project grouping review does not match this database')
  const reviews: ProjectGroupingReview[] = []
  for (const item of value.groupings) {
    if (
      !isRecordLike(item) ||
      !Array.isArray(item.members) ||
      item.members.length > MAX_FAMILY ||
      !item.members.every(isProjectBackfillWorkspace) ||
      typeof item.destinationProjectId !== 'string' ||
      typeof item.projectId !== 'string' ||
      typeof item.evidence !== 'string' ||
      !Array.isArray(item.roots) ||
      item.roots.length > MAX_FAMILY ||
      !item.roots.every((root): root is string => typeof root === 'string') ||
      !['pending', 'retain', 'detach'].includes(String(item.decision)) ||
      (item.detachRootId !== undefined && typeof item.detachRootId !== 'string')
    )
      throw new Error('Invalid Project grouping review')
    if (projectGroupingEvidence(item.members) !== item.evidence)
      throw new Error('Project grouping evidence does not match the reviewed members')
    if (reviews.some((review) => review.projectId === item.projectId))
      throw new Error('Duplicate Project grouping review')
    reviews.push({
      projectId: item.projectId,
      evidence: item.evidence,
      members: item.members,
      destinationProjectId: item.destinationProjectId,
      roots: item.roots,
      decision: item.decision as ProjectGroupingReview['decision'],
      ...(typeof item.detachRootId === 'string' ? { detachRootId: item.detachRootId } : {}),
    })
  }
  return reviews
}

/** Checks physical prerequisites without trusting a local migration journal or a CLI flag. */
export async function assertProjectBackfillDatabase(sql: Sql, write: boolean): Promise<void> {
  const [state] = await sql`
    SELECT pg_is_in_recovery() AS replica, current_setting('transaction_read_only') AS readonly,
      current_setting('server_version_num')::int AS version,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
        AND table_name = 'workspace' AND column_name = 'project_id') AS expanded
  `
  if (!state?.expanded) throw new Error('Deploy #8830 before Project preparation')
  if (state.version < 160000) throw new Error('Project preparation requires PostgreSQL 16+')
  if (write && (state.replica || state.readonly === 'on'))
    throw new Error('Project writes require the primary database')
}

/** The contract locks workspace before retiring the connector; this read lock spans each query batch. */
async function hasLegacyMemberships(tx: TransactionSql): Promise<boolean> {
  await tx`LOCK TABLE workspace IN ACCESS SHARE MODE`
  const [state] = await tx`SELECT to_regclass('public.project_workspace') IS NOT NULL AS present`
  return state.present
}

function legacyAssignment(tx: TransactionSql, legacy: boolean) {
  return legacy
    ? tx`(SELECT pw.project_id FROM project_workspace pw WHERE pw.workspace_id = w.id)`
    : tx`NULL::text`
}

function effectiveProjectId(row: ProjectBackfillWorkspace): string | null {
  return row.projectId ?? row.legacyProjectId
}

/** Bounded discovery materializes only identity/scope metadata, never workflow content. */
export async function discoverProjectBackfill(
  sql: Sql,
  databaseId: string,
  reviews: ProjectGroupingReview[] = []
): Promise<ProjectBackfillManifest> {
  const rows: ProjectBackfillWorkspace[] = []
  let legacyPresent = false
  let after = ''
  for (;;) {
    const page = await sql.begin(async (tx) => {
      const legacy = await hasLegacyMemberships(tx)
      legacyPresent ||= legacy
      return tx<ProjectBackfillWorkspace[]>`
        SELECT w.id, w.forked_from_workspace_id AS "parentId", w.owner_id AS "ownerId",
          w.organization_id AS "organizationId", w.archived_at::text AS "archivedAt",
          w.project_id AS "projectId", ${legacyAssignment(tx, legacy)} AS "legacyProjectId"
        FROM workspace w WHERE w.id COLLATE "C" > ${after} COLLATE "C"
        ORDER BY w.id COLLATE "C" LIMIT 1000
      `
    })
    if (!page.length) break
    rows.push(...page)
    if (rows.length > MAX_WORKSPACES)
      throw new Error('Project discovery exceeds the workspace limit')
    after = page[page.length - 1].id
  }
  const manifest: ProjectBackfillManifest = {
    version: 1,
    databaseId,
    createdAt: new Date().toISOString(),
    families: [],
    repairs: [],
    groupings: [],
    conflicts: [],
  }
  const byId = new Map(rows.map((row) => [row.id, row]))
  const rootById = new Map<string, string | null>()
  const groups = new Map<string, ProjectBackfillWorkspace[]>()
  for (const row of rows) {
    let current: ProjectBackfillWorkspace | undefined = row
    const path = new Set<string>()
    let root: string | null = null
    while (current) {
      if (rootById.has(current.id)) {
        root = rootById.get(current.id) ?? null
        break
      }
      if (path.has(current.id)) break
      path.add(current.id)
      if (!current.parentId) {
        root = current.id
        break
      }
      current = byId.get(current.parentId)
    }
    for (const id of path) rootById.set(id, root)
    if (!root) {
      manifest.conflicts.push({ id: row.id, reason: 'Fork cycle or missing parent' })
      continue
    }
    const group = groups.get(root)
    if (group) group.push(row)
    else groups.set(root, [row])
  }
  const projects = await sql<
    { id: string; ownerId: string; organizationId: string | null; archivedAt: string | null }[]
  >`
    SELECT id, owner_id AS "ownerId", organization_id AS "organizationId", archived_at::text AS "archivedAt" FROM project LIMIT 250001
  `
  if (projects.length > MAX_WORKSPACES)
    throw new Error('Project discovery exceeds the Project limit')
  const affectedProjects = new Set<string>()
  const projectMembers = new Map<string, ProjectBackfillWorkspace[]>()
  for (const row of rows) {
    const id = effectiveProjectId(row)
    if (!id) continue
    const members = projectMembers.get(id) ?? []
    members.push(row)
    projectMembers.set(id, members)
  }
  for (const project of projects) {
    const members = projectMembers.get(project.id) ?? []
    if (!members.length) {
      manifest.conflicts.push({
        id: project.id,
        reason: 'Empty Project requires explicit dependency review and operator remediation',
      })
      continue
    }
    const roots = new Set(members.map((row) => rootById.get(row.id)))
    if (
      roots.size > 1 &&
      members.some((row) => row.parentId === null && row.legacyProjectId !== project.id)
    ) {
      if (legacyPresent) {
        const evidence = projectGroupingEvidence(members)
        const reviewed = reviews.find(
          (review) => review.projectId === project.id && review.evidence === evidence
        )
        const decision = reviewed?.decision ?? 'pending'
        if (members.length > MAX_FAMILY) {
          manifest.conflicts.push({
            id: project.id,
            reason: 'Oversized ambiguous Project grouping requires operator remediation',
          })
          continue
        }
        manifest.groupings.push({
          projectId: project.id,
          evidence,
          members,
          destinationProjectId: reviewed?.destinationProjectId ?? generateId(),
          roots: [...roots]
            .filter((root): root is string => typeof root === 'string')
            .sort(compareStrings),
          decision,
          ...(reviewed?.detachRootId ? { detachRootId: reviewed.detachRootId } : {}),
        })
        if (decision !== 'retain')
          manifest.conflicts.push({
            id: project.id,
            reason:
              'Ambiguous multi-root Project grouping; review this manifest grouping or repair the known detached family before rediscovery',
          })
      }
    }
    if (
      new Set(members.map((row) => row.organizationId)).size !== 1 ||
      (!members[0].organizationId && members.some((row) => row.ownerId !== project.ownerId))
    ) {
      affectedProjects.add(project.id)
    }
    if (
      members.some((row) => row.organizationId !== project.organizationId) ||
      (project.archivedAt === null) !== members.some((row) => row.archivedAt === null)
    )
      affectedProjects.add(project.id)
  }
  const plannedProjectMembers = new Map(
    [...projectMembers].map(([id, members]) => [id, [...members]])
  )
  for (const members of groups.values()) {
    const projectIds = [
      ...new Set(members.map(effectiveProjectId).filter((id): id is string => id !== null)),
    ]
    if (projectIds.length !== 1) continue
    const planned = plannedProjectMembers.get(projectIds[0])
    if (planned) planned.push(...members.filter((row) => effectiveProjectId(row) === null))
  }
  const scheduledMetadata = new Set<string>()
  for (const [rootId, members] of groups) {
    const family = { rootId, members }
    try {
      const complete =
        members.every((row) => row.projectId !== null) &&
        new Set(members.map((row) => row.projectId)).size === 1
      validateFamily(family, complete)
      if (
        complete &&
        !members.some(
          (row) =>
            row.projectId &&
            affectedProjects.has(row.projectId) &&
            !scheduledMetadata.has(row.projectId)
        )
      )
        continue
      validateFamily(family)
      const projectId = members.map(effectiveProjectId).find((id) => id !== null)
      if (projectId && (plannedProjectMembers.get(projectId)?.length ?? 0) > MAX_FAMILY)
        throw new ProjectBackfillConflict('Oversized Project repair requires operator remediation')
      if (projectId) scheduledMetadata.add(projectId)
      manifest.families.push({
        ...family,
        ...(projectId ? { projectMembers: plannedProjectMembers.get(projectId) } : {}),
      })
    } catch (error) {
      if (!(error instanceof ProjectBackfillConflict)) throw error
      manifest.conflicts.push({ id: rootId, reason: error.message })
    }
  }
  manifest.families.sort((a, b) => compareStrings(a.rootId, b.rootId))
  let afterWorkflow = ''
  const repairs = new Map<string, ProjectArchiveRepair>()
  for (;;) {
    const page = await sql<{ id: string; workspaceId: string; archivedAt: string }[]>`
      SELECT f.id, w.id AS "workspaceId", w.archived_at::text AS "archivedAt"
      FROM workflow f JOIN workspace w ON w.id = f.workspace_id
      WHERE w.archived_at IS NOT NULL AND f.archived_at IS NULL
        AND f.id COLLATE "C" > ${afterWorkflow} COLLATE "C"
      ORDER BY f.id COLLATE "C" LIMIT 1000
    `
    if (!page.length) break
    for (const row of page) {
      const repair = repairs.get(row.workspaceId) ?? {
        workspaceId: row.workspaceId,
        archivedAt: row.archivedAt,
        workflowIds: [],
      }
      repair.workflowIds.push(row.id)
      if (repair.workflowIds.length > MAX_FAMILY)
        throw new Error(`Archive repair exceeds workflow limit: ${row.workspaceId}`)
      repairs.set(row.workspaceId, repair)
    }
    afterWorkflow = page[page.length - 1].id
    if (repairs.size > MAX_WORKSPACES) throw new Error('Too many archive repairs')
  }
  manifest.repairs = [...repairs.values()].sort((a, b) =>
    compareStrings(a.workspaceId, b.workspaceId)
  )
  logger.info('Project discovery finished', {
    workspaces: rows.length,
    families: manifest.families.length,
    repairs: manifest.repairs.length,
    conflicts: manifest.conflicts.length,
  })
  return manifest
}

function validateFamily(family: ProjectBackfillFamily, complete = false): void {
  const root = family.members.find((row) => row.id === family.rootId)
  if (!root || root.parentId || (!complete && family.members.length > MAX_FAMILY))
    throw new ProjectBackfillConflict('Invalid or oversized fork family')
  const members = new Map(family.members.map((row) => [row.id, row]))
  if (members.size !== family.members.length)
    throw new ProjectBackfillConflict('Duplicate family member')
  const connected = new Set([root.id])
  for (const row of family.members) {
    let current = row
    const visited = new Set<string>()
    while (!connected.has(current.id)) {
      if (visited.has(current.id)) throw new ProjectBackfillConflict('Cyclic family')
      visited.add(current.id)
      const parent = current.parentId ? members.get(current.parentId) : undefined
      if (!parent) throw new ProjectBackfillConflict('Disconnected family member')
      current = parent
    }
    for (const id of visited) connected.add(id)
  }
  if (family.members.some((row) => row.organizationId !== root.organizationId))
    throw new ProjectBackfillConflict('Fork family spans organizations')
  if (!root.organizationId && family.members.some((row) => row.ownerId !== root.ownerId))
    throw new ProjectBackfillConflict(
      'Personal family has multiple lifecycle owners; select an owner before rediscovery'
    )
  if (new Set(family.members.map(effectiveProjectId).filter(Boolean)).size > 1)
    throw new ProjectBackfillConflict('Fork family spans Projects')
}

/** All lock keys match deployed writers; nonblocking acquisition avoids lock-order inversions. */
export async function tryProjectBackfillLocks(tx: TransactionSql, keys: string[]): Promise<void> {
  const [result] = await tx`
    SELECT bool_and(pg_try_advisory_xact_lock(hashtextextended(key, 0))) AS acquired
    FROM unnest(${keys}::text[]) AS key /*lock='project_backfill'*/
  `
  if (!result?.acquired) throw new ProjectBackfillBusy('Project backfill target is busy')
}

/** Writes at most 50 independent families, or one complete fork family, in a bounded transaction. */
export async function assignProjectBackfillBatch(sql: Sql, families: ProjectBackfillFamily[]) {
  if (
    !families.length ||
    families.length > 50 ||
    (families.length > 1 && families.some((f) => f.members.length !== 1))
  )
    throw new Error('Expected 1–50 singletons or one complete fork family')
  for (const family of families) validateFamily(family)
  return sql.begin(async (tx) => {
    await tx`SELECT set_config(CASE WHEN current_setting('transaction_timeout', true) IS NULL
      THEN 'idle_in_transaction_session_timeout' ELSE 'transaction_timeout' END, '5s', true)`
    await tx`SET LOCAL statement_timeout = '3s'`
    await tx`SET LOCAL lock_timeout = '250ms'`
    const legacy = await hasLegacyMemberships(tx)
    const roots = families.map((f) => f.rootId).sort(compareStrings)
    const expected = families.flatMap((f) => f.members).sort((a, b) => compareStrings(a.id, b.id))
    const ids = expected.map((row) => row.id)
    if (new Set(ids).size !== ids.length)
      throw new ProjectBackfillConflict('Duplicate workspace in batch')
    await tryProjectBackfillLocks(
      tx,
      roots.map((id) => `fork-lineage:${id}`)
    )
    await tryProjectBackfillLocks(
      tx,
      ids.map((id) => `project-backfill:${id}`)
    )
    const before = await tx<{ projectId: string }[]>`
      SELECT DISTINCT coalesce(w.project_id, ${legacyAssignment(tx, legacy)}) COLLATE "C" AS "projectId"
      FROM workspace w WHERE w.id = ANY(${ids})
        AND coalesce(w.project_id, ${legacyAssignment(tx, legacy)}) IS NOT NULL
      ORDER BY "projectId"
    `
    if (before.length)
      await tryProjectBackfillLocks(
        tx,
        before.map((row) => `project:${row.projectId}`)
      )
    await tx`SELECT id FROM workspace WHERE id = ANY(${ids}) ORDER BY id COLLATE "C" FOR NO KEY UPDATE NOWAIT`
    if (legacy) {
      await tx`SELECT pw.workspace_id FROM project_workspace pw JOIN workspace w ON w.id = pw.workspace_id
        WHERE w.id = ANY(${ids}) AND w.project_id IS NULL
        ORDER BY pw.workspace_id COLLATE "C" FOR SHARE OF pw NOWAIT`
    }
    const current = await tx<(ProjectBackfillWorkspace & { name: string })[]>`
      SELECT w.id, w.name, w.forked_from_workspace_id AS "parentId", w.owner_id AS "ownerId",
        w.organization_id AS "organizationId", w.archived_at::text AS "archivedAt",
        w.project_id AS "projectId", ${legacyAssignment(tx, legacy)} AS "legacyProjectId"
      FROM workspace w WHERE w.id = ANY(${ids}) ORDER BY w.id COLLATE "C"
    `
    const lockedProjects = new Set(before.map((row) => row.projectId))
    const newProjects = [...new Set(current.map(effectiveProjectId))]
      .filter((id): id is string => id !== null && !lockedProjects.has(id))
      .sort(compareStrings)
    if (newProjects.length)
      await tryProjectBackfillLocks(
        tx,
        newProjects.map((id) => `project:${id}`)
      )
    if (current.length !== expected.length)
      throw new ProjectBackfillConflict('A reviewed workspace disappeared; rediscover')
    const byId = new Map(current.map((row) => [row.id, row]))
    for (const row of expected) {
      const actual = byId.get(row.id)
      if (
        !actual ||
        actual.parentId !== row.parentId ||
        actual.ownerId !== row.ownerId ||
        actual.organizationId !== row.organizationId ||
        actual.archivedAt !== row.archivedAt ||
        (row.projectId !== null && actual.projectId !== row.projectId) ||
        (effectiveProjectId(row) !== null &&
          effectiveProjectId(actual) !== effectiveProjectId(row)) ||
        (actual.projectId === null && actual.legacyProjectId !== row.legacyProjectId)
      )
        throw new ProjectBackfillConflict(
          'Reviewed workspace scope, owner, archive state or assignment changed; rediscover'
        )
    }
    const children =
      await tx`SELECT id FROM workspace WHERE forked_from_workspace_id = ANY(${ids}) AND NOT id = ANY(${ids}) LIMIT 1`
    if (children.length)
      throw new ProjectBackfillConflict('Reviewed fork family gained descendants; rediscover')
    const invalidArchive =
      await tx`SELECT f.id FROM workflow f JOIN workspace w ON w.id = f.workspace_id
      WHERE w.id = ANY(${ids}) AND w.archived_at IS NOT NULL AND f.archived_at IS NULL LIMIT 1`
    if (invalidArchive.length)
      throw new ProjectBackfillConflict('Archive repair is required before assignment')
    const inserts: {
      id: string
      name: string
      owner_id: string
      organization_id: string | null
      archived_at: string | null
    }[] = []
    const assignments: { id: string; project_id: string }[] = []
    let alreadyAssigned = 0
    for (const family of families) {
      const root = byId.get(family.rootId)
      if (!root) throw new ProjectBackfillConflict('Root disappeared')
      const members = family.members
        .map((row) => byId.get(row.id))
        .filter((row) => row !== undefined)
      const projectIds = [
        ...new Set(members.map(effectiveProjectId).filter((id): id is string => id !== null)),
      ]
      if (projectIds.length > 1) throw new ProjectBackfillConflict('Family now spans Projects')
      const archiveAt = members.every((row) => row.archivedAt !== null)
        ? (members
            .map((row) => row.archivedAt ?? '')
            .sort(compareStrings)
            .at(-1) ?? null)
        : null
      let projectId = projectIds[0]
      if (projectId) {
        const [existing] =
          await tx`SELECT owner_id, organization_id, archived_at::text FROM project WHERE id = ${projectId} FOR NO KEY UPDATE NOWAIT`
        const reviewedIds = family.projectMembers?.map((row) => row.id) ?? []
        const evidenceRows = await tx<ProjectBackfillWorkspace[]>`
          SELECT w.id, w.owner_id AS "ownerId", w.organization_id AS "organizationId", w.archived_at::text AS "archivedAt",
            w.forked_from_workspace_id AS "parentId", w.project_id AS "projectId", ${legacyAssignment(tx, legacy)} AS "legacyProjectId"
          FROM workspace w WHERE coalesce(w.project_id, ${legacyAssignment(tx, legacy)}) = ${projectId}
            OR w.id = ANY(${reviewedIds})
          ORDER BY w.id COLLATE "C" LIMIT 1001 FOR NO KEY UPDATE NOWAIT
        `
        const environments = evidenceRows.filter((row) => effectiveProjectId(row) === projectId)
        if (!existing || evidenceRows.length > MAX_FAMILY)
          throw new ProjectBackfillConflict(
            'Missing Project or oversized Project repair; operator remediation required'
          )
        if (family.projectMembers) {
          const reviewed = new Map(
            [
              ...family.projectMembers,
              ...family.members.filter((row) => effectiveProjectId(row) === null),
            ].map((row) => [row.id, row])
          )
          const currentIds = new Set(evidenceRows.map((row) => row.id))
          if (
            family.projectMembers.some((row) => !currentIds.has(row.id)) ||
            evidenceRows.some((row) => {
              const expected = reviewed.get(row.id)
              return (
                !expected ||
                row.parentId !== expected.parentId ||
                row.ownerId !== expected.ownerId ||
                row.organizationId !== expected.organizationId ||
                row.archivedAt !== expected.archivedAt ||
                (effectiveProjectId(expected) !== null
                  ? effectiveProjectId(row) !== effectiveProjectId(expected)
                  : effectiveProjectId(row) !== null && effectiveProjectId(row) !== projectId)
              )
            })
          )
            throw new ProjectBackfillConflict('Reviewed Project membership changed; rediscover')
        }
        const allMembers = [
          ...environments,
          ...members.filter((row) => effectiveProjectId(row) === null),
        ]
        if (
          allMembers.some((row) => row.organizationId !== root.organizationId) ||
          (!root.organizationId && allMembers.some((row) => row.ownerId !== existing.owner_id)) ||
          (existing.organization_id !== root.organizationId &&
            allMembers.some((row) => row.ownerId !== existing.owner_id))
        )
          throw new ProjectBackfillConflict(
            'Existing Project has ambiguous ownership or scope; operator remediation required'
          )
        const projectArchiveAt = allMembers.some((row) => row.archivedAt === null)
          ? null
          : (allMembers
              .map((row) => row.archivedAt ?? '')
              .sort(compareStrings)
              .at(-1) ?? null)
        if (
          existing.organization_id !== root.organizationId ||
          (existing.archived_at === null) !== (projectArchiveAt === null)
        ) {
          if (!family.projectMembers)
            throw new ProjectBackfillConflict(
              'Project repair needs fresh Project-wide evidence; rediscover'
            )
          await tx`UPDATE project SET organization_id = ${root.organizationId},
            archived_at = ${projectArchiveAt}::text::timestamp, updated_at = now() WHERE id = ${projectId}`
        }
      } else {
        projectId = generateId()
        inserts.push({
          id: projectId,
          name: `${truncateAtCodePoint(root.name.trim() || 'Untitled', 90, '')} - Project`,
          owner_id: root.ownerId,
          organization_id: root.organizationId,
          archived_at: archiveAt,
        })
      }
      for (const member of members) {
        if (member.projectId) alreadyAssigned++
        else assignments.push({ id: member.id, project_id: projectId })
      }
    }
    if (inserts.length)
      await tx`INSERT INTO project (id,name,owner_id,organization_id,archived_at)
      SELECT id,name,owner_id,organization_id,archived_at::timestamp FROM jsonb_to_recordset(${JSON.stringify(inserts)}::text::jsonb)
      AS p(id text,name text,owner_id text,organization_id text,archived_at text)`
    let assigned = 0
    if (assignments.length) {
      const result = await tx`UPDATE workspace w SET project_id = p.project_id
        FROM jsonb_to_recordset(${JSON.stringify(assignments)}::text::jsonb) AS p(id text, project_id text)
        WHERE w.id = p.id AND w.project_id IS NULL RETURNING w.id`
      assigned = result.length
      if (assigned !== assignments.length)
        throw new ProjectBackfillConflict('Assignment changed while locked')
    }
    return { assigned, alreadyAssigned, projectsCreated: inserts.length }
  })
}

/** Fresh whole-database validation is independent of manifest pagination and progress counters. */
export async function verifyProjectBackfill(sql: Sql): Promise<Record<string, number>> {
  const [counts] = await sql<Record<string, number>[]>`
    SELECT
      (SELECT count(*)::int FROM workspace WHERE project_id IS NULL) AS unassigned,
      (SELECT count(*)::int FROM workspace w LEFT JOIN project p ON p.id = w.project_id
        WHERE w.project_id IS NOT NULL AND (p.id IS NULL OR w.organization_id IS DISTINCT FROM p.organization_id)) AS scope,
      (SELECT count(*)::int FROM workspace w LEFT JOIN workspace parent ON parent.id = w.forked_from_workspace_id
        WHERE w.forked_from_workspace_id IS NOT NULL AND (parent.id IS NULL OR parent.project_id IS DISTINCT FROM w.project_id)) AS lineage,
      (SELECT count(*)::int FROM project p WHERE NOT EXISTS (SELECT 1 FROM workspace w WHERE w.project_id = p.id)
        OR (p.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM workspace w WHERE w.project_id = p.id AND w.archived_at IS NULL))
        OR (p.archived_at IS NOT NULL AND EXISTS (SELECT 1 FROM workspace w WHERE w.project_id = p.id AND w.archived_at IS NULL))) AS projects,
      (SELECT count(*)::int FROM workflow f JOIN workspace w ON w.id = f.workspace_id
        LEFT JOIN project p ON p.id = w.project_id WHERE f.archived_at IS NULL AND (w.archived_at IS NOT NULL OR p.archived_at IS NOT NULL)) AS archive,
      (SELECT count(*)::int FROM project p LEFT JOIN "user" u ON u.id = p.owner_id
        LEFT JOIN organization o ON o.id = p.organization_id WHERE u.id IS NULL OR (p.organization_id IS NOT NULL AND o.id IS NULL)) AS owners,
      (WITH RECURSIVE reachable(id) AS (SELECT id FROM workspace WHERE forked_from_workspace_id IS NULL
        UNION SELECT w.id FROM workspace w JOIN reachable r ON w.forked_from_workspace_id = r.id)
        SELECT count(*)::int FROM workspace w LEFT JOIN reachable r ON r.id = w.id WHERE r.id IS NULL) AS unreachable
  `
  counts.pendingCleanup = await countPendingProjectArchiveRepairs(sql)
  return counts
}
