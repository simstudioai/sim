import { db } from '@sim/db'
import {
  knowledgeBase,
  userTableDefinitions,
  workflow,
  workflowTest,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import type { ResourceSearchItem, ResourceSearchType } from '@/lib/api/contracts/resource-search'
import {
  type CursorKey,
  type KeysetKey,
  keysetOrderBy,
  keysetPage,
  numberKey,
  resumeKeyset,
  searchFilter,
  textKey,
} from '@/lib/api/list-query'

export interface SearchResourceNamesOptions {
  /** The workspaces each type may be searched in; a type with none is skipped. */
  workspaceIdsByType: ReadonlyMap<ResourceSearchType, readonly string[]>
  /** Omitted lists every row of the given types and workspaces, A→Z. */
  search?: string
  limit: number
  cursorKeys?: CursorKey[]
}

export interface ResourceSearchPage {
  items: ResourceSearchItem[]
  nextCursorKeys: CursorKey[] | null
}

interface ResourceSearchRow extends Record<string, unknown> {
  id: string
  name: string
  type: ResourceSearchType
  workspace_id: string
  workspace_name: string
  match_rank: number
  name_key: string
}

/** The columns every source projects, as the expressions the order and cursor read. */
interface RowExpressions {
  id: SQL
  name: SQL
  type: SQL
  workspaceId: SQL
}

interface SearchSource {
  table: SQL
  row: RowExpressions
  where: SQL | undefined
}

function source(
  type: ResourceSearchType,
  table: SQL,
  row: Omit<RowExpressions, 'type'>,
  where: SQL | undefined
): SearchSource {
  return { table, row: { ...row, type: sql`${type}::text` }, where }
}

/**
 * Each type's active rows in the given workspaces, with exactly the predicate its own active
 * list applies (`listWorkflowsForUser`, `listTables`, `getWorkspaceKnowledgeBases`,
 * `listWorkspaceFiles`, `listLiveWorkflowTests`), so a search never finds what those lists hide.
 * A test is addressed by its name, as its resource tab is.
 */
function searchSource(type: ResourceSearchType, workspaceIds: readonly string[]): SearchSource {
  const ids = [...workspaceIds]
  switch (type) {
    case 'workflow':
      return source(
        type,
        sql`${workflow}`,
        {
          id: sql`${workflow.id}`,
          name: sql`${workflow.name}`,
          workspaceId: sql`${workflow.workspaceId}`,
        },
        and(inArray(workflow.workspaceId, ids), isNull(workflow.archivedAt))
      )
    case 'table':
      return source(
        type,
        sql`${userTableDefinitions}`,
        {
          id: sql`${userTableDefinitions.id}`,
          name: sql`${userTableDefinitions.name}`,
          workspaceId: sql`${userTableDefinitions.workspaceId}`,
        },
        and(inArray(userTableDefinitions.workspaceId, ids), isNull(userTableDefinitions.archivedAt))
      )
    case 'knowledgebase':
      return source(
        type,
        sql`${knowledgeBase}`,
        {
          id: sql`${knowledgeBase.id}`,
          name: sql`${knowledgeBase.name}`,
          workspaceId: sql`${knowledgeBase.workspaceId}`,
        },
        and(inArray(knowledgeBase.workspaceId, ids), isNull(knowledgeBase.deletedAt))
      )
    case 'file':
      return source(
        type,
        sql`${workspaceFiles}`,
        {
          id: sql`${workspaceFiles.id}`,
          name: sql`${workspaceFiles.originalName}`,
          workspaceId: sql`${workspaceFiles.workspaceId}`,
        },
        and(
          inArray(workspaceFiles.workspaceId, ids),
          isNull(workspaceFiles.organizationId),
          eq(workspaceFiles.context, 'workspace'),
          isNull(workspaceFiles.projectId),
          isNull(workspaceFiles.deletedAt)
        )
      )
    case 'test':
      return source(
        type,
        sql`${workflowTest}`,
        {
          id: sql`${workflowTest.name}`,
          name: sql`${workflowTest.title}`,
          workspaceId: sql`${workflowTest.workspaceId}`,
        },
        and(inArray(workflowTest.workspaceId, ids), isNull(workflowTest.deletedAt))
      )
  }
}

/** Where `search` first appears in the name, so a prefix outranks a mid-word hit. */
function matchRank(name: SQL, search: string | undefined): SQL {
  // Cast, not a bare `0`: `ORDER BY 0` would read as a column position.
  return search === undefined ? sql`0::integer` : sql`strpos(lower(${name}), lower(${search}))`
}

/**
 * Match position, then A→Z, then type, workspace, and id — together unique, since a resource
 * id is unique within its type and a test name within its workspace.
 */
function sortKeys(row: RowExpressions & { rank: SQL }): KeysetKey<ResourceSearchRow>[] {
  return [
    numberKey(row.rank, (r: ResourceSearchRow) => Number(r.match_rank)),
    textKey(sql`lower(${row.name})`, (r: ResourceSearchRow) => r.name_key),
    textKey(row.type, (r: ResourceSearchRow) => r.type),
    textKey(row.workspaceId, (r: ResourceSearchRow) => r.workspace_id),
    textKey(row.id, (r: ResourceSearchRow) => r.id),
  ]
}

/** The union's output columns, which the outer `ORDER BY` reads. */
const UNIONED_ROW = {
  id: sql`matches.id`,
  name: sql`matches.name`,
  type: sql`matches.type`,
  workspaceId: sql`matches.workspace_id`,
  rank: sql`matches.match_rank`,
}

/**
 * One page of active resources whose names contain `search`, across every type and workspace
 * given. Each branch contributes at most `limit + 1` rows already in page order, so a page reads
 * a bounded number of rows however many resources the workspaces hold.
 */
export async function searchResourceNames(
  options: SearchResourceNamesOptions
): Promise<ResourceSearchPage> {
  const outerKeys = sortKeys(UNIONED_ROW)
  // A cursor that does not fit the sort is a 400 even when no type is searchable.
  resumeKeyset(outerKeys, options.cursorKeys, 'asc')
  const pageSize = options.limit + 1
  const branches = [...options.workspaceIdsByType]
    .filter(([, workspaceIds]) => workspaceIds.length > 0)
    .map(([type, workspaceIds]) => {
      const { table, row, where } = searchSource(type, workspaceIds)
      const rank = matchRank(row.name, options.search)
      const keys = sortKeys({ ...row, rank })
      const filter = and(
        where,
        searchFilter(row.name, options.search),
        resumeKeyset(keys, options.cursorKeys, 'asc')
      )
      const order = sql.join(keysetOrderBy(keys, 'asc'), sql`, `)
      return sql`(select ${row.id} as id, ${row.name} as name, ${row.type} as type, ${row.workspaceId} as workspace_id, ${rank} as match_rank, lower(${row.name}) as name_key from ${table} where ${filter} order by ${order} limit ${pageSize})`
    })
  if (branches.length === 0) return { items: [], nextCursorKeys: null }

  const rows = await db.execute<ResourceSearchRow>(sql`
    select matches.*, ${workspace.name} as workspace_name
    from (${sql.join(branches, sql` union all `)}) as matches
    join ${workspace} on ${workspace.id} = matches.workspace_id
    order by ${sql.join(keysetOrderBy(outerKeys, 'asc'), sql`, `)}
    limit ${pageSize}`)

  const { data, nextCursorKeys } = keysetPage(outerKeys, [...rows], options.limit)
  return {
    items: data.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
    })),
    nextCursorKeys,
  }
}
