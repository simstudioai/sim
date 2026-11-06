import { db } from '@sim/db'
import {
  copilotChats,
  folder,
  knowledgeBase,
  userTableDefinitions,
  workflow,
  workspaceFiles,
} from '@sim/db/schema'
import { and, eq, inArray, isNotNull, type SQL, sql } from 'drizzle-orm'
import type {
  RecentlyDeletedItem,
  RecentlyDeletedSortColumn,
} from '@/lib/api/contracts/recently-deleted'
import {
  type CursorKey,
  type KeysetKey,
  keysetOrderBy,
  keysetPage,
  type ListSortOrder,
  preciseTimestampKey,
  preciseTimestampText,
  resumeKeyset,
  searchFilter,
  textKey,
} from '@/lib/api/list-query'

type RecentlyDeletedType = RecentlyDeletedItem['type']

export interface RecentlyDeletedPage {
  items: RecentlyDeletedItem[]
  nextCursorKeys: CursorKey[] | null
}

export interface ListRecentlyDeletedOptions {
  workspaceId: string
  /** The types to include. Chats additionally require `chatUserId`. */
  types: ReadonlySet<RecentlyDeletedType>
  /** Chats are private: only this user's own deleted chats are listed. */
  chatUserId: string | null
  search?: string
  sortBy: RecentlyDeletedSortColumn
  sortOrder: ListSortOrder
  limit: number
  cursorKeys?: CursorKey[]
}

/** One listed row as the union projects it. */
interface RecentlyDeletedRow extends Record<string, unknown> {
  id: string
  name: string
  type: RecentlyDeletedType
  deleted_at_key: string
  parent_id: string | null
}

/** The columns every source projects, as the expressions the sort and search read. */
interface RowExpressions {
  id: SQL
  name: SQL
  deletedAt: SQL
  type: SQL
  parentId: SQL
}

interface DeletedSource {
  table: SQL
  row: RowExpressions
  where: SQL | undefined
}

const NO_PARENT = sql`null::text`

/** Folder resource types, by the Recently Deleted type their rows list as. */
const FOLDER_TYPES = {
  folder: 'workflow',
  table_folder: 'table',
  knowledge_folder: 'knowledge_base',
  workspace_folder: 'file',
} as const satisfies Partial<
  Record<RecentlyDeletedType, (typeof folder.resourceType.enumValues)[number]>
>

function isFolderType(type: RecentlyDeletedType): type is keyof typeof FOLDER_TYPES {
  return type in FOLDER_TYPES
}

/** A source whose rows are all one type. */
function singleTypeSource(
  type: RecentlyDeletedType,
  table: SQL,
  row: Pick<RowExpressions, 'id' | 'name' | 'deletedAt'>,
  where: SQL | undefined
): [RecentlyDeletedType, DeletedSource] {
  return [type, { table, row: { ...row, type: sql`${type}::text`, parentId: NO_PARENT }, where }]
}

/**
 * Each requested type's archived rows, with exactly the predicate its own archived list
 * applies (`listWorkflowsForUser`, `listFoldersForWorkspace`, `listTables`,
 * `getWorkspaceKnowledgeBases`, `listWorkspaceFiles`, `listWorkspaceFileFolders`,
 * `listMothershipChats`), so the two never disagree about what is in the trash.
 *
 * Every folder type reads as one source: they share the folder table and its
 * `(workspace_id, deleted_at)` index, which one scan serves instead of one per type.
 */
function deletedSources(options: ListRecentlyDeletedOptions): DeletedSource[] {
  const { workspaceId, chatUserId, types } = options
  const singles = new Map<RecentlyDeletedType, DeletedSource>([
    singleTypeSource(
      'workflow',
      sql`${workflow}`,
      {
        id: sql`${workflow.id}`,
        name: sql`${workflow.name}`,
        deletedAt: sql`${workflow.archivedAt}`,
      },
      and(eq(workflow.workspaceId, workspaceId), isNotNull(workflow.archivedAt))
    ),
    singleTypeSource(
      'table',
      sql`${userTableDefinitions}`,
      {
        id: sql`${userTableDefinitions.id}`,
        name: sql`${userTableDefinitions.name}`,
        deletedAt: sql`${userTableDefinitions.archivedAt}`,
      },
      and(
        eq(userTableDefinitions.workspaceId, workspaceId),
        isNotNull(userTableDefinitions.archivedAt)
      )
    ),
    singleTypeSource(
      'knowledge',
      sql`${knowledgeBase}`,
      {
        id: sql`${knowledgeBase.id}`,
        name: sql`${knowledgeBase.name}`,
        deletedAt: sql`${knowledgeBase.deletedAt}`,
      },
      and(eq(knowledgeBase.workspaceId, workspaceId), isNotNull(knowledgeBase.deletedAt))
    ),
    singleTypeSource(
      'file',
      sql`${workspaceFiles}`,
      {
        id: sql`${workspaceFiles.id}`,
        name: sql`${workspaceFiles.originalName}`,
        deletedAt: sql`${workspaceFiles.deletedAt}`,
      },
      and(
        eq(workspaceFiles.workspaceId, workspaceId),
        eq(workspaceFiles.context, 'workspace'),
        isNotNull(workspaceFiles.deletedAt)
      )
    ),
  ])
  if (chatUserId) {
    singles.set(
      ...singleTypeSource(
        'chat',
        sql`${copilotChats}`,
        {
          id: sql`${copilotChats.id}::text`,
          name: sql`coalesce(${copilotChats.title}, 'New chat')`,
          deletedAt: sql`${copilotChats.deletedAt}`,
        },
        and(
          eq(copilotChats.userId, chatUserId),
          eq(copilotChats.workspaceId, workspaceId),
          eq(copilotChats.type, 'mothership'),
          isNotNull(copilotChats.deletedAt)
        )
      )
    )
  }

  const sources = [...types].flatMap((type) => singles.get(type) ?? [])
  const folderTypes = [...types].filter(isFolderType)
  if (folderTypes.length > 0) {
    sources.push({
      table: sql`${folder}`,
      row: {
        id: sql`${folder.id}`,
        name: sql`${folder.name}`,
        deletedAt: sql`${folder.deletedAt}`,
        type: sql`(case ${sql.join(
          Object.entries(FOLDER_TYPES).map(
            ([type, resourceType]) =>
              sql`when ${folder.resourceType} = ${resourceType} then ${type}`
          ),
          sql` `
        )} end)::text`,
        parentId: sql`${folder.parentId}`,
      },
      where: and(
        eq(folder.workspaceId, workspaceId),
        inArray(
          folder.resourceType,
          folderTypes.map((type) => FOLDER_TYPES[type])
        ),
        isNotNull(folder.deletedAt)
      ),
    })
  }
  return sources
}

/**
 * The requested column first, then name and id ascending whichever way the primary runs,
 * so rows tied on type or deletion time keep a stable A→Z order.
 */
function sortKeys(
  sortBy: RecentlyDeletedSortColumn,
  row: Pick<RowExpressions, 'id' | 'name' | 'deletedAt' | 'type'>
): KeysetKey<RecentlyDeletedRow>[] {
  const name = textKey(row.name, (r: RecentlyDeletedRow) => r.name)
  const idTiebreak = {
    ...textKey(row.id, (r: RecentlyDeletedRow) => r.id),
    direction: 'asc' as const,
  }
  switch (sortBy) {
    case 'deleted':
      return [
        preciseTimestampKey(row.deletedAt, (r: RecentlyDeletedRow) => r.deleted_at_key),
        { ...name, direction: 'asc' },
        idTiebreak,
      ]
    case 'name':
      return [name, idTiebreak]
    case 'type':
      return [
        textKey(row.type, (r: RecentlyDeletedRow) => r.type),
        { ...name, direction: 'asc' },
        idTiebreak,
      ]
  }
}

/** The union's output columns, which the outer `ORDER BY` reads. */
const UNIONED_ROW = {
  id: sql`id`,
  name: sql`name`,
  deletedAt: sql`deleted_at`,
  type: sql`type`,
}

/**
 * One page of a workspace's Recently Deleted rows across every requested type, ordered
 * and searched in SQL.
 *
 * Each source contributes at most `limit + 1` rows already in page order, served by its
 * `(workspace_id, deleted)` partial index on the default sort, and the union is ordered
 * once more and cut to the page — so a page reads a bounded number of rows however much
 * the trash holds, and only the columns the list renders.
 */
export async function listRecentlyDeletedItems(
  options: ListRecentlyDeletedOptions
): Promise<RecentlyDeletedPage> {
  const outerKeys = sortKeys(options.sortBy, UNIONED_ROW)
  // A cursor that does not fit the sort is a 400 even when no type is requested.
  resumeKeyset(outerKeys, options.cursorKeys, options.sortOrder)
  const sources = deletedSources(options)
  if (sources.length === 0) return { items: [], nextCursorKeys: null }

  const pageSize = options.limit + 1
  const branches = sources.map(({ table, row, where }) => {
    const keys = sortKeys(options.sortBy, row)
    const filter = and(
      where,
      searchFilter(row.name, options.search),
      resumeKeyset(keys, options.cursorKeys, options.sortOrder)
    )
    const order = sql.join(keysetOrderBy(keys, options.sortOrder), sql`, `)
    return sql`(select ${row.id} as id, ${row.name} as name, ${row.deletedAt} as deleted_at, ${row.type} as type, ${row.parentId} as parent_id from ${table} where ${filter} order by ${order} limit ${pageSize})`
  })

  const rows = await db.execute<RecentlyDeletedRow>(sql`
    select id, name, type, parent_id,
      ${preciseTimestampText(UNIONED_ROW.deletedAt)} as deleted_at_key
    from (${sql.join(branches, sql` union all `)}) as deleted_items
    order by ${sql.join(keysetOrderBy(outerKeys, options.sortOrder), sql`, `)}
    limit ${pageSize}`)

  const { data, nextCursorKeys } = keysetPage(outerKeys, [...rows], options.limit)
  return {
    items: data.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      deletedAt: `${row.deleted_at_key.slice(0, 23)}Z`,
      parentId: row.parent_id,
    })),
    nextCursorKeys,
  }
}
