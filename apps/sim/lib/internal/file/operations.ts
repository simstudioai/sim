import { Buffer, isUtf8 } from 'buffer'
import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import JSZip from 'jszip'
import type { ContractBody } from '@/lib/api/contracts'
import type { fileManageContract } from '@/lib/api/contracts/tools/file'
import { splitWorkspaceFilePath } from '@/lib/copilot/tools/server/files/workspace-file'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { ensureAbsoluteUrl } from '@/lib/core/utils/urls'
import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
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
import { buildFolderPath } from '@/lib/folders/paths'
import { ShareValidationError } from '@/lib/public-shares/share-manager'
import {
  ArchiveError,
  type DecompressResult,
  decompressArchiveBufferToWorkspaceFiles,
  MAX_ARCHIVE_BYTES,
  statusForArchiveError,
} from '@/lib/uploads/archive'
import type { getWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  mergeWorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenanceIdentity,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  getFileExtension,
  getMimeTypeFromExtension,
  inferContextFromKey,
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
import { moveWorkspaceFileItemsOperation } from '@/lib/workspace-files/application/move-workspace-file-items'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
import { readWorkspaceFileMetadata } from '@/lib/workspace-files/application/read-workspace-file-metadata'
import { downloadWorkspaceFileRecord } from '@/lib/workspace-files/application/read-workspace-file-record'
import { readWorkspaceFileSecretProvenance } from '@/lib/workspace-files/application/read-workspace-file-secret-provenance'
import { resolveWorkspaceFileReference } from '@/lib/workspace-files/application/resolve-workspace-file-reference'
import {
  getWorkspaceFileShare,
  updateWorkspaceFileShare,
} from '@/lib/workspace-files/application/share-workspace-file'
import { updateWorkspaceFileContent } from '@/lib/workspace-files/application/update-workspace-file-content'
import { ensureWorkspaceFileFolderPathOperation } from '@/lib/workspace-files/application/workspace-file-folders'
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
    context: inferContextFromKey(key),
  }
}

const normalizeFileIdList = (value: unknown): string[] => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []

    try {
      return normalizeFileIdList(JSON.parse(trimmed))
    } catch {
      return [trimmed]
    }
  }

  if (!Array.isArray(value)) return []

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((id) => id.length > 0)
}

const extractUserFilesFromInput = (fileInput: unknown) => {
  const inputs = Array.isArray(fileInput) ? fileInput : fileInput ? [fileInput] : []
  return inputs
    .map((input) => fileInputToUserFile(input))
    .filter((file): file is NonNullable<ReturnType<typeof fileInputToUserFile>> => Boolean(file))
}

const extractFileIdsFromInput = (fileInput: unknown): string[] => {
  const inputs = Array.isArray(fileInput) ? fileInput : fileInput ? [fileInput] : []

  return inputs
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
  const leaf = name.replace(/\\/g, '/').split('/').pop()?.trim()
  if (!leaf || leaf === '.' || leaf === '..') return fallback
  return leaf
}

/** A file bound for a compress archive, paired with the workspace folder it lives in. */
interface ArchiveEntry {
  file: UserFile
  folderPath: string | null
}

const isLikelyTextBuffer = (buffer: Buffer): boolean => isUtf8(buffer) && !buffer.includes(0)

/**
 * Download a stored file and extract its text content. Parseable types (PDF, DOCX,
 * CSV, etc.) go through the shared file-parsers; other UTF-8 files are returned as
 * raw text; binary files yield a short placeholder rather than corrupt bytes.
 */
const extractUserFileTextContent = async (
  userFile: UserFile,
  requestId: string
): Promise<string> => {
  const { buffer } = await downloadServableFileFromStorage(userFile, requestId, logger, {
    maxBytes: MAX_GET_CONTENT_FILE_BYTES,
  })

  const extension = getFileExtension(userFile.name)
  if (extension && isSupportedFileType(extension)) {
    try {
      const result = await parseBuffer(buffer, extension)
      return result.content ?? ''
    } catch (error) {
      logger.warn('Falling back to raw text after parser failure', {
        name: userFile.name,
        error: getErrorMessage(error, 'Unknown error'),
      })
    }
  }

  if (isLikelyTextBuffer(buffer)) {
    return buffer.toString('utf-8')
  }

  return `[Binary file: ${userFile.name} (${userFile.type || 'application/octet-stream'}, ${buffer.length} bytes). Cannot extract text content.]`
}

interface FileContentSource {
  file: UserFile
  identity?: WorkspaceFileSecretProvenanceIdentity
  ownerUserId?: string
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
    identity: { fileId: metadata.id, key: metadata.key, context: 'workspace' },
    ownerUserId: metadata.uploadedBy,
  }
}

async function getFileContentProvenance(
  principal: Principal,
  workspaceId: string,
  sources: readonly FileContentSource[]
): Promise<ResolvedSecretTraceProvenanceV1> {
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
    if (!source.identity || !source.ownerUserId) {
      accumulator.markIncomplete('file-source-unidentified')
      continue
    }
    const { provenance } = await readWorkspaceFileSecretProvenance.execute({
      principal,
      input: { fileId: source.identity.fileId, assertedWorkspaceId: workspaceId },
    })
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

function fileContentJsonResponse(
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
        const { fileId, fileInput } = body
        const selectedFileIds = Array.isArray(fileId)
          ? fileId.map((id) => id.trim()).filter(Boolean)
          : fileId
            ? normalizeFileIdList(fileId)
            : extractFileIdsFromInput(fileInput)
        const selectedInputFiles = fileId ? [] : extractUserFilesFromInput(fileInput)

        if (selectedFileIds.length === 0 && selectedInputFiles.length === 0) {
          return Response.json({ success: false, error: 'File is required' }, { status: 400 })
        }

        const files = [] as Array<NonNullable<Awaited<ReturnType<typeof getWorkspaceFile>>>>
        for (const id of selectedFileIds) {
          signal?.throwIfAborted()
          try {
            files.push(
              (
                await readWorkspaceFileMetadata.execute({
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

        const shares = new Map(
          await Promise.all(
            files.map(
              async (file) =>
                [
                  file.id,
                  (
                    await getWorkspaceFileShare.execute({
                      principal,
                      input: { fileId: file.id, assertedWorkspaceId: workspaceId },
                    })
                  ).share,
                ] as const
            )
          )
        )
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
        const { fileId, fileInput } = body
        const selectedFileIds = Array.isArray(fileId)
          ? fileId.map((id) => id.trim()).filter(Boolean)
          : fileId
            ? normalizeFileIdList(fileId)
            : extractFileIdsFromInput(fileInput)
        const selectedInputFiles = fileId ? [] : extractUserFilesFromInput(fileInput)

        if (selectedFileIds.length === 0 && selectedInputFiles.length === 0) {
          return contentResponse({ success: false, error: 'File is required' }, { status: 400 })
        }

        const workspaceFiles = [] as Array<
          NonNullable<Awaited<ReturnType<typeof getWorkspaceFile>>>
        >
        for (const id of selectedFileIds) {
          signal?.throwIfAborted()
          try {
            workspaceFiles.push(
              (
                await readWorkspaceFileMetadata.execute({
                  principal,
                  input: { fileId: id, assertedWorkspaceId: workspaceId },
                })
              ).file
            )
          } catch (error) {
            if (error instanceof OrchestrationError && error.code === 'not_found') {
              return contentResponse(
                { success: false, error: `File not found: "${id}"` },
                { status: 404 }
              )
            }
            throw error
          }
        }

        const canonicalSources: FileContentSource[] = workspaceFiles.flatMap((file) => {
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
        const selectedSources = await Promise.all(
          selectedInputFiles.map((file) => bindSelectedContentFile(principal, workspaceId, file))
        )
        const sources = canonicalSources.concat(selectedSources)

        const contents: string[] = []
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

          const content = await extractUserFileTextContent(source.file, requestId)
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
          ? await getFileContentProvenance(principal, workspaceId, sources)
          : undefined

        return contentResponse({ success: true, data: { contents } }, undefined, provenance)
      }

      case 'write': {
        const { fileName, content, fileInput, contentType } = body
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
          if (!isUserFileWithMetadata(fileInput)) {
            return Response.json(
              { success: false, error: 'fileInput must be a file object' },
              { status: 400 }
            )
          }
          const sourceFile: UserFile = fileInput
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

        const { folderSegments, leafName } = splitWorkspaceFilePath(sourceName ?? '')
        await admitCreateWorkspaceFile(principal, workspaceId)
        const { folderId } = await ensureWorkspaceFileFolderPathOperation.execute({
          principal,
          input: { workspaceId, pathSegments: folderSegments },
        })
        const mimeType = sourceContentType || getMimeTypeFromExtension(getFileExtension(leafName))
        const result = await createWorkspaceFile.execute({
          principal,
          input: {
            workspaceId,
            name: leafName,
            contentType: mimeType,
            content: sourceContent,
            encoding: sourceEncoding,
            folderId,
            exactName: false,
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
        const { fileId, targetFolder } = body
        signal?.throwIfAborted()
        const pathSegments = targetFolder.trim()
          ? targetFolder
              .trim()
              .split('/')
              .map((s) => s.trim())
              .filter(Boolean)
          : []
        let targetFolderPath: string
        try {
          targetFolderPath = buildFolderPath(pathSegments)
        } catch (error) {
          throw new OrchestrationError('validation', getErrorMessage(error))
        }
        await moveWorkspaceFileItemsOperation.execute({
          principal,
          input: {
            workspaceId,
            fileIds: [fileId],
            targetFolderPath,
          },
        })
        logger.info('File moved', { fileId, targetFolder: targetFolder || '(root)' })
        return Response.json({
          success: true,
          data: { fileId, targetFolder: targetFolder || '(root)' },
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
        const { fileName, content } = body
        signal?.throwIfAborted()

        const existing = await resolveWorkspaceFileReference({
          principal,
          operation: fileOperations.updateContent,
          workspaceId,
          reference: fileName,
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

      case 'compress': {
        const { fileId, fileInput, archiveName } = body
        const selectedFileIds = Array.isArray(fileId)
          ? fileId.map((id) => id.trim()).filter(Boolean)
          : fileId
            ? normalizeFileIdList(fileId)
            : extractFileIdsFromInput(fileInput)
        const selectedInputFiles = fileId ? [] : extractUserFilesFromInput(fileInput)

        if (selectedFileIds.length === 0 && selectedInputFiles.length === 0) {
          return Response.json({ success: false, error: 'File is required' }, { status: 400 })
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
          archiveEntries.map((entry) => ({ name: entry.file.name, folderPath: entry.folderPath })),
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
