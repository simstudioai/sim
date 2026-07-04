import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, asc, desc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm'
import { type FileReadResult, readFileRecord } from '@/lib/copilot/vfs/file-reader'
import {
  type GrepCountEntry,
  type GrepMatch,
  type GrepOptions,
  grepReadResult,
  WorkspaceFileGrepError,
} from '@/lib/copilot/vfs/operations'
import {
  type ChatScopedVfsNamespace,
  decodeVfsSegment,
  encodeVfsSegment,
} from '@/lib/copilot/vfs/path-utils'
import { getServePathPrefix } from '@/lib/uploads'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const logger = createLogger('ChatFileReader')

/**
 * Read side of the chat-scoped file namespaces, parameterized by context:
 * user uploads (`uploads/<name>`, context `'mothership'`) and agent-generated
 * one-off outputs (`outputs/<name>`, context `'output'`). Both live in the
 * same `workspace_files` table and workspace bucket, are flat (no folders),
 * and resolve by VFS name (raw or percent-encoded). The two namespaces differ
 * only in who writes them and one legacy quirk: uploads predate `displayName`
 * (legacy rows fall back to `originalName`), outputs have always set it.
 */
interface ChatFileNamespace {
  context: 'mothership' | 'output'
  prefix: ChatScopedVfsNamespace
  noun: 'Upload' | 'Output'
  /** Uploads only: legacy pre-`displayName` rows resolve via `originalName`. */
  legacyOriginalNameFallback: boolean
}

const UPLOADS_NS: ChatFileNamespace = {
  context: 'mothership',
  prefix: 'uploads',
  noun: 'Upload',
  legacyOriginalNameFallback: true,
}

const OUTPUTS_NS: ChatFileNamespace = {
  context: 'output',
  prefix: 'outputs',
  noun: 'Output',
  legacyOriginalNameFallback: false,
}

type ChatFileRow = typeof workspaceFiles.$inferSelect

/**
 * Canonical comparison key for a chat file's VFS name. Accepts both the raw
 * display name and a percent-encoded segment (decode first — a no-op for raw
 * names — then re-encode to the canonical `files/`-style form) so either
 * spelling resolves the same row. Raw names containing a literal `%` cannot
 * be decoded; fall back to encoding the raw name.
 */
function canonicalNameKey(name: string): string {
  let decoded = name
  try {
    decoded = decodeVfsSegment(name)
  } catch {
    decoded = name
  }
  try {
    return encodeVfsSegment(decoded)
  } catch {
    return name.trim()
  }
}

/** VFS-visible name. Coalesces to originalName for legacy upload rows that predate displayName. */
function vfsName(row: ChatFileRow): string {
  return row.displayName ?? row.originalName
}

function toWorkspaceFileRecord(ns: ChatFileNamespace, row: ChatFileRow): WorkspaceFileRecord {
  const pathPrefix = getServePathPrefix()
  return {
    id: row.id,
    workspaceId: row.workspaceId || '',
    name: vfsName(row),
    key: row.key,
    path: `${pathPrefix}${encodeURIComponent(row.key)}?context=${ns.context}`,
    size: row.size,
    type: row.contentType,
    uploadedBy: row.userId,
    folderId: null,
    deletedAt: row.deletedAt,
    uploadedAt: row.uploadedAt,
    updatedAt: row.updatedAt,
    storageContext: ns.context,
  }
}

/**
 * Resolve a chat-scoped row by VFS name (the collision-disambiguated
 * `displayName`; for uploads also legacy `originalName` rows that predate the
 * column). Prefers an exact DB match; falls back to a normalized scan when
 * the model passes a visually equivalent name (e.g. macOS U+202F vs ASCII
 * space in screenshot filenames, or an encoded vs decoded spelling).
 *
 * On ambiguity (duplicate names within one chat) returns the most recent row.
 */
async function findChatFileRowByChatAndName(
  ns: ChatFileNamespace,
  chatId: string,
  fileName: string
): Promise<ChatFileRow | null> {
  const nameMatch: SQL | undefined = ns.legacyOriginalNameFallback
    ? or(
        eq(workspaceFiles.displayName, fileName),
        and(isNull(workspaceFiles.displayName), eq(workspaceFiles.originalName, fileName))
      )
    : eq(workspaceFiles.displayName, fileName)

  const exactRows = await db
    .select()
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.chatId, chatId),
        eq(workspaceFiles.context, ns.context),
        nameMatch,
        isNull(workspaceFiles.deletedAt)
      )
    )
    .orderBy(desc(workspaceFiles.uploadedAt), desc(workspaceFiles.id))
    .limit(1)

  if (exactRows[0]) {
    return exactRows[0]
  }

  const allRows = await db
    .select()
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.chatId, chatId),
        eq(workspaceFiles.context, ns.context),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .orderBy(desc(workspaceFiles.uploadedAt), desc(workspaceFiles.id))

  const segmentKey = canonicalNameKey(fileName)
  return allRows.find((r) => canonicalNameKey(vfsName(r)) === segmentKey) ?? null
}

async function resolveChatFileRecord(
  ns: ChatFileNamespace,
  chatId: string,
  fileName: string
): Promise<WorkspaceFileRecord | null> {
  const row = await findChatFileRowByChatAndName(ns, chatId, fileName)
  return row ? toWorkspaceFileRecord(ns, row) : null
}

async function listChatFiles(
  ns: ChatFileNamespace,
  chatId: string
): Promise<WorkspaceFileRecord[]> {
  try {
    const rows = await db
      .select()
      .from(workspaceFiles)
      .where(
        and(
          eq(workspaceFiles.chatId, chatId),
          eq(workspaceFiles.context, ns.context),
          isNull(workspaceFiles.deletedAt)
        )
      )
      .orderBy(asc(workspaceFiles.uploadedAt), asc(workspaceFiles.id))

    return rows.map((row) => toWorkspaceFileRecord(ns, row))
  } catch (err) {
    logger.warn(`Failed to list chat ${ns.prefix}`, {
      chatId,
      error: toError(err).message,
    })
    return []
  }
}

async function readChatFile(
  ns: ChatFileNamespace,
  filename: string,
  chatId: string
): Promise<FileReadResult | null> {
  try {
    const row = await findChatFileRowByChatAndName(ns, chatId, filename)
    if (!row) return null
    return readFileRecord(toWorkspaceFileRecord(ns, row))
  } catch (err) {
    logger.warn(`Failed to read chat ${ns.prefix.slice(0, -1)}`, {
      filename,
      chatId,
      error: toError(err).message,
    })
    return null
  }
}

/**
 * Grep the content of a single chat-scoped file (`uploads/<name>` or
 * `outputs/<name>`), mirroring {@link WorkspaceVFS.grepFile} for the chat
 * namespaces. Resolves the file by name (raw or percent-encoded), reads its
 * text per file type, and greps it. Throws {@link WorkspaceFileGrepError}
 * when the file is missing or has no searchable text (image/binary/too-large)
 * so the caller surfaces the message verbatim.
 */
async function grepChatFile(
  ns: ChatFileNamespace,
  filename: string,
  chatId: string,
  pattern: string,
  options?: GrepOptions
): Promise<GrepMatch[] | string[] | GrepCountEntry[]> {
  const row = await findChatFileRowByChatAndName(ns, chatId, filename)
  if (!row) {
    throw new WorkspaceFileGrepError(
      `${ns.noun} not found: "${filename}". Use glob("${ns.prefix}/*") to list available ${ns.prefix}.`
    )
  }
  const record = toWorkspaceFileRecord(ns, row)
  const result = await readFileRecord(record)
  if (!result) {
    throw new WorkspaceFileGrepError(`${ns.noun} content not found for "${filename}".`)
  }
  const vfsPath = `${ns.prefix}/${canonicalNameKey(record.name)}`
  return grepReadResult(vfsPath, result, pattern, vfsPath, options)
}

/** Resolve a chat upload row by VFS name. See {@link findChatFileRowByChatAndName}. */
export async function findMothershipUploadRowByChatAndName(
  chatId: string,
  fileName: string
): Promise<ChatFileRow | null> {
  return findChatFileRowByChatAndName(UPLOADS_NS, chatId, fileName)
}

/** Resolve a chat output row by VFS name. See {@link findChatFileRowByChatAndName}. */
export async function findChatOutputRowByChatAndName(
  chatId: string,
  fileName: string
): Promise<ChatFileRow | null> {
  return findChatFileRowByChatAndName(OUTPUTS_NS, chatId, fileName)
}

/**
 * Resolve a chat upload by VFS name to a serve-ready {@link WorkspaceFileRecord}
 * (storageContext `mothership`), for callers that need the file itself rather
 * than its text content (e.g. media tools loading a reference image).
 */
export async function resolveChatUploadRecord(
  chatId: string,
  fileName: string
): Promise<WorkspaceFileRecord | null> {
  return resolveChatFileRecord(UPLOADS_NS, chatId, fileName)
}

/** Output twin of {@link resolveChatUploadRecord} (storageContext `output`). */
export async function resolveChatOutputRecord(
  chatId: string,
  fileName: string
): Promise<WorkspaceFileRecord | null> {
  return resolveChatFileRecord(OUTPUTS_NS, chatId, fileName)
}

/**
 * Resolve a chat-owned file (upload OR output) by its raw `workspace_files`
 * id. The by-name resolvers above cover `uploads/`/`outputs/` paths; this
 * covers the model passing a bare `wf_` id for a chat-scoped file, which the
 * workspace resolver cannot see (it pins `context='workspace'`).
 */
export async function resolveChatFileRecordById(
  chatId: string,
  fileId: string
): Promise<WorkspaceFileRecord | null> {
  const rows = await db
    .select()
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.id, fileId),
        eq(workspaceFiles.chatId, chatId),
        inArray(workspaceFiles.context, [UPLOADS_NS.context, OUTPUTS_NS.context]),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return toWorkspaceFileRecord(row.context === OUTPUTS_NS.context ? OUTPUTS_NS : UPLOADS_NS, row)
}

/** List all chat-scoped uploads for a given chat in upload order. */
export async function listChatUploads(chatId: string): Promise<WorkspaceFileRecord[]> {
  return listChatFiles(UPLOADS_NS, chatId)
}

/** List all chat-scoped outputs for a given chat in creation order. */
export async function listChatOutputs(chatId: string): Promise<WorkspaceFileRecord[]> {
  return listChatFiles(OUTPUTS_NS, chatId)
}

/** Read a specific uploaded file by VFS name within a chat session. */
export async function readChatUpload(
  filename: string,
  chatId: string
): Promise<FileReadResult | null> {
  return readChatFile(UPLOADS_NS, filename, chatId)
}

/** Read a specific output file by VFS name within a chat session. */
export async function readChatOutput(
  filename: string,
  chatId: string
): Promise<FileReadResult | null> {
  return readChatFile(OUTPUTS_NS, filename, chatId)
}

/** Grep a single chat upload's content. See {@link grepChatFile}. */
export async function grepChatUpload(
  filename: string,
  chatId: string,
  pattern: string,
  options?: GrepOptions
): Promise<GrepMatch[] | string[] | GrepCountEntry[]> {
  return grepChatFile(UPLOADS_NS, filename, chatId, pattern, options)
}

/** Grep a single chat output's content. See {@link grepChatFile}. */
export async function grepChatOutput(
  filename: string,
  chatId: string,
  pattern: string,
  options?: GrepOptions
): Promise<GrepMatch[] | string[] | GrepCountEntry[]> {
  return grepChatFile(OUTPUTS_NS, filename, chatId, pattern, options)
}
