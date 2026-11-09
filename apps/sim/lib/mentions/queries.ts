import { db, dbReplica } from '@sim/db'
import {
  copilotChats,
  dashboard,
  folder,
  jobExecutionLogs,
  knowledgeBase,
  skill,
  userTableDefinitions,
  workflow,
  workflowExecutionLogs,
  workspaceFiles,
} from '@sim/db/schema'
import { escapeLikePattern } from '@sim/utils/string'
import { and, asc, desc, eq, ilike, inArray, isNull, or, type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core'
import { BUILTIN_SKILLS } from '@/lib/workflows/skills/builtin-skills'
import { activeWorkspaceFileConditions } from '@/lib/workspace-files/query-scope'

/**
 * Batched mention reads: one query per family across every workspace the caller already
 * authorized, with each family's own list predicates. They perform no authorization.
 */

/** How a family is read: an `@` question's best rows, or one browsed page in name order. */
export interface MentionReadSpec {
  workspaceIds: readonly string[]
  /** The trimmed query, lowercased; empty for the most recently updated rows. */
  query: string
  /** Workspaces whose name the query matches: every row in them matches too. */
  matchedWorkspaceIds: readonly string[]
  limit: number
  /** A browse page: rows in name order from `offset`, inside `folderId` when given. */
  page?: { offset: number; folderId?: string }
}

export interface MentionRecord {
  id: string
  name: string
  /** `null` only for a built-in skill. */
  workspaceId: string | null
  updatedAt: Date
  /** The folder holding the row, or a folder row's parent; `null` at the root. */
  parentId: string | null
  folderFamily?: string
  detail?: string
  executionId?: string
  workflowLabel?: string
}

interface MentionSource {
  table: PgTable
  id: AnyPgColumn
  name: AnyPgColumn | SQL<string>
  workspaceId: AnyPgColumn
  updatedAt: AnyPgColumn
  parentId?: AnyPgColumn
  /** The family's own list predicate, beyond the workspace set. */
  where?: SQL
  /** Rows a query matches without matching their names, such as a family label. */
  alsoMatches?: SQL
}

const nameRank = (name: AnyPgColumn | SQL<string>, query: string) =>
  sql<number>`case when lower(${name}) = ${query} then 0 when ${ilike(name, `${escapeLikePattern(query)}%`)} then 1 when ${ilike(name, `%${escapeLikePattern(query)}%`)} then 2 else 3 end`

function matchCondition(source: MentionSource, spec: MentionReadSpec): SQL | undefined {
  if (!spec.query || spec.page) return undefined
  return or(
    ilike(source.name, `%${escapeLikePattern(spec.query)}%`),
    spec.matchedWorkspaceIds.length
      ? inArray(source.workspaceId, [...spec.matchedWorkspaceIds])
      : undefined,
    source.alsoMatches
  )
}

async function readSource(
  source: MentionSource,
  spec: MentionReadSpec,
  extra: { folderFamily?: AnyPgColumn } = {}
) {
  if (!spec.workspaceIds.length) return []
  const folderId = spec.page?.folderId
  const query = db
    .select({
      id: source.id,
      name: source.name,
      workspaceId: source.workspaceId,
      updatedAt: source.updatedAt,
      parentId: source.parentId ?? sql<string | null>`null`,
      folderFamily: extra.folderFamily ?? sql<string | null>`null`,
    })
    .from(source.table)
    .where(
      and(
        inArray(source.workspaceId, [...spec.workspaceIds]),
        source.where,
        matchCondition(source, spec),
        folderId && source.parentId ? eq(source.parentId, folderId) : undefined
      )
    )
  const ordered = spec.page
    ? query.orderBy(asc(sql`lower(${source.name})`), asc(source.id)).offset(spec.page.offset)
    : spec.query
      ? query.orderBy(asc(nameRank(source.name, spec.query)), desc(source.updatedAt))
      : query.orderBy(desc(source.updatedAt))
  return ordered.limit(spec.limit)
}

function records(
  rows: Awaited<ReturnType<typeof readSource>>,
  labels: Record<string, string> = {}
): MentionRecord[] {
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    workspaceId: row.workspaceId === null ? null : String(row.workspaceId),
    updatedAt: new Date(String(row.updatedAt)),
    parentId: row.parentId === null ? null : String(row.parentId),
    ...(row.folderFamily === null ? {} : { folderFamily: labels[String(row.folderFamily)] }),
  }))
}

/** `listWorkspaceWorkflowItems`: live workflows. */
export async function readWorkflowMentions(spec: MentionReadSpec) {
  return records(
    await readSource(
      {
        table: workflow,
        id: workflow.id,
        name: workflow.name,
        workspaceId: workflow.workspaceId,
        updatedAt: workflow.updatedAt,
        parentId: workflow.folderId,
        where: isNull(workflow.archivedAt),
      },
      spec
    )
  )
}

/** `listMothershipChats`: the viewer's own live, non-benchmark chats. */
export async function readChatMentions(spec: MentionReadSpec, userId: string) {
  return records(
    await readSource(
      {
        table: copilotChats,
        id: copilotChats.id,
        name: sql<string>`coalesce(${copilotChats.title}, 'New chat')`,
        workspaceId: copilotChats.workspaceId,
        updatedAt: copilotChats.updatedAt,
        where: and(
          eq(copilotChats.userId, userId),
          eq(copilotChats.type, 'mothership'),
          sql`${copilotChats.config}->'benchmark' IS NULL`,
          isNull(copilotChats.deletedAt)
        ),
      },
      spec
    )
  )
}

/** `listTables`: live tables. */
export async function readTableMentions(spec: MentionReadSpec) {
  return records(
    await readSource(
      {
        table: userTableDefinitions,
        id: userTableDefinitions.id,
        name: userTableDefinitions.name,
        workspaceId: userTableDefinitions.workspaceId,
        updatedAt: userTableDefinitions.updatedAt,
        parentId: userTableDefinitions.folderId,
        where: isNull(userTableDefinitions.archivedAt),
      },
      spec
    )
  )
}

/** The file pickers' durable workspace files. */
export async function readFileMentions(spec: MentionReadSpec) {
  return records(
    await readSource(
      {
        table: workspaceFiles,
        id: workspaceFiles.id,
        name: workspaceFiles.originalName,
        workspaceId: workspaceFiles.workspaceId,
        updatedAt: workspaceFiles.updatedAt,
        parentId: workspaceFiles.folderId,
        where: and(...activeWorkspaceFileConditions([...spec.workspaceIds])),
      },
      spec
    )
  )
}

/** `listWorkspaceFileFolders`: live file folders. */
export async function readFileFolderMentions(spec: MentionReadSpec) {
  return records(
    await readSource(
      {
        table: folder,
        id: folder.id,
        name: folder.name,
        workspaceId: folder.workspaceId,
        updatedAt: folder.updatedAt,
        parentId: folder.parentId,
        where: and(eq(folder.resourceType, 'file'), isNull(folder.deletedAt)),
      },
      spec
    )
  )
}

/** `getWorkspaceKnowledgeBases`: live knowledge bases. */
export async function readKnowledgeBaseMentions(spec: MentionReadSpec) {
  return records(
    await readSource(
      {
        table: knowledgeBase,
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        workspaceId: knowledgeBase.workspaceId,
        updatedAt: knowledgeBase.updatedAt,
        parentId: knowledgeBase.folderId,
        where: isNull(knowledgeBase.deletedAt),
      },
      spec
    )
  )
}

/** `getWorkspaceDashboard`: each workspace's one dashboard, named as its record names it. */
export async function readDashboardMentions(spec: MentionReadSpec) {
  return records(
    await readSource(
      {
        table: dashboard,
        id: dashboard.id,
        name: sql<string>`'Dashboard'`,
        workspaceId: dashboard.workspaceId,
        updatedAt: dashboard.updatedAt,
      },
      spec
    )
  )
}

/** The folder families an `@` lists under Folders, labeled as the picker labels them. */
export const MENTION_FOLDER_FAMILIES = {
  workflow: 'Workflow folders',
  table: 'Table folders',
  knowledge_base: 'Knowledge base folders',
} as const

/** `listFoldersForWorkspace` for each family: live folders. */
export async function readFolderMentions(
  spec: MentionReadSpec,
  resourceTypes: readonly (keyof typeof MENTION_FOLDER_FAMILIES)[]
) {
  if (!resourceTypes.length) return []
  const labelled = spec.query
    ? resourceTypes.filter((type) =>
        MENTION_FOLDER_FAMILIES[type].toLowerCase().includes(spec.query)
      )
    : []
  return records(
    await readSource(
      {
        table: folder,
        id: folder.id,
        name: folder.name,
        workspaceId: folder.workspaceId,
        updatedAt: folder.updatedAt,
        parentId: folder.parentId,
        where: and(inArray(folder.resourceType, [...resourceTypes]), isNull(folder.deletedAt)),
        alsoMatches: labelled.length ? inArray(folder.resourceType, labelled) : undefined,
      },
      spec,
      { folderFamily: folder.resourceType }
    ),
    MENTION_FOLDER_FAMILIES
  )
}

/**
 * `readLogs` with no filters: workflow runs, named by their workflow (or its id once deleted), and
 * job runs, which have no workflow. A query matches a run's workflow name or the family label.
 */
export async function readLogMentions(spec: MentionReadSpec): Promise<MentionRecord[]> {
  if (!spec.workspaceIds.length) return []
  const label = sql<string>`coalesce(${workflow.name}, ${workflowExecutionLogs.workflowId}, 'Unknown')`
  const all = !spec.query || 'logs'.includes(spec.query)
  const workspaceMatch = (column: AnyPgColumn) =>
    spec.matchedWorkspaceIds.length ? inArray(column, [...spec.matchedWorkspaceIds]) : undefined
  const runFilter = all
    ? undefined
    : or(
        ilike(label, `%${escapeLikePattern(spec.query)}%`),
        workspaceMatch(workflowExecutionLogs.workspaceId)
      )
  const jobFilter =
    all || 'unknown'.includes(spec.query)
      ? undefined
      : (workspaceMatch(jobExecutionLogs.workspaceId) ?? sql`false`)
  const [runs, jobs] = await Promise.all([
    dbReplica
      .select({
        id: workflowExecutionLogs.id,
        executionId: workflowExecutionLogs.executionId,
        workspaceId: workflowExecutionLogs.workspaceId,
        startedAt: workflowExecutionLogs.startedAt,
        label,
      })
      .from(workflowExecutionLogs)
      .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
      .where(and(inArray(workflowExecutionLogs.workspaceId, [...spec.workspaceIds]), runFilter))
      .orderBy(desc(workflowExecutionLogs.startedAt), desc(workflowExecutionLogs.id))
      .limit(spec.limit),
    dbReplica
      .select({
        id: jobExecutionLogs.id,
        executionId: jobExecutionLogs.executionId,
        workspaceId: jobExecutionLogs.workspaceId,
        startedAt: jobExecutionLogs.startedAt,
      })
      .from(jobExecutionLogs)
      .where(and(inArray(jobExecutionLogs.workspaceId, [...spec.workspaceIds]), jobFilter))
      .orderBy(desc(jobExecutionLogs.startedAt), desc(jobExecutionLogs.id))
      .limit(spec.limit),
  ])
  return [...runs, ...jobs.map((job) => ({ ...job, label: 'Unknown' }))]
    .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())
    .slice(0, spec.limit)
    .map((run) => {
      const executionId = run.executionId ?? run.id
      return {
        id: executionId,
        name: run.label,
        workspaceId: run.workspaceId,
        updatedAt: run.startedAt,
        parentId: null,
        executionId,
        workflowLabel: run.label,
      }
    })
}

/**
 * `listSkillsForUser` across workspaces: each workspace's skills, then every built-in some
 * workspace still offers (a same-named workspace skill hides it there), listed once.
 */
export async function readSkillMentions(spec: MentionReadSpec): Promise<MentionRecord[]> {
  if (!spec.workspaceIds.length) return []
  const rows = await db
    .select({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      workspaceId: skill.workspaceId,
      updatedAt: skill.updatedAt,
    })
    .from(skill)
    .where(inArray(skill.workspaceId, [...spec.workspaceIds]))
    .orderBy(desc(skill.createdAt))
  const namesByWorkspace = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!row.workspaceId) continue
    const names = namesByWorkspace.get(row.workspaceId) ?? new Set<string>()
    names.add(row.name.toLowerCase())
    namesByWorkspace.set(row.workspaceId, names)
  }
  const builtins = BUILTIN_SKILLS.filter((builtin) =>
    spec.workspaceIds.some(
      (workspaceId) => !namesByWorkspace.get(workspaceId)?.has(builtin.name.toLowerCase())
    )
  )
  return [
    ...builtins.map((builtin) => ({
      id: builtin.id,
      name: builtin.name,
      detail: builtin.description,
      workspaceId: null,
      updatedAt: new Date(0),
      parentId: null,
    })),
    ...spec.workspaceIds.flatMap((workspaceId) =>
      rows
        .filter((row) => row.workspaceId === workspaceId)
        .map((row) => ({
          id: row.id,
          name: row.name,
          detail: row.description,
          workspaceId: row.workspaceId,
          updatedAt: row.updatedAt,
          parentId: null,
        }))
    ),
  ].slice(spec.page?.offset ?? 0, (spec.page?.offset ?? 0) + spec.limit)
}
