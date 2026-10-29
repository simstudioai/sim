import { workspaceFiles } from '@sim/db/schema'
import { and, eq, gte, inArray, isNull, lte, not, or, type SQL, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { FolderIdScope } from '@/lib/folders/scope'
import {
  EXTENSION_TO_MIME,
  GENERIC_MIME_TYPES,
  MIME_TYPE_MAPPING,
  resolveEffectiveMimeType,
} from '@/lib/uploads/utils/file'
import { SUPPORTED_DOCUMENT_EXTENSIONS } from '@/lib/uploads/utils/validation'
import {
  WORKSPACE_FILE_SIZE_BUCKET_RANGES,
  type WorkspaceFileKind,
  type WorkspaceFileSizeBucket,
} from '@/lib/workspace-files/list-filters'
import { OWNED_FILE_CONTEXTS } from '@/lib/workspace-files/owned-files'
import { WORKSPACE_FILE_TYPE_LABELS } from '@/lib/workspace-files/type-label'

/** Durable files available to workspace resource pickers, reference mappings, and fork copies. */
export function activeWorkspaceFileConditions(workspaceIds: string[]) {
  return [
    inArray(workspaceFiles.workspaceId, workspaceIds),
    eq(workspaceFiles.context, 'workspace'),
    isNull(workspaceFiles.deletedAt),
  ]
}

/** Rows whose content the editor and Sim write: workspace files and owned files. */
export const contentWritableWorkspaceFileContextCondition = inArray(workspaceFiles.context, [
  'workspace',
  ...OWNED_FILE_CONTEXTS,
])

/**
 * The folder key the folder-scoped `workspace_files` indexes are built on: the folder id, or `''`
 * for the root. `workspace_files_workspace_folder_name_active_unique` (and its Project twin) lead
 * with `coalesce(folder_id, '')`, so a folder predicate spelled as `folder_id IS NULL` or
 * `folder_id = $1` cannot seek them and reads every live file of the owner instead.
 */
export const workspaceFileFolderKey = sql<string>`coalesce(${workspaceFiles.folderId}, '')`

/** The {@link workspaceFileFolderKey} value for a folder id, `null` being the root. */
function folderKeyValue(folderId: string | null): string {
  if (folderId === '') {
    throw new OrchestrationError('validation', 'Folder id must not be empty')
  }
  return folderId ?? ''
}

/**
 * The `workspaceFiles` predicate for one folder (`null` for the root), or several folder ids,
 * on {@link workspaceFileFolderKey}. Identical in meaning to `folder_id IS NULL` / `= $1` /
 * `IN (...)` because no folder id is `''` (ids are generated, and an empty id is refused here).
 * An empty list matches nothing.
 */
export function workspaceFileFolderIdCondition(
  folderId: string | null | readonly (string | null)[]
): SQL {
  if (typeof folderId === 'string' || folderId === null) {
    return sql`${workspaceFileFolderKey} = ${folderKeyValue(folderId)}`
  }
  const keys = [...new Set(folderId.map(folderKeyValue))]
  if (keys.length === 0) return sql`false`
  return inArray(workspaceFileFolderKey, keys)
}

/**
 * The `workspaceFiles` predicate for a resolved folder scope, or none when the
 * scope is absent. A root scope selects the files that carry no folder id. An
 * empty scope selects nothing: every path resolved to a folder holding no
 * subtree, and answering it unrestricted would widen it to the whole workspace.
 */
export function workspaceFileFolderScopeCondition(
  scope: FolderIdScope | undefined
): SQL | undefined {
  if (!scope) return undefined
  return workspaceFileFolderIdCondition([
    ...scope.folderIds,
    ...(scope.includeRootItems ? [null] : []),
  ])
}

/**
 * The file's extension as `getFileExtension` reads it: everything after the last `.`,
 * lowercased, or `''` for a name without one.
 */
const workspaceFileExtension = sql<string>`(CASE WHEN strpos(${workspaceFiles.originalName}, '.') > 0
  THEN lower(regexp_replace(${workspaceFiles.originalName}, '^.*\\.', '')) ELSE '' END)`

const declaredContentType = sql<string>`btrim(${workspaceFiles.contentType})`

/** Whether the stored type names a format, the condition under which `resolveEffectiveMimeType` keeps it. */
const declaresFormat: SQL = sql`(${declaredContentType} <> '' AND ${not(
  inArray(declaredContentType, [...GENERIC_MIME_TYPES])
)})`

/** Every extension whose own MIME type (what a file without a declared format resolves to) passes `matches`. */
function extensionsResolvingTo(matches: (mimeType: string) => boolean): string[] {
  return Object.keys(EXTENSION_TO_MIME).filter((extension) =>
    matches(resolveEffectiveMimeType(undefined, `file.${extension}`))
  )
}

/** A file whose effective MIME type passes `matches`, spelled for SQL: the declared type, else the extension's. */
function effectiveMimeTypeCondition(
  declaredMatches: SQL,
  matches: (mimeType: string) => boolean
): SQL | undefined {
  const extensions = extensionsResolvingTo(matches)
  return or(
    and(declaresFormat, declaredMatches),
    extensions.length > 0
      ? and(not(declaresFormat), inArray(workspaceFileExtension, extensions))
      : undefined
  )
}

function mappedMimeTypes(kind: 'audio' | 'video'): string[] {
  return Object.entries(MIME_TYPE_MAPPING)
    .filter(([, mapped]) => mapped === kind)
    .map(([mimeType]) => mimeType)
}

function workspaceFileKindPredicate(kind: WorkspaceFileKind): SQL | undefined {
  switch (kind) {
    case 'document':
      return inArray(workspaceFileExtension, [...SUPPORTED_DOCUMENT_EXTENSIONS])
    case 'image':
      return effectiveMimeTypeCondition(sql`${declaredContentType} LIKE 'image/%'`, (mimeType) =>
        mimeType.startsWith('image/')
      )
    case 'audio':
    case 'video': {
      const mimeTypes = mappedMimeTypes(kind)
      return effectiveMimeTypeCondition(
        inArray(sql`lower(${declaredContentType})`, mimeTypes),
        (mimeType) => MIME_TYPE_MAPPING[mimeType.toLowerCase()] === kind
      )
    }
  }
}

/**
 * The files of any of `kinds`, as the Files browser's Type filter classifies them (see
 * `WORKSPACE_FILE_KINDS`), or none when `kinds` is absent or empty. Built from the extension
 * and MIME tables `resolveEffectiveMimeType` reads, so a file's kind here is the one the app
 * resolves for it everywhere else.
 */
export function workspaceFileKindCondition(
  kinds: readonly WorkspaceFileKind[] | undefined
): SQL | undefined {
  if (!kinds || kinds.length === 0) return undefined
  return or(...kinds.map(workspaceFileKindPredicate))
}

/** The files in any of `buckets` (see `WORKSPACE_FILE_SIZE_BUCKET_RANGES`), or none when absent or empty. */
export function workspaceFileSizeCondition(
  buckets: readonly WorkspaceFileSizeBucket[] | undefined
): SQL | undefined {
  if (!buckets || buckets.length === 0) return undefined
  const size = sql<number>`coalesce(${workspaceFiles.sizeBytes}, 0)`
  return or(
    ...buckets.map((bucket) => {
      const { min, max } = WORKSPACE_FILE_SIZE_BUCKET_RANGES[bucket]
      return and(gte(size, min), max === null ? undefined : lte(size, max))
    })
  )
}

/**
 * A string constant of this module as an SQL literal. Only for the label and MIME tables below,
 * which are code: inlining them keeps a query that repeats the expression (select, order, and
 * keyset) from binding hundreds of parameters.
 */
function literal(value: string): SQL {
  return sql.raw(`'${value.replaceAll("'", "''")}'`)
}

/** A `CASE <subject> WHEN … THEN … ELSE <otherwise> END` over a constant value-to-value table. */
function caseOf(subject: SQL, table: readonly (readonly [string, string])[], otherwise: SQL): SQL {
  if (table.length === 0) return otherwise
  return sql`(CASE ${subject} ${sql.join(
    table.map(([when, then]) => sql`WHEN ${literal(when)} THEN ${literal(then)}`),
    sql` `
  )} ELSE ${otherwise} END)`
}

/** The MIME type `resolveEffectiveMimeType` gives the file, spelled for SQL. */
const workspaceFileEffectiveMimeType: SQL = sql`(CASE WHEN ${declaresFormat} THEN ${declaredContentType} ELSE ${caseOf(
  workspaceFileExtension,
  Object.keys(EXTENSION_TO_MIME).map(
    (extension) => [extension, resolveEffectiveMimeType(undefined, `file.${extension}`)] as const
  ),
  literal(resolveEffectiveMimeType(undefined, 'file'))
)} END)`

const resolvedMime = sql.raw('resolved.mime')
const resolvedExtension = sql.raw('resolved.extension')

/**
 * The file's Type column label (`workspaceFileTypeLabel`), spelled for SQL: what the list's Type
 * sort orders by. Built from the same label table and MIME resolution, so a file sorts under the
 * label it shows. The MIME type is resolved once per row, in a scalar subquery.
 */
export const workspaceFileTypeLabelExpression: SQL<string> = sql<string>`(SELECT ${caseOf(
  resolvedMime,
  Object.entries(WORKSPACE_FILE_TYPE_LABELS),
  sql`(CASE WHEN ${resolvedMime} LIKE 'audio/%' THEN 'Audio'
    WHEN ${resolvedMime} LIKE 'video/%' THEN 'Video'
    WHEN ${resolvedMime} LIKE 'image/%' THEN 'Image'
    WHEN ${resolvedExtension} <> '' THEN upper(${resolvedExtension})
    ELSE ${workspaceFiles.contentType} END)`
)} FROM (SELECT ${workspaceFileEffectiveMimeType} AS mime, ${workspaceFileExtension} AS extension) AS resolved)`
