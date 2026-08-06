import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, asc, eq, gt, inArray, isNull, or, type SQL } from 'drizzle-orm'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { isSupportedFileType, parseBuffer } from '@/lib/file-parsers'
import { listWorkspaceFileFolders } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
  fetchServableWorkspaceFileBuffer,
  getWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { simFilesConnectorMeta } from '@/connectors/sim-files/meta'
import type {
  ConnectorConfig,
  ConnectorSyncContext,
  ExternalDocument,
  ExternalDocumentList,
} from '@/connectors/types'
import {
  CONNECTOR_MAX_FILE_BYTES,
  isSkippedDocument,
  markSkipped,
  parseMultiValue,
  parseTagDate,
  sizeLimitSkipReason,
  stubOrSkipBySize,
  takeIndexableWithinCap,
} from '@/connectors/utils'

const logger = createLogger('SimFilesConnector')

const PAGE_SIZE = 200

/**
 * Only files the workspace's own Files module owns. The `workspace_files` table is
 * multi-tenant by `context` as well as by workspace: `mothership`/`copilot`/`chat`/
 * `execution` rows are per-user attachments that still carry a `workspaceId`, so
 * dropping this predicate would sync every member's private uploads into a shared
 * knowledge base.
 */
const WORKSPACE_FILE_CONTEXT = 'workspace'

/** Columns the stub is built from. Selected identically by listing and hydration. */
const FILE_ROW_COLUMNS = {
  id: workspaceFiles.id,
  originalName: workspaceFiles.originalName,
  contentType: workspaceFiles.contentType,
  size: workspaceFiles.size,
  folderId: workspaceFiles.folderId,
  userId: workspaceFiles.userId,
  contentUpdatedAt: workspaceFiles.contentUpdatedAt,
  updatedAt: workspaceFiles.updatedAt,
} as const

export interface FileRow {
  id: string
  originalName: string
  contentType: string
  size: number
  folderId: string | null
  userId: string
  contentUpdatedAt: Date
  updatedAt: Date
}

/** Keyset position: the last row emitted, ordered by `(updatedAt, id)`. */
interface Cursor {
  updatedAt: Date
  id: string
}

export function encodeCursor(row: { updatedAt: Date; id: string }): string {
  return `${row.updatedAt.toISOString()}|${row.id}`
}

/**
 * Throws rather than restarting on a malformed cursor: the engine only ever hands
 * back a cursor this connector produced, so a bad one means a real bug, and silently
 * rewinding would re-emit page one forever.
 */
export function decodeCursor(cursor: string): Cursor {
  const separator = cursor.indexOf('|')
  const updatedAt = separator === -1 ? Number.NaN : Date.parse(cursor.slice(0, separator))
  const id = separator === -1 ? '' : cursor.slice(separator + 1)
  if (Number.isNaN(updatedAt) || !id) {
    throw new Error(`Malformed workspace files cursor: ${cursor}`)
  }
  return { updatedAt: new Date(updatedAt), id }
}

/** Lowercased, dot-stripped extension of a filename, or '' when it has none. */
export function normalizeExt(value: string): string {
  const trimmed = value.trim().toLowerCase()
  const dot = trimmed.lastIndexOf('.')
  return dot === -1 ? trimmed : trimmed.slice(dot + 1)
}

/**
 * Every folder at or beneath `rootId`, breadth-first.
 *
 * Guards against a cycle in `parentId`: the schema permits one (the DB trigger only
 * enforces matching `resourceType`), and an unguarded walk would hang the sync.
 */
export function collectDescendantFolderIds(
  folders: Array<{ id: string; parentId: string | null }>,
  rootId: string
): string[] {
  const childrenByParent = new Map<string | null, string[]>()
  for (const folder of folders) {
    const siblings = childrenByParent.get(folder.parentId)
    if (siblings) siblings.push(folder.id)
    else childrenByParent.set(folder.parentId, [folder.id])
  }

  const collected: string[] = []
  const seen = new Set<string>()
  const queue: string[] = [rootId]
  while (queue.length > 0) {
    const id = queue.shift() as string
    if (seen.has(id)) continue
    seen.add(id)
    collected.push(id)
    const children = childrenByParent.get(id)
    if (children) queue.push(...children)
  }
  return collected
}

/**
 * The full `where` for a listing page.
 *
 * `workspaceId` is the engine-supplied one and is applied unconditionally, so a
 * `sourceConfig` carrying its own `workspaceId` cannot widen the query. Kept pure and
 * exported so that invariant is directly testable.
 */
export function buildFileListingFilters(args: {
  workspaceId: string
  folderIds: string[] | null
  rootOnly: boolean
  cursor?: Cursor
}): SQL[] {
  const filters: SQL[] = [
    eq(workspaceFiles.workspaceId, args.workspaceId),
    eq(workspaceFiles.context, WORKSPACE_FILE_CONTEXT),
    isNull(workspaceFiles.deletedAt),
  ]

  if (args.rootOnly) {
    filters.push(isNull(workspaceFiles.folderId))
  } else if (args.folderIds) {
    // An empty scope must match nothing, but `inArray(col, [])` is invalid SQL.
    if (args.folderIds.length === 0) return [...filters, eq(workspaceFiles.id, '')]
    filters.push(inArray(workspaceFiles.folderId, args.folderIds))
  }

  if (args.cursor) {
    filters.push(
      or(
        gt(workspaceFiles.updatedAt, args.cursor.updatedAt),
        and(
          eq(workspaceFiles.updatedAt, args.cursor.updatedAt),
          gt(workspaceFiles.id, args.cursor.id)
        )
      ) as SQL
    )
  }

  return filters
}

/**
 * Builds the listing stub for one file.
 *
 * The single source of truth for `contentHash`, called by both `listDocuments` and
 * `getDocument` so the two can never disagree — the engine compares the hash from
 * hydration against the one from listing to decide whether a document changed.
 *
 * `originalName` and `folderId` participate because a rename or a move alters what
 * we index (title, folder tag) without touching `contentUpdatedAt`, which advances
 * only on content writes.
 */
export function fileRowToStub(
  row: FileRow,
  workspaceId: string,
  folderPath: string | null
): ExternalDocument {
  return {
    externalId: row.id,
    title: row.originalName,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `${getBaseUrl()}/workspace/${workspaceId}/files${
      row.folderId ? `?folderId=${encodeURIComponent(row.folderId)}` : ''
    }`,
    contentHash: `simfile:${row.id}:${row.contentUpdatedAt.toISOString()}:${row.originalName}:${row.folderId ?? ''}`,
    metadata: {
      folderPath: folderPath ?? '',
      contentType: row.contentType,
      uploadedBy: row.userId,
      /**
       * Load-bearing: `estimateOpSizeBytes` reads `fileSize` to pace hydration
       * against the engine's in-flight byte budget, and assumes 4MB without it —
       * which would let several near-cap files materialize at once.
       */
      fileSize: row.size,
      lastModified: row.contentUpdatedAt.toISOString(),
    },
  }
}

/** Folder scope for this sync run, resolved once and cached on the sync context. */
interface FolderScope {
  folderIds: string[] | null
  rootOnly: boolean
  pathById: Map<string, string>
}

async function resolveFolderScope(
  syncContext: ConnectorSyncContext,
  workspaceId: string,
  folderId: string,
  recursive: boolean
): Promise<FolderScope> {
  const cached = syncContext.simFilesFolderScope as FolderScope | undefined
  if (cached) return cached

  /**
   * `scope: 'all'` so a file whose folder was trashed still resolves a path for its
   * tag; whether the file itself is listed is governed by its own `deletedAt`.
   */
  const folders = await listWorkspaceFileFolders(workspaceId, { scope: 'all' })
  const pathById = new Map(folders.map((folder) => [folder.id, folder.path]))

  let scope: FolderScope
  if (!folderId) {
    scope = { folderIds: null, rootOnly: !recursive, pathById }
  } else if (!recursive) {
    scope = { folderIds: [folderId], rootOnly: false, pathById }
  } else {
    scope = { folderIds: collectDescendantFolderIds(folders, folderId), rootOnly: false, pathById }
  }

  syncContext.simFilesFolderScope = scope
  return scope
}

function readWorkspaceId(syncContext: ConnectorSyncContext): string {
  return syncContext.workspaceId
}

function readRecursive(sourceConfig: Record<string, unknown>): boolean {
  return sourceConfig.recursive !== 'false'
}

function readAllowedExtensions(sourceConfig: Record<string, unknown>): Set<string> {
  return new Set(parseMultiValue(sourceConfig.extensions).map(normalizeExt).filter(Boolean))
}

/** Parses an optional positive-integer config field. `null` signals invalid input. */
export function parseOptionalPositiveInt(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return parsed
}

export const simFilesConnector: ConnectorConfig = {
  ...simFilesConnectorMeta,

  listDocuments: async (
    _accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor: string | undefined,
    syncContext: ConnectorSyncContext
  ): Promise<ExternalDocumentList> => {
    const workspaceId = readWorkspaceId(syncContext)
    const folderId = typeof sourceConfig.folderId === 'string' ? sourceConfig.folderId.trim() : ''
    const allowedExtensions = readAllowedExtensions(sourceConfig)
    const maxFiles = parseOptionalPositiveInt(sourceConfig.maxFiles) ?? 0

    let scope: FolderScope
    try {
      scope = await resolveFolderScope(
        syncContext,
        workspaceId,
        folderId,
        readRecursive(sourceConfig)
      )
    } catch (error) {
      /**
       * Without a folder scope this page would silently widen to the whole workspace
       * or narrow to nothing; either way the listing is not authoritative, so block
       * deletion reconciliation before rethrowing.
       */
      syncContext.listingCapped = true
      throw error
    }

    const rows = await db
      .select(FILE_ROW_COLUMNS)
      .from(workspaceFiles)
      .where(
        and(
          ...buildFileListingFilters({
            workspaceId,
            folderIds: scope.folderIds,
            rootOnly: scope.rootOnly,
            cursor: cursor ? decodeCursor(cursor) : undefined,
          })
        )
      )
      .orderBy(asc(workspaceFiles.updatedAt), asc(workspaceFiles.id))
      .limit(PAGE_SIZE)

    const items: ExternalDocument[] = []
    for (const row of rows) {
      const ext = normalizeExt(row.originalName)
      /**
       * Deliberate scope filters, not truncation — an unreadable type (image,
       * archive, audio) or a type the user excluded must not set `listingCapped`,
       * or a knowledge base could never reconcile away a file that stopped matching.
       */
      if (!ext || !isSupportedFileType(ext)) continue
      if (allowedExtensions.size > 0 && !allowedExtensions.has(ext)) continue

      const folderPath = row.folderId ? (scope.pathById.get(row.folderId) ?? null) : null
      items.push(
        stubOrSkipBySize(
          fileRowToStub(row, workspaceId, folderPath),
          row.size,
          CONNECTOR_MAX_FILE_BYTES
        )
      )
    }

    const lastRow = rows.at(-1)
    const pageFilled = rows.length === PAGE_SIZE

    const indexedSoFar = (syncContext.simFilesIndexed as number | undefined) ?? 0
    const { documents, indexableCount, capReached } = takeIndexableWithinCap(
      items,
      isSkippedDocument,
      maxFiles,
      indexedSoFar
    )
    syncContext.simFilesIndexed = indexedSoFar + indexableCount

    if (capReached) {
      // The listing stops short of the source, so it cannot be used to infer deletions.
      syncContext.listingCapped = true
      return { documents, hasMore: false }
    }

    return {
      documents,
      nextCursor: pageFilled && lastRow ? encodeCursor(lastRow) : undefined,
      hasMore: pageFilled,
    }
  },

  getDocument: async (
    _accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext: ConnectorSyncContext
  ): Promise<ExternalDocument | null> => {
    const workspaceId = readWorkspaceId(syncContext)

    // Re-read through the same predicates: never trust an external id on its own.
    const rows = await db
      .select(FILE_ROW_COLUMNS)
      .from(workspaceFiles)
      .where(
        and(
          eq(workspaceFiles.id, externalId),
          eq(workspaceFiles.workspaceId, workspaceId),
          eq(workspaceFiles.context, WORKSPACE_FILE_CONTEXT),
          isNull(workspaceFiles.deletedAt)
        )
      )
      .limit(1)

    const row = rows[0]
    if (!row) return null

    const scope = await resolveFolderScope(
      syncContext,
      workspaceId,
      typeof sourceConfig.folderId === 'string' ? sourceConfig.folderId.trim() : '',
      readRecursive(sourceConfig)
    )
    const folderPath = row.folderId ? (scope.pathById.get(row.folderId) ?? null) : null
    const stub = fileRowToStub(row, workspaceId, folderPath)

    if (row.size > CONNECTOR_MAX_FILE_BYTES) {
      return markSkipped(stub, sizeLimitSkipReason(CONNECTOR_MAX_FILE_BYTES))
    }

    const ext = normalizeExt(row.originalName)
    if (!ext || !isSupportedFileType(ext)) return null

    /**
     * `throwOnError` so a database fault surfaces as a failed sync. The default
     * swallows it to `null`, which the engine reads as an empty re-fetch and records
     * as a no-op — masking an outage as success.
     */
    const fileRecord = await getWorkspaceFile(workspaceId, externalId, { throwOnError: true })
    if (!fileRecord) return null

    /**
     * The same gate the manual knowledge-base upload path enforces
     * (`assertDocumentFileModelSafe` in `documents/document-processor.ts`).
     *
     * It has to run HERE rather than being inherited: the sync engine re-uploads the
     * extracted text under a fresh `kb/...` key, and that key has no `workspace_files`
     * row — so the processor's own check resolves zero rows and passes vacuously. A
     * file whose provenance is unknown would otherwise be laundered into embeddings.
     *
     * Skipped rather than dropped so it surfaces as a visible failed document.
     */
    const provenanceSafe = await isModelSafeWorkspaceFileKey(fileRecord.key, { workspaceId })
    if (!provenanceSafe) {
      return markSkipped(stub, MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE)
    }

    let buffer: Buffer
    try {
      /**
       * Not `fetchWorkspaceFileBuffer`: for generated docx/pptx/pdf/xlsx that returns
       * the generation *source* (JavaScript/Python text) under a document filename,
       * which the parser would happily mis-read. This resolves the rendered artifact,
       * and throws `DocCompileUserError` while one is still compiling — a transient
       * state that should simply be retried on the next sync.
       */
      ;({ buffer } = await fetchServableWorkspaceFileBuffer(fileRecord, {
        maxBytes: CONNECTOR_MAX_FILE_BYTES,
      }))
    } catch (error) {
      logger.warn('Failed to download workspace file for indexing', {
        externalId,
        error: getErrorMessage(error),
      })
      return null
    }

    if (buffer.byteLength > CONNECTOR_MAX_FILE_BYTES) {
      return markSkipped(stub, sizeLimitSkipReason(CONNECTOR_MAX_FILE_BYTES))
    }

    const { content } = await parseBuffer(buffer, ext)
    if (!content.trim()) return null

    return { ...stub, content, contentDeferred: false }
  },

  validateConfig: async (
    _accessToken: string,
    sourceConfig: Record<string, unknown>,
    context?: { workspaceId?: string; knowledgeBaseId?: string }
  ): Promise<{ valid: boolean; error?: string }> => {
    const recursive = sourceConfig.recursive
    if (
      recursive !== undefined &&
      recursive !== '' &&
      recursive !== 'true' &&
      recursive !== 'false'
    ) {
      return { valid: false, error: 'Include Subfolders must be Yes or No' }
    }

    if (parseOptionalPositiveInt(sourceConfig.maxFiles) === null) {
      return { valid: false, error: 'Max Files must be a positive whole number' }
    }

    const unsupported = parseMultiValue(sourceConfig.extensions)
      .map(normalizeExt)
      .filter((ext) => ext && !isSupportedFileType(ext))
    if (unsupported.length > 0) {
      return {
        valid: false,
        error: `Sim cannot extract text from these file types: ${unsupported.join(', ')}`,
      }
    }

    /**
     * Existence check only — a foreign folder id leaks nothing, because every listing
     * query is bound to the engine-supplied workspace regardless. Without it a typo'd
     * id would just sync zero files forever with no explanation.
     */
    const folderId = typeof sourceConfig.folderId === 'string' ? sourceConfig.folderId.trim() : ''
    if (folderId && context?.workspaceId) {
      const folders = await listWorkspaceFileFolders(context.workspaceId, { scope: 'active' })
      if (!folders.some((folder) => folder.id === folderId)) {
        return { valid: false, error: 'Folder not found in this workspace' }
      }
    }

    return { valid: true }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const tags: Record<string, unknown> = {}

    if (typeof metadata.folderPath === 'string' && metadata.folderPath) {
      tags.folderPath = metadata.folderPath
    }
    if (typeof metadata.contentType === 'string' && metadata.contentType) {
      tags.contentType = metadata.contentType
    }
    if (typeof metadata.uploadedBy === 'string' && metadata.uploadedBy) {
      tags.uploadedBy = metadata.uploadedBy
    }
    if (typeof metadata.fileSize === 'number' && Number.isFinite(metadata.fileSize)) {
      tags.fileSize = metadata.fileSize
    }
    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) tags.lastModified = lastModified

    return tags
  },
}
