import { folder, workspaceFiles } from '@sim/db/schema'
import { escapeLikePattern } from '@sim/utils/string'
import { and, isNull, type SQL, sql } from 'drizzle-orm'
import {
  type CursorKey,
  encodeKeyset,
  INVALID_CURSOR_MESSAGE,
  type KeysetKey,
  keysetAfter,
  keysetColumns,
  type ListSortOrder,
  listOrderBy,
  numberKey,
  textKey,
} from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { MAX_FOLDER_PATH_SEGMENTS } from '@/lib/folders/paths'
import { getWorkspaceFileSize } from '@/lib/uploads/shared/types'
import {
  EXTENSION_TO_MIME,
  MIME_TYPE_MAPPING,
  resolveEffectiveMimeType,
} from '@/lib/uploads/utils/file-utils'
import { SUPPORTED_DOCUMENT_EXTENSIONS } from '@/lib/uploads/utils/validation'
import {
  FILE_BROWSER_MIME_LABELS,
  FILE_BROWSER_SIZE_BOUNDARIES,
  type FileBrowserCreator,
  type FileBrowserFilters,
  type FileBrowserItem,
  type FileBrowserSort,
} from '@/lib/workspace-files/browser'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { fileFolderOwnerCondition, fileOwnerCondition } from '@/lib/workspace-files/ownership-query'

export interface FileBrowserQuery extends FileBrowserFilters {
  scope: 'active' | 'archived'
  folderId?: string | null
  search?: string
  sortBy: FileBrowserSort
  sortOrder: ListSortOrder
  limit: number
  after?: CursorKey[]
}

type BrowserRow = {
  id: string
  kind: 'file' | 'folder'
  name: string
  parent_id: string | null
  size: string | number
  type: string
  created_ms: string | number
  updated_ms: string | number
  creator_id: string | null
  creator_name: string | null
  creator_image: string | null
  creator_deleted: boolean
}

const EFFECTIVE_EXTENSION_MIMES = Object.fromEntries(
  Object.keys(EXTENSION_TO_MIME).map((extension) => [
    extension,
    resolveEffectiveMimeType(null, `file.${extension}`),
  ])
)
const AUDIO_MIMES = Object.keys(MIME_TYPE_MAPPING).filter(
  (mime) => MIME_TYPE_MAPPING[mime] === 'audio'
)
const VIDEO_MIMES = Object.keys(MIME_TYPE_MAPPING).filter(
  (mime) => MIME_TYPE_MAPPING[mime] === 'video'
)

const BROWSER_SORTS: Record<FileBrowserSort, KeysetKey<BrowserRow>> = {
  name: textKey<BrowserRow>(sql`name collate "C"`, (row) => row.name),
  size: numberKey(sql`size`, (row) => Number(row.size)),
  type: textKey<BrowserRow>(sql`type collate "C"`, (row) => row.type),
  created: numberKey(sql`created_ms`, (row) => Number(row.created_ms)),
  owner: textKey<BrowserRow>(
    sql`coalesce(creator_name, '') collate "C"`,
    (row) => row.creator_name ?? ''
  ),
  updated: numberKey(sql`updated_ms`, (row) => Number(row.updated_ms)),
}

function creatorFromRow(row: BrowserRow): FileBrowserCreator | null {
  return row.creator_id
    ? {
        id: row.creator_id,
        name: row.creator_name ?? 'Deleted user',
        image: row.creator_image,
        deleted: row.creator_deleted,
      }
    : null
}

/** Returns one mixed file/folder page; canonical scope and every filter precede its cursor and LIMIT. */
export async function queryFileBrowserItems(
  owner: EditableFileOwner,
  input: FileBrowserQuery,
  tx: DbOrTx
) {
  const activeFiles =
    input.scope === 'archived'
      ? sql`${workspaceFiles.deletedAt} is not null`
      : sql`${workspaceFiles.deletedAt} is null`
  const invalidSizes = await tx
    .select({ id: workspaceFiles.id })
    .from(workspaceFiles)
    .where(and(fileOwnerCondition(owner), activeFiles, isNull(workspaceFiles.sizeBytes)))
    .limit(1)
  if (invalidSizes.length)
    throw new OrchestrationError('conflict', 'File size metadata is not ready')
  const selectedFolders =
    input.scope === 'archived' ? sql`deleted_at is not null` : sql`deleted_at is null`
  const base = sql`with recursive
    owned_folders as (
      select id, name, parent_id, user_id, created_at, updated_at, deleted_at
      from ${folder} where ${fileFolderOwnerCondition(owner)}
    ),
    owned_files as (
      select id, original_name as name, folder_id as parent_id, size_bytes as size,
        content_type, user_id, uploaded_at, updated_at,
        case when strpos(original_name, '.') > 0 then lower(regexp_replace(original_name, '^.*[.]', '')) else '' end as extension
      from ${workspaceFiles} where ${fileOwnerCondition(owner)} and ${activeFiles}
    ),
    descendants as (
      select id as root_id, id, 1 as depth from owned_folders
      union all
      select parent.root_id, child.id, parent.depth + 1 from descendants parent
      join owned_folders child on child.parent_id = parent.id
      where parent.depth < ${MAX_FOLDER_PATH_SEGMENTS}
    ),
    folder_sizes as (
      select tree.root_id, sum(files.size)::bigint as size from descendants tree
      join owned_files files on files.parent_id = tree.id group by tree.root_id
    ),
    effective_files as (
      select *, case when btrim(content_type) not in ('', 'application/octet-stream', 'binary/octet-stream')
        then btrim(content_type) else coalesce(${JSON.stringify(EFFECTIVE_EXTENSION_MIMES)}::jsonb ->> extension, 'application/octet-stream') end as mime
      from owned_files
    ),
    items as (
      select id, 'file'::text as kind, name, parent_id, size,
        coalesce(${JSON.stringify(FILE_BROWSER_MIME_LABELS)}::jsonb ->> mime,
          case when mime like 'audio/%' then 'Audio' when mime like 'video/%' then 'Video'
            when mime like 'image/%' then 'Image' when extension <> '' then upper(extension) else coalesce(content_type, 'File') end) as type,
        user_id, trunc(extract(epoch from uploaded_at) * 1000) as created_ms,
        trunc(extract(epoch from updated_at) * 1000) as updated_ms, extension, mime
      from effective_files
      union all
      select folders.id, 'folder'::text, folders.name, folders.parent_id, coalesce(sizes.size, 0)::bigint, 'Folder'::text,
        folders.user_id, trunc(extract(epoch from folders.created_at) * 1000),
        trunc(extract(epoch from folders.updated_at) * 1000), ''::text, ''::text
      from owned_folders folders left join folder_sizes sizes on sizes.root_id = folders.id where ${selectedFolders}
    ),
    authored as (
      select items.*, items.user_id as creator_id, users.name as creator_name,
        users.image as creator_image, users.id is null as creator_deleted
      from items left join "user" users on users.id = items.user_id
    )`
  const keys = [
    ...(input.sortBy === 'owner'
      ? [
          numberKey<BrowserRow>(sql`case when creator_name is null then 1 else 0 end`, (row) =>
            row.creator_name === null ? 1 : 0
          ),
        ]
      : []),
    BROWSER_SORTS[input.sortBy],
    textKey<BrowserRow>(sql`name collate "C"`, (row) => row.name),
    textKey<BrowserRow>(sql`kind collate "C"`, (row) => row.kind),
    textKey<BrowserRow>(sql`id collate "C"`, (row) => row.id),
  ]
  const directions: ListSortOrder[] = [
    ...(input.sortBy === 'owner' ? ['asc' as const] : []),
    input.sortOrder,
    'asc',
    'asc',
    'asc',
  ]
  let after: SQL | undefined
  if (input.after) {
    after = keysetAfter(keys, input.after, directions) ?? undefined
    if (!after) throw new OrchestrationError('validation', INVALID_CURSOR_MESSAGE)
  }
  const clauses: SQL[] = []
  if (input.folderId !== undefined)
    clauses.push(
      input.folderId === null ? sql`parent_id is null` : sql`parent_id = ${input.folderId}`
    )
  if (input.search) clauses.push(sql`name ilike ${`%${escapeLikePattern(input.search)}%`}`)
  const typeClauses = (input.types ?? []).map((type) => {
    if (type === 'document')
      return sql`extension in (${sql.join(
        SUPPORTED_DOCUMENT_EXTENSIONS.map((extension) => sql`${extension}`),
        sql`, `
      )})`
    if (type === 'image') return sql`mime like 'image/%'`
    const mimes = type === 'audio' ? AUDIO_MIMES : VIDEO_MIMES
    return sql`lower(mime) in (${sql.join(
      mimes.map((mime) => sql`${mime}`),
      sql`, `
    )})`
  })
  const sizeClauses = (input.sizes ?? []).map((size) =>
    size === 'small'
      ? sql`size < ${FILE_BROWSER_SIZE_BOUNDARIES.small}`
      : size === 'medium'
        ? sql`size >= ${FILE_BROWSER_SIZE_BOUNDARIES.small} and size <= ${FILE_BROWSER_SIZE_BOUNDARIES.medium}`
        : sql`size > ${FILE_BROWSER_SIZE_BOUNDARIES.medium}`
  )
  const fileFilters: SQL[] = []
  if (typeClauses.length) fileFilters.push(sql`(${sql.join(typeClauses, sql` or `)})`)
  if (sizeClauses.length) fileFilters.push(sql`(${sql.join(sizeClauses, sql` or `)})`)
  if (input.creatorIds?.length)
    fileFilters.push(
      sql`creator_id in (${sql.join(
        input.creatorIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    )
  if (fileFilters.length)
    clauses.push(sql`(kind = 'folder' or (${sql.join(fileFilters, sql` and `)}))`)
  if (after) clauses.push(after)
  const where = clauses.length ? sql`where ${sql.join(clauses, sql` and `)}` : sql``
  const rows = await tx.execute<BrowserRow>(sql`${base} select * from authored ${where}
    order by ${sql.join(listOrderBy(keysetColumns(keys), directions), sql`, `)} limit ${input.limit + 1}`)
  const creatorRows = await tx.execute<BrowserRow>(sql`${base}
    select * from (select distinct creator_id, creator_name, creator_image, creator_deleted from authored where creator_id is not null) creators
    order by creator_name collate "C", creator_id collate "C"`)
  const page = rows.slice(0, input.limit)
  const last = page.at(-1)
  const items: FileBrowserItem[] = page.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    parentId: row.parent_id,
    size: getWorkspaceFileSize({ sizeBytes: Number(row.size) }),
    type: row.type,
    creator: creatorFromRow(row),
    createdAt: new Date(Number(row.created_ms)),
    updatedAt: new Date(Number(row.updated_ms)),
  }))
  return {
    items,
    creators: creatorRows.flatMap((row) => {
      const creator = creatorFromRow(row)
      return creator ? [creator] : []
    }),
    nextKeys: rows.length > input.limit && last ? encodeKeyset(keys, last) : null,
  }
}
