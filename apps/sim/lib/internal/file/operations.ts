import { Buffer, isUtf8 } from 'buffer'
import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import JSZip from 'jszip'
import type { ContractBody } from '@/lib/api/contracts'
import type { fileManageContract } from '@/lib/api/contracts/tools/file'
import { DEFAULT_FILE_LIST_LIMIT } from '@/lib/api/contracts/tools/file'
import { splitWorkspaceFilePath } from '@/lib/copilot/tools/server/files/workspace-file'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { ensureAbsoluteUrl } from '@/lib/core/utils/urls'
import { isUserFile } from '@/lib/core/utils/user-file'
import { durableSecretProvenanceFromPrivateBundle } from '@/lib/execution/durable-secret-provenance'
import {
  inspectPrivateSecretProvenanceRequest,
  isPrivateSecretProvenanceBundleV1,
} from '@/lib/execution/model-input-provenance'
import { assertUserFileContentAccess } from '@/lib/execution/payloads/materialization.server'
import {
  PRIVATE_TOOL_METADATA_RESPONSE_HEADER,
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
  requestsPrivateToolMetadata,
} from '@/lib/execution/private-tool-metadata'
import { isSupportedFileType, parseBuffer } from '@/lib/file-parsers'
import { buildFolderPath, parseFolderPath, ROOT_FOLDER_PATH } from '@/lib/folders/paths'
import type { FolderIdScope } from '@/lib/folders/scope'
import { collectFolderDepths } from '@/lib/folders/subtree'
import { ShareValidationError } from '@/lib/public-shares/share-manager'
import {
  ArchiveError,
  type DecompressResult,
  decompressArchiveBufferToWorkspaceFiles,
  MAX_ARCHIVE_BYTES,
  statusForArchiveError,
} from '@/lib/uploads/archive'
import { normalizeWorkspaceFileItemName } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import type {
  getWorkspaceFile,
  WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  mergeWorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenanceIdentity,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  getFileExtension,
  getMimeTypeFromExtension,
  tryInferContextFromKey,
} from '@/lib/uploads/utils/file-utils'
import {
  downloadFileFromStorage,
  downloadServableFileFromStorage,
} from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { buildZipEntryPaths } from '@/lib/uploads/zip-entry-path'
import {
  admitCreateWorkspaceFile,
  createWorkspaceFile,
  createWorkspaceFileFromBuffer,
} from '@/lib/workspace-files/application/create-workspace-file'
import { editWorkspaceFileContent } from '@/lib/workspace-files/application/edit-workspace-file-content'
import {
  listWorkspaceFilesInFolderScope,
  queryWorkspaceFilePage,
} from '@/lib/workspace-files/application/list-workspace-files'
import { moveWorkspaceFileItemsOperation } from '@/lib/workspace-files/application/move-workspace-file-items'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
import { readWorkspaceFileMetadata } from '@/lib/workspace-files/application/read-workspace-file-metadata'
import { downloadWorkspaceFileRecord } from '@/lib/workspace-files/application/read-workspace-file-record'
import { readWorkspaceFileSecretProvenance } from '@/lib/workspace-files/application/read-workspace-file-secret-provenance'
import { resolveWorkspaceFileReference } from '@/lib/workspace-files/application/resolve-workspace-file-reference'
import {
  getWorkspaceFileShares,
  updateWorkspaceFileShare,
} from '@/lib/workspace-files/application/share-workspace-file'
import { updateWorkspaceFileContent } from '@/lib/workspace-files/application/update-workspace-file-content'
import {
  createWorkspaceFileFolderOperation,
  deleteWorkspaceFileFolderOperation,
  ensureWorkspaceFileFolderPathOperation,
  listWorkspaceFileFoldersOperation,
  restoreWorkspaceFileFolderOperation,
  updateWorkspaceFileFolderOperation,
} from '@/lib/workspace-files/application/workspace-file-folders'
import { selectDirectoryEntries } from '@/lib/workspace-files/directory-listing'
import type { WorkspaceFileContentEdit } from '@/lib/workspace-files/edit-content'
import { countLines, detectLineEnding } from '@/lib/workspace-files/edit-content'
import { toWorkspaceFileFolderPathView } from '@/lib/workspace-files/folder-display-path'
import { resolveFolderIdsForPaths } from '@/lib/workspace-files/folder-path-selection'
import {
  MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS,
  MAX_ZIP_DOWNLOAD_FILES,
} from '@/lib/workspace-files/limits'
import { MAX_WORKSPACE_FILE_CONTENT_BYTES } from '@/lib/workspace-files/orchestration'
import { isWorkspaceAccessDeniedError } from '@/lib/workspaces/permissions/utils'
import type { UserFile } from '@/executor/types'
import {
  ResolvedSecretTraceProvenanceAccumulator,
  type ResolvedSecretTraceProvenanceV1,
  type ResolvedSecretTraceScopeV1,
} from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('FileManageAPI')

export type FileManageOperationInput = ContractBody<typeof fileManageContract>

export interface FileManageOperationContext {
  principal: Principal
  workspaceId: string
  attributedUserId: string
  fileAccessUserId?: string
  workflowId: string
  executionId?: string
  largeValueExecutionIds?: string[]
  fileKeys?: string[]
  allowLargeValueWorkflowScope?: boolean
  headers: Headers
  requestId: string
  signal?: AbortSignal
}

function directoryFileScopeForDepthRange(
  rootId: string | null,
  folderDepths: ReadonlyMap<string, number>,
  minDepth: number,
  maxDepth: number
): FolderIdScope {
  const folderIds = new Set<string>()

  if (minDepth <= 0 && maxDepth >= 0 && rootId !== null) folderIds.add(rootId)
  for (const [folderId, depth] of folderDepths) {
    if (depth >= minDepth && depth <= maxDepth) folderIds.add(folderId)
  }

  return {
    folderIds,
    includeRootItems: rootId === null && minDepth <= 0 && maxDepth >= 0,
  }
}

function hasDirectoryFileScope(scope: FolderIdScope): boolean {
  return scope.includeRootItems || scope.folderIds.size > 0
}

async function assertOperationFileAccess(
  file: Pick<UserFile, 'key' | 'context'>,
  context: FileManageOperationContext
): Promise<Response | null> {
  try {
    await assertUserFileContentAccess(file, {
      principal: context.principal,
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      executionId: context.executionId,
      largeValueExecutionIds: context.largeValueExecutionIds,
      fileKeys: context.fileKeys,
      allowLargeValueWorkflowScope: context.allowLargeValueWorkflowScope,
      userId: context.fileAccessUserId,
      requestId: context.requestId,
      logger,
    })
    return null
  } catch {
    logger.warn('File access denied', { key: file.key, requestId: context.requestId })
    return Response.json({ success: false, error: 'File not found' }, { status: 404 })
  }
}

const workspaceFileToUserFile = (file: Awaited<ReturnType<typeof getWorkspaceFile>>) => {
  if (!file) return null

  return {
    id: file.id,
    name: file.name,
    url: ensureAbsoluteUrl(file.path),
    size: file.size,
    type: file.type,
    key: file.key,
    context: 'workspace' as const,
  }
}

const fileInputToUserFile = (fileInput: unknown) => {
  if (!fileInput || typeof fileInput !== 'object' || Array.isArray(fileInput)) return null

  const record = fileInput as Record<string, unknown>
  const id =
    typeof record.id === 'string'
      ? record.id.trim()
      : typeof record.fileId === 'string'
        ? record.fileId.trim()
        : ''

  // Objects with ids are resolved through workspace metadata. This fallback is for
  // picker/upload values that only carry storage fields.
  if (id) return null

  const key = typeof record.key === 'string' ? record.key.trim() : ''
  const path = typeof record.path === 'string' ? record.path.trim() : ''
  const url = typeof record.url === 'string' ? record.url.trim() : ''
  const fileUrl =
    url || path || (key ? `/api/files/serve/${encodeURIComponent(key)}?context=workspace` : '')

  if (!fileUrl && !key) return null

  // A key this normalizer cannot classify is request input we cannot use, which
  // is what `null` already means here — the throwing form would turn a malformed
  // client value into a 500 from every operation that normalizes a file input.
  const context = key ? tryInferContextFromKey(key) : null
  if (key && !context) return null

  return {
    id: key || fileUrl,
    name:
      typeof record.name === 'string' && record.name.trim() ? record.name.trim() : 'workspace-file',
    url: fileUrl ? ensureAbsoluteUrl(fileUrl) : '',
    size: typeof record.size === 'number' ? record.size : 0,
    type:
      typeof record.type === 'string' && record.type.trim()
        ? record.type.trim()
        : 'application/octet-stream',
    key,
    // Only absent when there is no key at all — an unclassifiable one returned
    // above rather than reaching here.
    context: context ?? undefined,
  }
}

const normalizeFileIdList = (value: unknown): string[] => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return [trimmed]
    }
    return normalizeFileIdList(parsed)
  }

  if (!Array.isArray(value)) return []

  const ids = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((id) => id.length > 0)
  if (ids.length > MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS) {
    throw new OrchestrationError(
      'payload_too_large',
      `File selection contains more than ${MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS} files`
    )
  }
  return ids
}

const fileInputs = (fileInput: unknown): unknown[] => {
  const inputs = Array.isArray(fileInput) ? fileInput : fileInput ? [fileInput] : []
  if (inputs.length > MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS) {
    throw new OrchestrationError(
      'payload_too_large',
      `File input contains more than ${MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS} files`
    )
  }
  return inputs
}

const extractUserFilesFromInput = (fileInput: unknown) => {
  return fileInputs(fileInput)
    .map((input) => fileInputToUserFile(input))
    .filter((file): file is NonNullable<ReturnType<typeof fileInputToUserFile>> => Boolean(file))
}

const extractFileIdsFromInput = (fileInput: unknown): string[] => {
  const ids = fileInputs(fileInput)
    .flatMap((input) => {
      if (typeof input === 'string') return normalizeFileIdList(input)
      if (input && typeof input === 'object') {
        const record = input as Record<string, unknown>
        if (typeof record.id === 'string') return normalizeFileIdList(record.id)
        if (typeof record.fileId === 'string') return normalizeFileIdList(record.fileId)
      }
      return []
    })
    .filter((id) => id.length > 0)
  if (ids.length > MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS) {
    throw new OrchestrationError(
      'payload_too_large',
      `File selection contains more than ${MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS} files`
    )
  }
  return ids
}

function assertFileSelectionLimit(count: number, limit: number, message: string): void {
  if (count > limit) throw new OrchestrationError('payload_too_large', message)
}

function resolveSelectedFileIds(fileId: unknown, fileInput: unknown): string[] {
  const ids = Array.isArray(fileId)
    ? fileId.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)
    : fileId
      ? normalizeFileIdList(fileId)
      : extractFileIdsFromInput(fileInput)
  assertFileSelectionLimit(
    ids.length,
    MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS,
    `File selection contains more than ${MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS} files`
  )
  return ids
}

/** Per-file download cap for the content operation. Aligned with the durable large-value ceiling. */
const MAX_GET_CONTENT_FILE_BYTES = 64 * 1024 * 1024
/** Combined extracted-text cap so the content array stays within the large-value-ref ceiling. */
const MAX_GET_CONTENT_TOTAL_BYTES = 64 * 1024 * 1024

/**
 * Cap on a file stored through `write`'s `fileInput`, pinned to the destination's
 * own ceiling. A larger cap here would let a 50–100MB file be downloaded and
 * base64-encoded in this process only for `createWorkspaceFile` to reject it, so
 * the expensive transfer is refused up front instead.
 */
const MAX_WRITE_FILE_INPUT_BYTES = MAX_WORKSPACE_FILE_CONTENT_BYTES

/** Per-file download cap for the compress operation. */
const MAX_COMPRESS_FILE_BYTES = 100 * 1024 * 1024
/** Combined input cap for the compress operation to bound in-memory archiving. */
const MAX_COMPRESS_TOTAL_BYTES = 100 * 1024 * 1024

/** Ensure an archive name ends with a single `.zip` extension. */
const ensureZipExtension = (name: string): string =>
  name.toLowerCase().endsWith('.zip') ? name : `${name}.zip`

/** Strip the trailing extension from a file name (e.g., "report.pdf" -> "report"). */
const stripExtension = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/**
 * Reduce an arbitrary name to a safe, flat file name: takes the final path
 * segment, drops directory and traversal components, and falls back when the
 * result would be empty or a dot segment. Used for the compress archive name so
 * untrusted input cannot introduce nested or zip-slip-style paths.
 */
const toFlatFileName = (name: string, fallback: string): string => {
  const { leafName } = splitWorkspaceFilePath(name.replaceAll('\\', '/'))
  try {
    return normalizeWorkspaceFileItemName(leafName, 'File')
  } catch {
    return fallback
  }
}

/** A file bound for a compress archive, paired with the workspace folder it lives in. */
interface ArchiveEntry {
  file: UserFile
  folderPath: string | null
}

const isLikelyTextBuffer = (buffer: Buffer): boolean => isUtf8(buffer) && !buffer.includes(0)

/** What a caller needs to tell a file that ended from a window that ran out. */
interface FileContentLineRange {
  offset: number
  lineCount: number
  totalLines: number
  /** False when extraction was truncated, so `totalLines` is not the file's end. */
  totalLinesExact: boolean
}

/**
 * Narrows extracted text to a line window.
 *
 * Reported alongside the text rather than inferred from it: without
 * `totalLines` a caller cannot distinguish a file that ended from a window
 * that stopped early, which is the same absent-versus-unknown confusion the
 * search index carries.
 */
function sliceTextLines(
  text: string,
  offset: number | undefined,
  limit: number | undefined,
  truncatedExtraction: boolean
): { text: string; range?: FileContentLineRange } {
  if (offset === undefined && limit === undefined) return { text }

  /* Counted the same way insert accepts them; see {@link countLines}. */
  const effective = text.split(/\r\n|\n/).slice(0, countLines(text))
  const start = Math.max((offset ?? 1) - 1, 0)
  const window = effective.slice(start, limit === undefined ? undefined : start + limit)

  return {
    /* Rejoined with the text's own ending, so the window stays usable verbatim as an edit's search text. */
    text: window.join(detectLineEnding(text)),
    range: {
      offset: start + 1,
      lineCount: window.length,
      totalLines: effective.length,
      totalLinesExact: !truncatedExtraction,
    },
  }
}

/**
 * Download a stored file and extract its text content. Parseable types (PDF, DOCX,
 * CSV, etc.) go through the shared file-parsers; other UTF-8 files are returned as
 * raw text; binary files yield a short placeholder rather than corrupt bytes.
 */
/**
 * Extracted text, plus whether the parser reached the end of the input.
 *
 * `truncated` travels because a line range computed over a truncated
 * extraction would otherwise report the prefix's length as the file's end.
 */
interface ExtractedFileText {
  text: string
  truncated: boolean
}

const extractUserFileTextContent = async (
  userFile: UserFile,
  requestId: string
): Promise<ExtractedFileText> => {
  const { buffer } = await downloadServableFileFromStorage(userFile, requestId, logger, {
    maxBytes: MAX_GET_CONTENT_FILE_BYTES,
  })

  const extension = getFileExtension(userFile.name)
  if (extension && isSupportedFileType(extension)) {
    try {
      const result = await parseBuffer(buffer, extension)
      return { text: result.content ?? '', truncated: result.metadata?.truncated === true }
    } catch (error) {
      logger.warn('Falling back to raw text after parser failure', {
        name: userFile.name,
        error: getErrorMessage(error, 'Unknown error'),
      })
    }
  }

  if (isLikelyTextBuffer(buffer)) {
    return { text: buffer.toString('utf-8'), truncated: false }
  }

  return {
    text: `[Binary file: ${userFile.name} (${userFile.type || 'application/octet-stream'}, ${buffer.length} bytes). Cannot extract text content.]`,
    truncated: false,
  }
}

export interface FileContentProvenanceSource {
  identity?: WorkspaceFileSecretProvenanceIdentity
  ownerUserId?: string
}

interface FileContentSource extends FileContentProvenanceSource {
  file: UserFile
}

async function bindSelectedContentFile(
  principal: Principal,
  workspaceId: string,
  file: UserFile
): Promise<FileContentSource> {
  if (!file.key || file.context !== 'workspace') return { file }

  let metadata: Awaited<ReturnType<typeof resolveWorkspaceFileReference>>
  try {
    metadata = await resolveWorkspaceFileReference({
      principal,
      operation: fileOperations.readContent,
      workspaceId,
      reference: file.key,
    })
  } catch (error) {
    if (error instanceof OrchestrationError && error.code === 'not_found') return { file }
    throw error
  }
  if (!metadata) return { file }

  return {
    file,
    identity: {
      fileId: metadata.id,
      key: metadata.key,
      context: 'workspace',
      contentUpdatedAt: metadata.contentUpdatedAt ?? undefined,
    },
    ownerUserId: metadata.uploadedBy,
  }
}

export async function getFileContentProvenance(
  principal: Principal,
  workspaceId: string,
  sources: readonly FileContentProvenanceSource[],
  signal?: AbortSignal
): Promise<ResolvedSecretTraceProvenanceV1> {
  signal?.throwIfAborted()
  const ownerIds = new Set(
    sources
      .map((source) => source.ownerUserId)
      .filter((ownerUserId): ownerUserId is string => Boolean(ownerUserId))
  )
  const ownerUserId = ownerIds.size === 1 ? ownerIds.values().next().value : undefined
  const scope: ResolvedSecretTraceScopeV1 | undefined = ownerUserId
    ? { userId: ownerUserId, workspaceId }
    : undefined
  const accumulator = new ResolvedSecretTraceProvenanceAccumulator(scope)

  for (const source of sources) {
    signal?.throwIfAborted()
    if (!source.identity || !source.ownerUserId) {
      accumulator.markIncomplete('file-source-unidentified')
      continue
    }
    const { provenance } = await readWorkspaceFileSecretProvenance.execute({
      principal,
      input: {
        fileId: source.identity.fileId,
        assertedWorkspaceId: workspaceId,
        expectedContentUpdatedAt: source.identity.contentUpdatedAt,
      },
    })
    signal?.throwIfAborted()
    /**
     * `unrecorded` is a more specific `unknown`, and this accumulator has not opted into the
     * workspace file surface's policy, so it latches exactly as it did before.
     */
    if (provenance.status !== 'exact') {
      accumulator.markIncomplete('workspace-file-provenance-unknown')
      continue
    }
    accumulator.record({
      version: 1,
      complete: true,
      entries: [...provenance.entries],
      ...(scope ? { scope } : {}),
    })
  }

  return accumulator.exportProvenance()
}

type FileMutationProvenanceResolution =
  | {
      success: true
      provenanceBySelection?: ReadonlyMap<string, WorkspaceFileSecretProvenance>
    }
  | { success: false; error: string }

/** Authenticates exact, causally selected file-mutation provenance from an internal caller. */
function resolveFileMutationSecretProvenance(options: {
  headers: Headers
  payload: unknown
  userId: string
  workspaceId: string
  selectionKeys: readonly string[]
}): FileMutationProvenanceResolution {
  const inspection = inspectPrivateSecretProvenanceRequest(options.headers, options.payload)
  if (inspection.status === 'unsupported') return { success: true }
  if (inspection.status !== 'verified' || !isPrivateSecretProvenanceBundleV1(inspection.value)) {
    return { success: false, error: 'Invalid file secret provenance' }
  }

  const provenanceBySelection = new Map<string, WorkspaceFileSecretProvenance>()
  if (!inspection.value.complete) {
    for (const selectionKey of options.selectionKeys) {
      provenanceBySelection.set(selectionKey, { status: 'unknown' })
    }
    return { success: true, provenanceBySelection }
  }
  if (inspection.value.selections.length !== options.selectionKeys.length) {
    return { success: false, error: 'Invalid file secret provenance' }
  }

  const destinationScope = { userId: options.userId, workspaceId: options.workspaceId }
  for (const selectionKey of options.selectionKeys) {
    const provenance = durableSecretProvenanceFromPrivateBundle(
      inspection.value,
      selectionKey,
      destinationScope
    )
    if (!provenance) {
      return { success: false, error: 'Invalid file secret provenance' }
    }
    if (provenance.status === 'unknown') {
      provenanceBySelection.set(selectionKey, provenance)
      continue
    }
    if (provenance.entries.some((entry) => !entry.name || !entry.sourceUserId)) {
      return { success: false, error: 'Invalid file secret provenance' }
    }
    provenanceBySelection.set(selectionKey, {
      status: 'exact',
      entries: provenance.entries.map((entry) => ({
        name: entry.name as string,
        encryptedValue: entry.encryptedValue,
        sourceUserId: entry.sourceUserId as string,
        ...(entry.sourceWorkspaceId ? { sourceWorkspaceId: entry.sourceWorkspaceId } : {}),
      })),
    })
  }
  return { success: true, provenanceBySelection }
}

type FileWriteProvenanceResolution =
  | { success: true; contentProvenance?: WorkspaceFileSecretProvenance }
  | { success: false; error: string }

/** Resolves file-content provenance before any folder or file mutation. */
function resolveFileWriteSecretProvenance(options: {
  headers: Headers
  payload: unknown
  userId: string
  workspaceId: string
}): FileWriteProvenanceResolution {
  const resolution = resolveFileMutationSecretProvenance({
    ...options,
    selectionKeys: ['content'],
  })
  if (!resolution.success || !resolution.provenanceBySelection) return resolution
  const content = resolution.provenanceBySelection.get('content')
  if (!content) {
    return { success: false, error: 'Invalid file secret provenance' }
  }
  return { success: true, contentProvenance: content }
}

/**
 * Resolves the file an overwriting write should replace, or null when nothing exists at the
 * target path. A picker path is already resolved to a canonical folder id, so its exact-name
 * lookup stays inside that folder and never expands the folder's descendants.
 */
async function resolveWriteOverwriteTarget(options: {
  principal: Principal
  workspaceId: string
  folderId: string | null
  /** Canonical destination when one was picked; unambiguous where a joined reference is not. */
  folderPath?: string
  folderSegments: string[]
  leafName: string
}) {
  const { principal, workspaceId, folderId, folderPath, folderSegments, leafName } = options
  const reference = folderPath ? leafName : [...folderSegments, leafName].join('/')

  let existing: Awaited<ReturnType<typeof resolveWorkspaceFileReference>>
  try {
    existing = await resolveWorkspaceFileReference({
      principal,
      operation: fileOperations.updateContent,
      workspaceId,
      reference,
      ...(folderPath ? { folderId } : {}),
    })
  } catch (error) {
    if (error instanceof OrchestrationError && error.code === 'not_found') return null
    throw error
  }
  if ((existing.folderId ?? null) !== folderId || existing.name !== leafName) return null
  return existing
}

async function deriveWorkspaceFileSecretProvenance(options: {
  principal: Principal
  workspaceId: string
  targetOwnerUserId: string
  sources: readonly FileContentSource[]
}): Promise<WorkspaceFileSecretProvenance> {
  const provenances: WorkspaceFileSecretProvenance[] = []
  for (const source of options.sources) {
    if (!source.identity || !source.ownerUserId) return { status: 'unknown' }
    const { provenance } = await readWorkspaceFileSecretProvenance.execute({
      principal: options.principal,
      input: { fileId: source.identity.fileId, assertedWorkspaceId: options.workspaceId },
    })
    if (
      provenance.status === 'exact' &&
      provenance.entries.length > 0 &&
      source.ownerUserId !== options.targetOwnerUserId
    ) {
      return { status: 'unknown' }
    }
    provenances.push(provenance)
  }
  return mergeWorkspaceFileSecretProvenance(...provenances)
}

export function fileContentJsonResponse(
  body: Record<string, unknown>,
  includePrivateProvenance: boolean,
  init?: ResponseInit,
  provenance: ResolvedSecretTraceProvenanceV1 = { version: 1, complete: true, entries: [] }
): Response {
  if (!includePrivateProvenance) return Response.json(body, init)

  const headers = new Headers(init?.headers)
  headers.delete('content-length')
  headers.set(PRIVATE_TOOL_METADATA_RESPONSE_HEADER, RESOLVED_SECRET_PROVENANCE_METADATA_V1)
  return Response.json(
    { ...body, [RESOLVED_SECRET_PROVENANCE_FIELD]: provenance },
    { ...init, headers }
  )
}

/**
 * Expands folder paths to every file beneath them.
 *
 * The scope resolution is shared with content search, which pushes the same
 * scope down into SQL rather than listing files; this is the file half of it.
 */
async function expandFolderPathsToFiles(args: {
  principal: Principal
  workspaceId: string
  folderPaths: string[] | undefined
  includeSubfolders: boolean | undefined
  limit?: number
}): Promise<WorkspaceFileRecord[]> {
  if (!args.folderPaths?.length) return []

  const limit = args.limit ?? MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS
  const { files, truncated } = await listWorkspaceFilesInFolderScope.execute({
    principal: args.principal,
    input: {
      workspaceId: args.workspaceId,
      folderPaths: args.folderPaths,
      includeSubfolders: args.includeSubfolders,
      limit,
    },
  })
  if (truncated) {
    throw new OrchestrationError(
      'payload_too_large',
      `Folder selection contains more than ${limit} files`
    )
  }
  return files
}

/**
 * Resolves explicit ids and dynamic folder contents into one bounded metadata
 * selection. Folder rows already crossed the authorized list boundary, so only
 * explicit ids need individual lookup; a folder-only read remains two bounded
 * queries instead of becoming one metadata query per file.
 */
async function loadSelectedWorkspaceFileMetadata(args: {
  principal: Principal
  workspaceId: string
  fileIds: string[]
  folderPaths: string[] | undefined
  includeSubfolders: boolean | undefined
}): Promise<WorkspaceFileRecord[]> {
  const folderFiles = await expandFolderPathsToFiles(args)
  const folderFileById = new Map(folderFiles.map((file) => [file.id, file]))
  const files: WorkspaceFileRecord[] = []
  const seen = new Set<string>()

  for (const id of args.fileIds) {
    if (seen.has(id)) continue
    const folderFile = folderFileById.get(id)
    if (folderFile) {
      files.push(folderFile)
      seen.add(id)
      continue
    }
    try {
      files.push(
        (
          await readWorkspaceFileMetadata.execute({
            principal: args.principal,
            input: { fileId: id, assertedWorkspaceId: args.workspaceId },
          })
        ).file
      )
      seen.add(id)
    } catch (error) {
      if (error instanceof OrchestrationError && error.code === 'not_found') {
        throw new OrchestrationError('not_found', `File not found: "${id}"`)
      }
      throw error
    }
  }

  for (const file of folderFiles) {
    if (seen.has(file.id)) continue
    files.push(file)
    seen.add(file.id)
  }
  if (files.length > MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS) {
    throw new OrchestrationError(
      'payload_too_large',
      `File selection contains more than ${MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS} files`
    )
  }
  return files
}

async function expandFolderPathsToFileIds(args: {
  principal: Principal
  workspaceId: string
  folderPaths: string[] | undefined
  includeSubfolders: boolean | undefined
  limit?: number
}): Promise<string[]> {
  return (await expandFolderPathsToFiles(args)).map((file) => file.id)
}

/**
 * Resolves a typed file name inside a chosen folder to a canonical id.
 *
 * A picked file arrives as a canonical id, which is already exact. A typed name
 * is not: the same name can exist in several folders, and a workspace-wide
 * lookup takes the oldest match anywhere. When a folder was chosen it is the
 * only thing disambiguating the target, so the name is resolved inside it, by
 * id, so the slash-in-a-folder-name hazard of a path-shaped reference never
 * arises.
 *
 * Shared by every operation that writes to a named file, because each of them
 * has the same way to go wrong and this logic has already been rewritten twice
 * under review.
 */
async function resolveScopedFileReference(args: {
  principal: Principal
  workspaceId: string
  fileName: string
  folderPath: string | undefined
  folderPaths: string[] | undefined
  includeSubfolders: boolean | undefined
}): Promise<string> {
  const { fileName } = args
  const folderPaths = args.folderPaths ?? (args.folderPath ? [args.folderPath] : [])
  if (folderPaths.length === 0) return fileName
  const scopeLabel = folderPaths.join(', ')

  const scoped = await expandFolderPathsToFiles({
    principal: args.principal,
    workspaceId: args.workspaceId,
    folderPaths,
    includeSubfolders: args.includeSubfolders,
  })
  /*
   * An exact id inside the scope wins outright. Matching id and name together
   * let a file NAMED like an id outproduce the file that actually carries it:
   * `wf_` is a legal filename prefix, so a caller passing a real id could be
   * answered with a different file that merely happens to be called that.
   */
  const byId = scoped.find((file) => file.id === fileName)
  if (byId) return byId.id

  /*
   * A reference that IS a real file id, but for a file outside this folder, is
   * out of scope — never a name match. Falling through would answer a caller
   * who named one file exactly with a different file that happens to be called
   * like that id, which is the same lookalike hazard pointed the other way.
   *
   * Decided by looking the id up rather than by its shape, because `wf_` is a
   * legal filename prefix and inferring from it is what this resolution has
   * twice been wrong about.
   */
  let exactIdExists = false
  try {
    await readWorkspaceFileMetadata.execute({
      principal: args.principal,
      input: { fileId: fileName, assertedWorkspaceId: args.workspaceId },
    })
    exactIdExists = true
  } catch (error) {
    if (!(error instanceof OrchestrationError) || error.code !== 'not_found') throw error
  }
  if (exactIdExists) {
    throw new OrchestrationError('not_found', `File ${fileName} is not in ${scopeLabel}`)
  }

  const matches = scoped.filter((file) => file.name === fileName)
  if (matches.length === 0) {
    throw new OrchestrationError('not_found', `No file named ${fileName} in ${scopeLabel}`)
  }
  /*
   * A recursive scope can hold the same name at several depths, and writing to
   * whichever the walk happened to reach first is a silent write to an
   * arbitrary file. Refusing names the candidates so the caller can pick one,
   * which is the whole reason the scope exists.
   */
  if (matches.length > 1) {
    throw new OrchestrationError(
      'validation',
      `${matches.length} files named ${fileName} under ${scopeLabel}: ${matches
        .map((file) => file.id)
        .join(', ')}. Give the file ID, name a deeper folder, or set includeSubfolders to false.`
    )
  }
  return matches[0].id
}

export async function executeFileManageOperation(
  body: FileManageOperationInput,
  context: FileManageOperationContext
): Promise<Response> {
  const { attributedUserId: userId, headers, principal, requestId, signal, workspaceId } = context
  signal?.throwIfAborted()
  if (body.workspaceId && body.workspaceId !== workspaceId) {
    return Response.json({ success: false, error: 'Workspace access denied' }, { status: 403 })
  }
  const includePrivateContentProvenance =
    body.operation === 'content' &&
    requestsPrivateToolMetadata(headers, RESOLVED_SECRET_PROVENANCE_METADATA_V1)
  const contentResponse = (
    responseBody: Record<string, unknown>,
    init?: ResponseInit,
    provenance?: ResolvedSecretTraceProvenanceV1
  ) => fileContentJsonResponse(responseBody, includePrivateContentProvenance, init, provenance)

  try {
    switch (body.operation) {
      case 'get': {
        const { fileId, fileInput } = body
        const selectedFileId =
          fileId ||
          (isRecordLike(fileInput)
            ? (() => {
                const obj = fileInput as Record<string, unknown>
                return typeof obj.id === 'string'
                  ? obj.id
                  : typeof obj.fileId === 'string'
                    ? obj.fileId
                    : ''
              })()
            : '')

        if (!selectedFileId) {
          return Response.json({ success: false, error: 'File is required' }, { status: 400 })
        }

        let file: Awaited<ReturnType<typeof getWorkspaceFile>>
        try {
          file = (
            await readWorkspaceFileMetadata.execute({
              principal,
              input: { fileId: selectedFileId, assertedWorkspaceId: workspaceId },
            })
          ).file
        } catch (error) {
          if (error instanceof OrchestrationError && error.code === 'not_found') {
            return Response.json(
              { success: false, error: `File not found: "${selectedFileId}"` },
              { status: 404 }
            )
          }
          throw error
        }

        logger.info('File retrieved', {
          fileId: file.id,
          name: file.name,
        })

        return Response.json({
          success: true,
          data: {
            file: workspaceFileToUserFile(file),
          },
        })
      }

      case 'read': {
        const { fileId, fileInput, folderPaths, includeSubfolders } = body
        const explicitFileIds = resolveSelectedFileIds(fileId, fileInput)
        const selectedInputFiles = fileId ? [] : extractUserFilesFromInput(fileInput)

        assertFileSelectionLimit(
          explicitFileIds.length + selectedInputFiles.length,
          MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS,
          `File selection contains more than ${MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS} files`
        )

        signal?.throwIfAborted()
        const files = await loadSelectedWorkspaceFileMetadata({
          principal,
          workspaceId,
          fileIds: explicitFileIds,
          folderPaths,
          includeSubfolders,
        })

        if (files.length === 0 && selectedInputFiles.length === 0) {
          return Response.json({ success: false, error: 'File is required' }, { status: 400 })
        }
        if (files.length + selectedInputFiles.length > MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS) {
          throw new OrchestrationError(
            'payload_too_large',
            `File selection contains more than ${MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS} files`
          )
        }

        const { shares } = await getWorkspaceFileShares.execute({
          principal,
          input: { workspaceId, fileIds: files.map((file) => file.id) },
        })
        const privateReadShare = () => ({
          visibility: 'private' as const,
          url: null,
          allowedEmails: [] as string[],
        })
        const toReadShare = (fileId: string) => {
          const share = shares.get(fileId)
          if (!share || !share.isActive) return privateReadShare()
          return {
            visibility: share.authType,
            url: share.url,
            allowedEmails: share.allowedEmails,
          }
        }
        const canonicalUserFiles = files
          .map((file) => workspaceFileToUserFile(file))
          .filter((file): file is NonNullable<ReturnType<typeof workspaceFileToUserFile>> =>
            Boolean(file)
          )
          .map((file) => ({ ...file, share: toReadShare(file.id) }))
        const userFiles = [
          ...canonicalUserFiles,
          ...selectedInputFiles.map((file) => ({ ...file, share: privateReadShare() })),
        ]

        logger.info('Files retrieved', {
          count: userFiles.length,
          fileIds: userFiles.map((file) => file.id),
        })

        return Response.json({
          success: true,
          data: {
            file: userFiles[0],
            files: userFiles,
          },
        })
      }

      case 'content': {
        const { fileId, fileInput, folderPaths, includeSubfolders } = body
        const explicitFileIds = resolveSelectedFileIds(fileId, fileInput)
        const selectedInputFiles = fileId ? [] : extractUserFilesFromInput(fileInput)

        assertFileSelectionLimit(
          explicitFileIds.length + selectedInputFiles.length,
          MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS,
          `File selection contains more than ${MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS} files`
        )

        signal?.throwIfAborted()
        const workspaceFiles = await loadSelectedWorkspaceFileMetadata({
          principal,
          workspaceId,
          fileIds: explicitFileIds,
          folderPaths,
          includeSubfolders,
        })

        if (workspaceFiles.length === 0 && selectedInputFiles.length === 0) {
          return contentResponse({ success: false, error: 'File is required' }, { status: 400 })
        }
        if (
          workspaceFiles.length + selectedInputFiles.length >
          MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS
        ) {
          throw new OrchestrationError(
            'payload_too_large',
            `File selection contains more than ${MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS} files`
          )
        }

        const canonicalSources: FileContentSource[] = workspaceFiles.flatMap((file) => {
          const userFile = workspaceFileToUserFile(file)
          if (!file || !userFile) return []
          return [
            {
              file: userFile,
              identity: {
                fileId: file.id,
                key: file.key,
                context: 'workspace',
                contentUpdatedAt: file.contentUpdatedAt ?? undefined,
              },
              ownerUserId: file.uploadedBy,
            },
          ]
        })
        const selectedSources = await Promise.all(
          selectedInputFiles.map((file) => bindSelectedContentFile(principal, workspaceId, file))
        )
        const sources = canonicalSources.concat(selectedSources)

        const contents: string[] = []
        const lineRanges: FileContentLineRange[] = []
        let totalBytes = 0
        for (const source of sources) {
          signal?.throwIfAborted()
          const denied = source.identity
            ? null
            : await assertOperationFileAccess(source.file, context)
          if (denied) {
            const deniedBody = (await denied.clone().json()) as Record<string, unknown>
            return contentResponse(deniedBody, {
              status: denied.status,
              statusText: denied.statusText,
              headers: denied.headers,
            })
          }

          const extracted = await extractUserFileTextContent(source.file, requestId)
          const { text: content, range } = sliceTextLines(
            extracted.text,
            body.offset,
            body.limit,
            extracted.truncated
          )
          if (range) lineRanges.push(range)
          totalBytes += Buffer.byteLength(content, 'utf8')
          if (totalBytes > MAX_GET_CONTENT_TOTAL_BYTES) {
            return contentResponse(
              {
                success: false,
                error: `Combined file content is too large to return safely. Maximum is ${
                  MAX_GET_CONTENT_TOTAL_BYTES / (1024 * 1024)
                } MB.`,
              },
              { status: 413 }
            )
          }
          contents.push(content)
        }

        logger.info('File content extracted', { count: contents.length })
        const provenance = includePrivateContentProvenance
          ? await getFileContentProvenance(principal, workspaceId, sources, signal)
          : undefined

        return contentResponse(
          {
            success: true,
            data: { contents, ...(lineRanges.length > 0 ? { lineRanges } : {}) },
          },
          undefined,
          provenance
        )
      }

      case 'write': {
        const { fileName, content, fileInput, contentType, overwrite, folderPath } = body
        signal?.throwIfAborted()
        const provenanceResolution = resolveFileWriteSecretProvenance({
          headers,
          payload: body,
          userId,
          workspaceId,
        })
        if (!provenanceResolution.success) {
          return Response.json(
            { success: false, error: provenanceResolution.error },
            { status: 400 }
          )
        }

        // Storing an existing file object rather than text: read its bytes under
        // the caller's own authorization, then write them unchanged. Base64 so a
        // binary payload survives — decoding it as UTF-8 would corrupt it.
        let sourceEncoding: 'utf-8' | 'base64' = 'utf-8'
        let sourceContent = content ?? ''
        let sourceName = fileName
        let sourceContentType = contentType
        /**
         * Copying bytes carries the source's secret lineage, exactly as archiving
         * does. Without this the copy would land with no provenance row — the
         * "safe" state — and a file the platform had locked as secret-derived
         * would be readable again under its new id.
         *
         * A source with no workspace row resolves to `unknown` rather than empty,
         * because nothing durable records what went into it.
         */
        let inputProvenance: WorkspaceFileSecretProvenance | undefined
        if (fileInput !== undefined && fileInput !== null) {
          /**
           * Two shapes reach here and only one already identifies a file. A block
           * reference, or an id the tool layer resolved through the execution
           * index or workspace metadata, arrives carrying `id`/`key`/`url`/`name`.
           * The file picker instead stores `{name, path, key, size, type}` with no
           * `id` or `url`, which the shared normalizer turns into one — the same
           * conversion every other operation in this file applies to its input.
           *
           * Identity is all that is demanded, deliberately. `size` is never read
           * before the download and the download reports the real content type, so
           * requiring them would reject an otherwise usable reference over two
           * fields nothing depends on.
           */
          const sourceFile: UserFile | null = isUserFile(fileInput)
            ? {
                ...fileInput,
                size: fileInput.size ?? 0,
                type: fileInput.type ?? 'application/octet-stream',
              }
            : fileInputToUserFile(fileInput)
          if (!sourceFile) {
            return Response.json(
              { success: false, error: 'fileInput must be a file object' },
              { status: 400 }
            )
          }
          const denied = await assertOperationFileAccess(sourceFile, context)
          if (denied) return denied

          inputProvenance = await deriveWorkspaceFileSecretProvenance({
            principal,
            workspaceId,
            targetOwnerUserId: userId,
            sources: [await bindSelectedContentFile(principal, workspaceId, sourceFile)],
          })

          const downloaded = await downloadServableFileFromStorage(sourceFile, requestId, logger, {
            maxBytes: MAX_WRITE_FILE_INPUT_BYTES,
            signal,
            // A generated document that references other files needs a principal
            // to resolve them; without one the resolver can only serve an
            // already-published artifact and throws when there is none.
            filePrincipal: principal,
          })
          sourceEncoding = 'base64'
          sourceContent = downloaded.buffer.toString('base64')
          sourceName = fileName?.trim() || sourceFile.name
          sourceContentType = contentType || downloaded.contentType || sourceFile.type
        }
        const writeProvenanceSources = [
          provenanceResolution.contentProvenance,
          inputProvenance,
        ].filter((entry): entry is WorkspaceFileSecretProvenance => entry !== undefined)
        // Left undefined when neither side recorded anything, so a plain text
        // write still stores no provenance row rather than an empty one.
        const writeProvenance = writeProvenanceSources.length
          ? mergeWorkspaceFileSecretProvenance(...writeProvenanceSources)
          : undefined

        const { folderSegments: nameSegments, leafName } = splitWorkspaceFilePath(sourceName ?? '')
        /*
         * The destination is the picked folder, then whatever folders the name
         * itself spells. `folderPath` is canonical and percent-encoded, so it is
         * decoded to names here — the same names `splitWorkspaceFilePath` yields
         * — because the folder operation takes decoded segments.
         */
        const folderSegments = folderPath
          ? [...parseFolderPath(folderPath), ...nameSegments]
          : nameSegments
        await admitCreateWorkspaceFile(principal, workspaceId)
        const { folderId } = await ensureWorkspaceFileFolderPathOperation.execute({
          principal,
          input: { workspaceId, pathSegments: folderSegments },
        })
        const mimeType = sourceContentType || getMimeTypeFromExtension(getFileExtension(leafName))

        if (overwrite) {
          const existing = await resolveWriteOverwriteTarget({
            principal,
            workspaceId,
            folderId: folderId ?? null,
            folderPath,
            folderSegments,
            leafName,
          })
          if (existing) {
            // Writing into a file someone else owns must not hand its owner an
            // exact, re-resolvable secret lineage, exactly as appending does.
            const overwriteProvenance =
              writeProvenance?.status === 'exact' &&
              writeProvenance.entries.length > 0 &&
              existing.uploadedBy !== userId
                ? { status: 'unknown' as const }
                : writeProvenance
            const { file: overwritten } = await updateWorkspaceFileContent.execute({
              principal,
              input: {
                fileId: existing.id,
                assertedWorkspaceId: workspaceId,
                content: sourceContent,
                encoding: sourceEncoding,
                contentType: mimeType,
                provenanceMode: 'replace_empty',
                expectedUpdatedAt: existing.contentUpdatedAt ?? undefined,
                ...(overwriteProvenance ? { secretProvenance: overwriteProvenance } : {}),
              },
            })

            logger.info('File overwritten', {
              fileId: overwritten.id,
              name: overwritten.name,
              size: overwritten.size,
            })

            return Response.json({
              success: true,
              data: {
                id: overwritten.id,
                name: overwritten.name,
                size: overwritten.size,
                url: ensureAbsoluteUrl(overwritten.url ?? overwritten.path),
              },
            })
          }
        }

        const result = await createWorkspaceFile.execute({
          principal,
          input: {
            workspaceId,
            name: leafName,
            contentType: mimeType,
            content: sourceContent,
            encoding: sourceEncoding,
            folderId,
            // An overwrite that found no target must land on the exact path or fail. Suffixing
            // would silently satisfy the request at the wrong name when a concurrent write
            // created that path in between; exactName surfaces the race as a conflict instead.
            exactName: Boolean(overwrite),
            ...(writeProvenance ? { secretProvenance: writeProvenance } : {}),
          },
        })
        const fileBuffer = Buffer.from(sourceContent, sourceEncoding)

        logger.info('File created', {
          fileId: result.file.id,
          name: sourceName,
          size: fileBuffer.length,
        })

        return Response.json({
          success: true,
          data: {
            id: result.file.id,
            name: result.file.name,
            size: fileBuffer.length,
            url: ensureAbsoluteUrl(result.file.url ?? result.file.path),
          },
        })
      }

      case 'move': {
        const { fileId, folderPath, targetFolder } = body
        signal?.throwIfAborted()
        /*
         * `folderPath` is already canonical, so it is taken as-is. `targetFolder`
         * is decoded segments joined by `/`, which cannot express a folder whose
         * own name contains a slash — hence the newer field, and hence it wins.
         */
        let targetFolderPath: string
        if (folderPath) {
          targetFolderPath = folderPath
        } else {
          const pathSegments = targetFolder.trim()
            ? targetFolder
                .trim()
                .split('/')
                .map((s) => s.trim())
                .filter(Boolean)
            : []
          try {
            targetFolderPath = buildFolderPath(pathSegments)
          } catch (error) {
            throw new OrchestrationError('validation', getErrorMessage(error))
          }
        }
        await moveWorkspaceFileItemsOperation.execute({
          principal,
          input: {
            workspaceId,
            fileIds: [fileId],
            targetFolderPath,
          },
        })
        logger.info('File moved', { fileId, targetFolderPath })
        return Response.json({
          success: true,
          data: { fileId, folderPath: targetFolderPath, targetFolder: targetFolder || '(root)' },
        })
      }

      case 'manage_sharing': {
        const { fileId, fileInput, isActive, authType, password, allowedEmails } = body
        signal?.throwIfAborted()

        // Resolve the canonical file id. The basic file picker provides an object
        // with a storage `key` but no id, so map the key to the workspace file row.
        let resolvedFileId = typeof fileId === 'string' ? fileId : undefined
        if (!resolvedFileId && fileInput) {
          const single = Array.isArray(fileInput) ? fileInput[0] : fileInput
          if (single && typeof single === 'object') {
            const record = single as Record<string, unknown>
            if (typeof record.id === 'string' && record.id) resolvedFileId = record.id
            else if (typeof record.fileId === 'string' && record.fileId)
              resolvedFileId = record.fileId
            else if (typeof record.key === 'string' && record.key) {
              resolvedFileId = (
                await resolveWorkspaceFileReference({
                  principal,
                  operation: fileOperations.updateShare,
                  workspaceId,
                  reference: record.key,
                })
              ).id
            }
          }
        }
        if (!resolvedFileId) {
          return Response.json(
            { success: false, error: 'A valid file is required to manage sharing' },
            { status: 400 }
          )
        }

        const share = (
          await updateWorkspaceFileShare.execute({
            principal,
            input: {
              fileId: resolvedFileId,
              assertedWorkspaceId: workspaceId,
              isActive,
              authType,
              password,
              allowedEmails,
            },
          })
        ).share

        logger.info('File sharing updated', {
          fileId: resolvedFileId,
          isActive,
          authType: share.authType,
        })

        // A disabled link doesn't resolve, so don't hand back a dead URL.
        const responseShare = share.isActive ? share : { ...share, url: '' }
        return Response.json({ success: true, data: { share: responseShare } })
      }

      case 'append': {
        const { fileName, content, folderPath, folderPaths, includeSubfolders } = body
        signal?.throwIfAborted()

        const scopedReference = await resolveScopedFileReference({
          principal,
          workspaceId,
          fileName,
          folderPath,
          folderPaths,
          includeSubfolders,
        })

        const existing = await resolveWorkspaceFileReference({
          principal,
          operation: fileOperations.updateContent,
          workspaceId,
          reference: scopedReference,
        })

        const lockKey = `file-append:${workspaceId}:${existing.id}`
        const lockValue = `${Date.now()}-${generateShortId()}`
        const acquired = await acquireLock(lockKey, lockValue, 30)
        if (!acquired) {
          return Response.json(
            { success: false, error: 'File is busy, please retry' },
            { status: 409 }
          )
        }

        try {
          if (!existing.contentUpdatedAt) {
            throw new Error('File content version is unavailable')
          }
          const { provenance: existingProvenance } =
            await readWorkspaceFileSecretProvenance.execute({
              principal,
              input: { fileId: existing.id, assertedWorkspaceId: workspaceId },
            })
          const appendedResolution = resolveFileMutationSecretProvenance({
            headers,
            payload: body,
            userId,
            workspaceId,
            selectionKeys: ['content'],
          })
          if (!appendedResolution.success) {
            return Response.json(
              { success: false, error: appendedResolution.error },
              { status: 400 }
            )
          }
          const appendedProvenance = appendedResolution.provenanceBySelection?.get('content')
          const secretProvenance =
            appendedProvenance?.status === 'exact' &&
            appendedProvenance.entries.length > 0 &&
            existing.uploadedBy !== userId
              ? { status: 'unknown' as const }
              : appendedProvenance
                ? mergeWorkspaceFileSecretProvenance(existingProvenance, appendedProvenance)
                : undefined
          const { content: existingBuffer } = await readWorkspaceFileContent.execute({
            principal,
            input: {
              fileId: existing.id,
              assertedWorkspaceId: workspaceId,
              maxBytes: MAX_WORKSPACE_FILE_CONTENT_BYTES,
            },
          })
          const finalContent = existingBuffer.toString('utf-8') + content
          const fileBuffer = Buffer.from(finalContent, 'utf-8')
          await updateWorkspaceFileContent.execute({
            principal,
            input: {
              fileId: existing.id,
              assertedWorkspaceId: workspaceId,
              content: finalContent,
              encoding: 'utf-8',
              expectedUpdatedAt: existing.contentUpdatedAt ?? undefined,
              provenanceMode: secretProvenance ? undefined : 'preserve',
              ...(secretProvenance ? { secretProvenance } : {}),
            },
          })

          logger.info('File appended', {
            fileId: existing.id,
            name: existing.name,
            size: fileBuffer.length,
          })

          return Response.json({
            success: true,
            data: {
              id: existing.id,
              name: existing.name,
              size: fileBuffer.length,
              url: ensureAbsoluteUrl(existing.path),
            },
          })
        } finally {
          await releaseLock(lockKey, lockValue)
        }
      }

      case 'edit': {
        const { fileName, folderPath, folderPaths, includeSubfolders } = body
        signal?.throwIfAborted()

        const reference = await resolveScopedFileReference({
          principal,
          workspaceId,
          fileName,
          folderPath,
          folderPaths,
          includeSubfolders,
        })
        const target = await resolveWorkspaceFileReference({
          principal,
          operation: fileOperations.updateContent,
          workspaceId,
          reference,
        })

        /*
         * The new text is caller-supplied and lands inside a file that already
         * carries its own lineage, so the two are merged exactly as append
         * merges them. Without this the edit would store secret-derived text
         * with no provenance row, which is the state the platform reads as
         * "safe".
         */
        const selectionKeys = body.mode === 'delete_between' ? [] : ['content']
        const editResolution = resolveFileMutationSecretProvenance({
          headers,
          payload: body,
          userId,
          workspaceId,
          selectionKeys,
        })
        if (!editResolution.success) {
          return Response.json({ success: false, error: editResolution.error }, { status: 400 })
        }
        const editedProvenance = editResolution.provenanceBySelection?.get('content')
        let secretProvenance: WorkspaceFileSecretProvenance | undefined
        if (editedProvenance) {
          const { provenance: existingProvenance } =
            await readWorkspaceFileSecretProvenance.execute({
              principal,
              input: { fileId: target.id, assertedWorkspaceId: workspaceId },
            })
          secretProvenance =
            editedProvenance.status === 'exact' &&
            editedProvenance.entries.length > 0 &&
            target.uploadedBy !== userId
              ? { status: 'unknown' as const }
              : mergeWorkspaceFileSecretProvenance(existingProvenance, editedProvenance)
        }

        let edit: WorkspaceFileContentEdit
        switch (body.mode) {
          case 'search_replace':
            edit = {
              mode: body.mode,
              search: body.search,
              content: body.content,
              replaceAll: body.replaceAll,
            }
            break
          case 'replace_between':
            edit = {
              mode: body.mode,
              beforeAnchor: body.beforeAnchor,
              afterAnchor: body.afterAnchor,
              content: body.content,
              occurrence: body.occurrence,
            }
            break
          case 'insert_after':
            edit = {
              mode: body.mode,
              anchor: body.anchor,
              content: body.content,
              occurrence: body.occurrence,
            }
            break
          case 'delete_between':
            edit = {
              mode: body.mode,
              startAnchor: body.startAnchor,
              endAnchor: body.endAnchor,
              occurrence: body.occurrence,
            }
            break
        }

        signal?.throwIfAborted()
        const { file, lineCount } = await editWorkspaceFileContent.execute({
          principal,
          input: {
            fileId: target.id,
            assertedWorkspaceId: workspaceId,
            ...(secretProvenance ? { secretProvenance } : {}),
            edit,
          },
        })

        return Response.json({
          success: true,
          data: { id: file.id, name: file.name, size: file.size, lineCount },
        })
      }

      case 'compress': {
        const { fileId, fileInput, archiveName, folderPaths, includeSubfolders } = body
        const selectedFileIds = resolveSelectedFileIds(fileId, fileInput)
        const selectedInputFiles = fileId ? [] : extractUserFilesFromInput(fileInput)

        assertFileSelectionLimit(
          selectedFileIds.length + selectedInputFiles.length,
          MAX_ZIP_DOWNLOAD_FILES,
          `Compress accepts at most ${MAX_ZIP_DOWNLOAD_FILES} files`
        )

        signal?.throwIfAborted()
        for (const id of await expandFolderPathsToFileIds({
          principal,
          workspaceId,
          folderPaths,
          includeSubfolders,
          limit: MAX_ZIP_DOWNLOAD_FILES,
        })) {
          if (!selectedFileIds.includes(id)) selectedFileIds.push(id)
        }

        if (selectedFileIds.length === 0 && selectedInputFiles.length === 0) {
          return Response.json({ success: false, error: 'File is required' }, { status: 400 })
        }
        if (selectedFileIds.length + selectedInputFiles.length > MAX_ZIP_DOWNLOAD_FILES) {
          throw new OrchestrationError(
            'payload_too_large',
            `Compress accepts at most ${MAX_ZIP_DOWNLOAD_FILES} files`
          )
        }
        await admitCreateWorkspaceFile(principal, workspaceId)

        const workspaceFiles = [] as Array<
          NonNullable<Awaited<ReturnType<typeof getWorkspaceFile>>>
        >
        for (const id of selectedFileIds) {
          signal?.throwIfAborted()
          try {
            workspaceFiles.push(
              (
                await downloadWorkspaceFileRecord.execute({
                  principal,
                  input: { fileId: id, assertedWorkspaceId: workspaceId },
                })
              ).file
            )
          } catch (error) {
            if (error instanceof OrchestrationError && error.code === 'not_found') {
              return Response.json(
                { success: false, error: `File not found: "${id}"` },
                { status: 404 }
              )
            }
            throw error
          }
        }

        const workspaceEntries: ArchiveEntry[] = workspaceFiles.flatMap((file) => {
          const userFile = workspaceFileToUserFile(file)
          return userFile ? [{ file: userFile, folderPath: file?.folderPath ?? null }] : []
        })

        // Picker/upload values carry no workspace folder, so they archive at the root.
        const archiveEntries = workspaceEntries.concat(
          selectedInputFiles.map((file) => ({ file, folderPath: null }))
        )
        const userFiles: UserFile[] = archiveEntries.map((entry) => entry.file)
        const canonicalArchiveSources: FileContentSource[] = workspaceFiles.flatMap((file) => {
          const userFile = workspaceFileToUserFile(file)
          if (!file || !userFile) return []
          return [
            {
              file: userFile,
              identity: { fileId: file.id, key: file.key, context: 'workspace' },
              ownerUserId: file.uploadedBy,
            },
          ]
        })
        const selectedArchiveSources = await Promise.all(
          selectedInputFiles.map((file) => bindSelectedContentFile(principal, workspaceId, file))
        )
        const archiveSources = canonicalArchiveSources.concat(selectedArchiveSources)
        const archiveProvenance = await deriveWorkspaceFileSecretProvenance({
          principal,
          workspaceId,
          targetOwnerUserId: userId,
          sources: archiveSources,
        })

        // Mirror the workspace folder layout, dropping the ancestor chain the whole
        // selection shares so archiving one folder does not nest it under its parents.
        const entryPaths = buildZipEntryPaths(
          archiveEntries.map((entry) => ({
            name: entry.file.name,
            folderPath: entry.folderPath,
            contentType: entry.file.type,
          })),
          { rebaseOnCommonFolder: true }
        )

        const zip = new JSZip()
        let totalBytes = 0
        for (const [index, userFile] of userFiles.entries()) {
          signal?.throwIfAborted()
          const denied = archiveSources[index]?.identity
            ? null
            : await assertOperationFileAccess(userFile, context)
          if (denied) return denied

          // Generated docs store their generation source, not the rendered binary, so
          // the archive must carry the servable bytes instead of the raw source text.
          // A still-compiling artifact throws, and the handler's catch turns that into
          // the shared 409 via `docNotReadyResponse`.
          const { buffer } = await downloadServableFileFromStorage(userFile, requestId, logger, {
            maxBytes: MAX_COMPRESS_FILE_BYTES,
          })
          totalBytes += buffer.length
          if (totalBytes > MAX_COMPRESS_TOTAL_BYTES) {
            return Response.json(
              {
                success: false,
                error: `Combined input is too large to compress. Maximum is ${
                  MAX_COMPRESS_TOTAL_BYTES / (1024 * 1024)
                } MB.`,
              },
              { status: 413 }
            )
          }
          zip.file(entryPaths[index], buffer)
        }

        const zipBuffer = await zip.generateAsync({
          type: 'nodebuffer',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 },
        })
        signal?.throwIfAborted()

        const requestedName = typeof archiveName === 'string' ? archiveName.trim() : ''
        const baseName = requestedName
          ? toFlatFileName(requestedName, 'archive')
          : userFiles.length === 1
            ? stripExtension(toFlatFileName(userFiles[0].name, 'archive'))
            : 'archive'
        const leafName = ensureZipExtension(baseName)
        const result = await createWorkspaceFileFromBuffer.execute({
          principal,
          input: {
            workspaceId,
            name: leafName,
            contentType: 'application/zip',
            content: zipBuffer,
            folderId: null,
            exactName: false,
            secretProvenance: archiveProvenance,
          },
        })

        const compressedFile: UserFile = {
          ...result.file,
          url: ensureAbsoluteUrl(result.file.url ?? result.file.path),
          size: zipBuffer.length,
        }

        logger.info('Files compressed', {
          fileId: result.file.id,
          name: result.file.name,
          fileCount: userFiles.length,
          size: zipBuffer.length,
        })

        return Response.json({
          success: true,
          data: {
            id: compressedFile.id,
            name: compressedFile.name,
            size: compressedFile.size,
            url: compressedFile.url,
            files: [compressedFile],
          },
        })
      }

      case 'decompress': {
        const { fileId, fileInput } = body
        const selectedFileIds = fileId ? [fileId] : extractFileIdsFromInput(fileInput)
        const selectedInputFiles = fileId ? [] : extractUserFilesFromInput(fileInput)

        if (selectedFileIds.length === 0 && selectedInputFiles.length === 0) {
          return Response.json({ success: false, error: 'File is required' }, { status: 400 })
        }
        if (selectedFileIds.length + selectedInputFiles.length > 1) {
          return Response.json(
            { success: false, error: 'Decompress accepts a single .zip archive at a time' },
            { status: 400 }
          )
        }
        await admitCreateWorkspaceFile(principal, workspaceId)

        const workspaceFiles = [] as Array<
          NonNullable<Awaited<ReturnType<typeof getWorkspaceFile>>>
        >
        for (const id of selectedFileIds) {
          signal?.throwIfAborted()
          try {
            workspaceFiles.push(
              (
                await downloadWorkspaceFileRecord.execute({
                  principal,
                  input: { fileId: id, assertedWorkspaceId: workspaceId },
                })
              ).file
            )
          } catch (error) {
            if (error instanceof OrchestrationError && error.code === 'not_found') {
              return Response.json(
                { success: false, error: `File not found: "${id}"` },
                { status: 404 }
              )
            }
            throw error
          }
        }

        const archive = [
          ...workspaceFiles
            .map((file) => workspaceFileToUserFile(file))
            .filter((file): file is NonNullable<ReturnType<typeof workspaceFileToUserFile>> =>
              Boolean(file)
            ),
          ...selectedInputFiles,
        ][0]

        if (!archive) {
          return Response.json({ success: false, error: 'File is required' }, { status: 400 })
        }

        const canonicalArchiveSource: FileContentSource[] = workspaceFiles.flatMap((file) => {
          const userFile = workspaceFileToUserFile(file)
          if (!file || !userFile) return []
          return [
            {
              file: userFile,
              identity: { fileId: file.id, key: file.key, context: 'workspace' },
              ownerUserId: file.uploadedBy,
            },
          ]
        })
        const selectedArchiveSource = await Promise.all(
          selectedInputFiles.map((file) => bindSelectedContentFile(principal, workspaceId, file))
        )
        const archiveSource = canonicalArchiveSource.concat(selectedArchiveSource)[0]
        if (!archiveSource?.identity) {
          const denied = await assertOperationFileAccess(archive, context)
          if (denied) return denied
        }
        const archiveProvenance = await deriveWorkspaceFileSecretProvenance({
          principal,
          workspaceId,
          targetOwnerUserId: userId,
          sources: archiveSource ? [archiveSource] : [],
        })

        const archiveBuffer = await downloadFileFromStorage(archive, requestId, logger, {
          maxBytes: MAX_ARCHIVE_BYTES,
        })
        signal?.throwIfAborted()

        let result: DecompressResult
        try {
          result = await decompressArchiveBufferToWorkspaceFiles(archiveBuffer, {
            workspaceId,
            principal,
            secretProvenance: archiveProvenance,
            signal,
          })
        } catch (archiveError) {
          if (archiveError instanceof ArchiveError) {
            // The error message is single-sourced in ArchiveError (caps included);
            // only the HTTP status is mapped here.
            const status = statusForArchiveError(archiveError)
            return Response.json(
              { success: false, error: `"${archive.name}": ${archiveError.message}` },
              { status }
            )
          }
          throw archiveError
        }

        if (result.extracted.length === 0) {
          return Response.json(
            { success: false, error: `No files could be extracted from "${archive.name}".` },
            { status: 422 }
          )
        }

        const extractedFiles = result.extracted.map((file) => ({
          ...file,
          url: ensureAbsoluteUrl(file.url),
        }))

        if (result.skippedUnsafePaths.length > 0) {
          logger.warn('Skipped unsafe archive entries', {
            fileId: archive.id,
            name: archive.name,
            entryNames: result.skippedUnsafePaths,
          })
        }

        logger.info('Archive decompressed', {
          fileId: archive.id,
          name: archive.name,
          extractedCount: extractedFiles.length,
          skippedCount: result.skipped,
        })

        return Response.json({
          success: true,
          data: {
            files: extractedFiles,
          },
        })
      }

      case 'list': {
        /*
         * Listing takes the whole tree rather than asking the folder operation
         * to filter, because the answer mixes folders and files: depth, search
         * and ordering have to be decided over both at once, and two separately
         * filtered queries cannot be interleaved afterwards.
         */
        signal?.throwIfAborted()
        const { folders } = await listWorkspaceFileFoldersOperation.execute({
          principal,
          input: { workspaceId },
        })

        const rootPath = body.path ?? ROOT_FOLDER_PATH
        const projected = folders.map((folder) => ({
          ...toWorkspaceFileFolderPathView(folder),
          id: folder.id,
          parentId: folder.parentId,
        }))

        let rootId: string | null = null
        if (body.path && body.path !== ROOT_FOLDER_PATH) {
          const selection = resolveFolderIdsForPaths(projected, [body.path], {
            includeSubfolders: false,
          })
          if (selection.missingPath !== undefined) {
            throw new OrchestrationError('not_found', `Folder not found: ${selection.missingPath}`)
          }
          rootId = [...selection.folderIds][0] ?? null
        }

        const maxDepth = body.recursive ? (body.depth ?? Number.POSITIVE_INFINITY) : 1
        const limit = body.limit ?? DEFAULT_FILE_LIST_LIMIT
        const folderDepths = collectFolderDepths(projected, rootId, { maxDepth })
        let maxParentDepth = 0
        for (const depth of folderDepths.values()) {
          if (depth < maxDepth) maxParentDepth = Math.max(maxParentDepth, depth)
        }

        const folderListing = selectDirectoryEntries(projected, [], {
          rootId,
          rootPath,
          maxDepth,
          search: body.search,
          limit: projected.length,
        })
        const matchingFolderCountByDepth = new Map<number, number>()
        for (const entry of folderListing.entries) {
          matchingFolderCountByDepth.set(
            entry.depth,
            (matchingFolderCountByDepth.get(entry.depth) ?? 0) + 1
          )
        }

        const files: WorkspaceFileRecord[] = []
        let processedMatchingFolders = 0
        let fileListingTruncated = false

        const queryFileScope = (folderScope: FolderIdScope, pageLimit: number) =>
          queryWorkspaceFilePage.execute({
            principal,
            input: {
              workspaceId,
              folderScope,
              search: body.search,
              sortBy: 'name',
              sortOrder: 'asc',
              limit: pageLimit,
            },
          })

        for (let fileDepth = 1; fileDepth <= maxParentDepth + 1; fileDepth++) {
          processedMatchingFolders += matchingFolderCountByDepth.get(fileDepth) ?? 0
          const parentDepth = fileDepth - 1
          const knownEntryCount = processedMatchingFolders + files.length

          if (knownEntryCount >= limit) {
            fileListingTruncated =
              knownEntryCount > limit || folderListing.entries.length > processedMatchingFolders
            if (!fileListingTruncated) {
              const remainingScope = directoryFileScopeForDepthRange(
                rootId,
                folderDepths,
                parentDepth,
                maxParentDepth
              )
              if (hasDirectoryFileScope(remainingScope)) {
                const remainingPage = await queryFileScope(remainingScope, 1)
                fileListingTruncated = remainingPage.files.length > 0
              }
            }
            break
          }

          const depthScope = directoryFileScopeForDepthRange(
            rootId,
            folderDepths,
            parentDepth,
            parentDepth
          )
          if (!hasDirectoryFileScope(depthScope)) continue

          const filePage = await queryFileScope(depthScope, limit)
          files.push(...filePage.files)

          const populatedEntryCount = processedMatchingFolders + files.length
          if (filePage.nextKeys !== null || populatedEntryCount > limit) {
            fileListingTruncated = true
            break
          }
          if (populatedEntryCount === limit) {
            fileListingTruncated = folderListing.entries.length > processedMatchingFolders
            if (!fileListingTruncated && parentDepth < maxParentDepth) {
              const remainingScope = directoryFileScopeForDepthRange(
                rootId,
                folderDepths,
                parentDepth + 1,
                maxParentDepth
              )
              if (hasDirectoryFileScope(remainingScope)) {
                const remainingPage = await queryFileScope(remainingScope, 1)
                fileListingTruncated = remainingPage.files.length > 0
              }
            }
            break
          }
        }

        const listing = selectDirectoryEntries(
          projected,
          files.map((file) => ({
            id: file.id,
            name: file.name,
            folderId: file.folderId ?? null,
            size: file.size,
            type: file.type,
            updatedAt: file.updatedAt.toISOString(),
          })),
          {
            rootId,
            rootPath,
            maxDepth,
            search: body.search,
            limit,
          }
        )

        return Response.json({
          success: true,
          data: {
            path: rootPath,
            entries: listing.entries,
            truncated: listing.truncated || fileListingTruncated,
          },
        })
      }

      case 'create_folder': {
        signal?.throwIfAborted()
        const { folder } = await createWorkspaceFileFolderOperation.execute({
          principal,
          input: { workspaceId, path: body.path },
        })
        return Response.json({
          success: true,
          data: { folder: toWorkspaceFileFolderPathView(folder) },
        })
      }

      case 'update_folder': {
        signal?.throwIfAborted()
        const { folder } = await updateWorkspaceFileFolderOperation.execute({
          principal,
          input: { workspaceId, path: body.path, destinationPath: body.destinationPath },
        })
        return Response.json({
          success: true,
          data: { folder: toWorkspaceFileFolderPathView(folder), previousPath: body.path },
        })
      }

      case 'delete_folder': {
        signal?.throwIfAborted()
        const { deletedItems, path } = await deleteWorkspaceFileFolderOperation.execute({
          principal,
          input: { workspaceId, path: body.path, recursive: body.recursive },
        })
        return Response.json({
          success: true,
          data: { path: path ?? body.path, deleted: true, deletedItems },
        })
      }

      case 'restore_folder': {
        signal?.throwIfAborted()
        const { folder, restoredItems } = await restoreWorkspaceFileFolderOperation.execute({
          principal,
          input: { workspaceId, folderId: body.folderId },
        })
        return Response.json({
          success: true,
          data: { folder: toWorkspaceFileFolderPathView(folder), restoredItems },
        })
      }
    }
  } catch (error) {
    if (isWorkspaceAccessDeniedError(error)) {
      return contentResponse({ success: false, error: 'Workspace access denied' }, { status: 403 })
    }
    if (error instanceof OrchestrationError) {
      const status =
        error.code === 'forbidden'
          ? 403
          : error.code === 'not_found'
            ? 404
            : error.code === 'conflict'
              ? 409
              : error.code === 'payload_too_large'
                ? 413
                : error.code === 'validation'
                  ? 400
                  : /* Lock contention is retryable, so it must not read as a server fault. */
                    error.code === 'locked'
                    ? 423
                    : 500
      return contentResponse({ success: false, error: error.message }, { status })
    }
    const notReady = docNotReadyResponse(error)
    if (notReady) {
      if (!includePrivateContentProvenance) return notReady
      const notReadyBody = (await notReady.clone().json()) as Record<string, unknown>
      return contentResponse(notReadyBody, {
        status: notReady.status,
        statusText: notReady.statusText,
        headers: notReady.headers,
      })
    }
    // A file over its per-file cap is a size rejection, not a fault. Rendered
    // documents can cross it even when the stored source was well under.
    if (isPayloadSizeLimitError(error)) {
      return contentResponse({ success: false, error: error.message }, { status: 413 })
    }
    if (error instanceof ShareValidationError) {
      return contentResponse({ success: false, error: error.message }, { status: 400 })
    }
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('File operation failed', { operation: body.operation, error: message })
    return contentResponse({ success: false, error: message }, { status: 500 })
  }
}
