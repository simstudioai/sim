import { Buffer, isUtf8 } from 'buffer'
import type { Readable } from 'stream'
import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import JSZip from 'jszip'
import { type NextRequest, NextResponse } from 'next/server'
import { fileManageContract } from '@/lib/api/contracts/tools/file'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { splitWorkspaceFilePath } from '@/lib/copilot/tools/server/files/workspace-file'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { generateRequestId } from '@/lib/core/utils/request'
import { ensureAbsoluteUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { isSupportedFileType, parseBuffer } from '@/lib/file-parsers'
import {
  getShareForResource,
  ShareValidationError,
  upsertFileShare,
} from '@/lib/public-shares/share-manager'
import { ensureWorkspaceFileFolderPath } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  resolveWorkspaceFileReference,
  updateWorkspaceFileContent,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { performMoveWorkspaceFileItems } from '@/lib/workspace-files/orchestration'
import {
  assertActiveWorkspaceAccess,
  getUserEntityPermissions,
  isWorkspaceAccessDeniedError,
} from '@/lib/workspaces/permissions/utils'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import {
  PublicFileSharingNotAllowedError,
  validatePublicFileSharing,
} from '@/ee/access-control/utils/permission-check'
import type { UserFile } from '@/executor/types'

export const dynamic = 'force-dynamic'

const logger = createLogger('FileManageAPI')

const workspaceFileToUserFile = (file: Awaited<ReturnType<typeof getWorkspaceFile>>) => {
  if (!file) return null

  return {
    id: file.id,
    name: file.name,
    url: ensureAbsoluteUrl(file.path),
    size: file.size,
    type: file.type,
    key: file.key,
    context: 'workspace',
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
    context: 'workspace',
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
 * result would be empty or a dot segment. Used for zip entry names and the
 * compress archive name so untrusted input cannot introduce nested or
 * zip-slip-style paths.
 */
const toFlatFileName = (name: string, fallback: string): string => {
  const leaf = name.replace(/\\/g, '/').split('/').pop()?.trim()
  if (!leaf || leaf === '.' || leaf === '..') return fallback
  return leaf
}

/**
 * Return a zip entry name unique within `usedNames`, appending a numeric suffix
 * before the extension on collision (e.g., "data.csv" -> "data (1).csv").
 */
const uniqueZipEntryName = (name: string, usedNames: Set<string>): string => {
  if (!usedNames.has(name)) {
    usedNames.add(name)
    return name
  }

  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let counter = 1
  let candidate = `${base} (${counter})${ext}`
  while (usedNames.has(candidate)) {
    counter += 1
    candidate = `${base} (${counter})${ext}`
  }
  usedNames.add(candidate)
  return candidate
}

/** Input archive download cap for the decompress operation. */
const MAX_DECOMPRESS_ARCHIVE_BYTES = 100 * 1024 * 1024
/** Maximum number of entries extracted from a single archive. */
const MAX_DECOMPRESS_ENTRIES = 1000
/** Maximum uncompressed size for any single archive entry. */
const MAX_DECOMPRESS_ENTRY_BYTES = 100 * 1024 * 1024
/** Maximum total uncompressed size across all entries, to bound zip-bomb expansion. */
const MAX_DECOMPRESS_TOTAL_BYTES = 200 * 1024 * 1024

const S_IFMT = 0o170000
const S_IFLNK = 0o120000

/**
 * Read a zip entry's declared uncompressed size without materializing it. This
 * value comes straight from the (attacker-controlled) ZIP metadata, so it is only
 * usable as a cheap fast-reject for honestly-declared archives — never as the
 * authoritative cap. {@link inflateEntryWithinCaps} enforces the real limit on the
 * inflated byte stream.
 */
const readEntryUncompressedSize = (entry: JSZip.JSZipObject): number | undefined => {
  const data = (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data
  const size = data?.uncompressedSize
  return typeof size === 'number' && Number.isFinite(size) ? size : undefined
}

type InflateResult = { ok: true; buffer: Buffer } | { ok: false; reason: 'entry' | 'total' }

/**
 * Inflate a single zip entry through a streaming counting sink, tearing the
 * stream down the moment cumulative output would exceed the per-entry cap or the
 * remaining total budget. The declared uncompressed size in the ZIP header is
 * attacker-controlled and is NOT trusted here: a forged-small or absent size
 * cannot cause the full (potentially gigabyte-scale) entry to be materialized in
 * memory, because enforcement happens on the actual inflated bytes as they
 * arrive. Peak memory is bounded by the cap plus one DEFLATE chunk.
 */
const inflateEntryWithinCaps = (
  entry: JSZip.JSZipObject,
  remainingTotalBudget: number
): Promise<InflateResult> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const stream = entry.nodeStream() as Readable

    const settle = (result: InflateResult) => {
      if (settled) return
      settled = true
      stream.destroy()
      resolve(result)
    }

    stream.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_DECOMPRESS_ENTRY_BYTES) {
        settle({ ok: false, reason: 'entry' })
        return
      }
      if (size > remainingTotalBudget) {
        settle({ ok: false, reason: 'total' })
        return
      }
      chunks.push(chunk)
    })
    stream.on('end', () => settle({ ok: true, buffer: Buffer.concat(chunks, size) }))
    stream.on('error', (error) => {
      if (settled) return
      settled = true
      stream.destroy()
      reject(error)
    })
  })

/** True when a zip entry's unix mode marks it as a symlink (never extracted). */
const isSymlinkEntry = (entry: JSZip.JSZipObject): boolean => {
  const mode = (entry as JSZip.JSZipObject & { unixPermissions?: number | null }).unixPermissions
  return typeof mode === 'number' && (mode & S_IFMT) === S_IFLNK
}

/**
 * Normalize a zip entry path into safe workspace folder segments, guarding against
 * zip-slip. Returns null for traversal (`..`), so the entry is skipped rather than
 * written outside its intended location.
 */
const sanitizeArchiveEntryPath = (rawPath: string): string[] | null => {
  const segments = rawPath
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.')

  if (segments.length === 0 || segments.includes('..')) return null
  return segments
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
  const buffer = await downloadFileFromStorage(userFile, requestId, logger, {
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

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success) {
    return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
  }

  const parsed = await parseRequest(fileManageContract, request, {})
  if (!parsed.success) return parsed.response

  const { query, body } = parsed.data
  const userId = auth.userId || query.userId
  if (!userId) {
    return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 })
  }

  const workspaceId = body.workspaceId || query.workspaceId
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: 'workspaceId is required' }, { status: 400 })
  }

  try {
    await assertActiveWorkspaceAccess(workspaceId, userId)

    switch (body.operation) {
      case 'get': {
        const { fileId, fileInput } = body
        const selectedFileId =
          fileId ||
          (fileInput && typeof fileInput === 'object' && !Array.isArray(fileInput)
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
          return NextResponse.json({ success: false, error: 'File is required' }, { status: 400 })
        }

        const file = await getWorkspaceFile(workspaceId, selectedFileId)
        if (!file) {
          return NextResponse.json(
            { success: false, error: `File not found: "${selectedFileId}"` },
            { status: 404 }
          )
        }

        logger.info('File retrieved', {
          fileId: file.id,
          name: file.name,
        })

        return NextResponse.json({
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
          return NextResponse.json({ success: false, error: 'File is required' }, { status: 400 })
        }

        const files = await Promise.all(
          selectedFileIds.map((id) => getWorkspaceFile(workspaceId, id))
        )
        const missingFileId = selectedFileIds.find((_, index) => !files[index])
        if (missingFileId) {
          return NextResponse.json(
            { success: false, error: `File not found: "${missingFileId}"` },
            { status: 404 }
          )
        }

        const userFiles = files
          .map((file) => workspaceFileToUserFile(file))
          .filter((file): file is NonNullable<ReturnType<typeof workspaceFileToUserFile>> =>
            Boolean(file)
          )
          .concat(selectedInputFiles)

        logger.info('Files retrieved', {
          count: userFiles.length,
          fileIds: userFiles.map((file) => file.id),
        })

        return NextResponse.json({
          success: true,
          data: {
            file: userFiles[0],
            files: userFiles,
          },
        })
      }

      case 'content': {
        const { fileId, fileInput } = body
        const requestId = generateRequestId()

        const selectedFileIds = Array.isArray(fileId)
          ? fileId.map((id) => id.trim()).filter(Boolean)
          : fileId
            ? normalizeFileIdList(fileId)
            : extractFileIdsFromInput(fileInput)
        const selectedInputFiles = fileId ? [] : extractUserFilesFromInput(fileInput)

        if (selectedFileIds.length === 0 && selectedInputFiles.length === 0) {
          return NextResponse.json({ success: false, error: 'File is required' }, { status: 400 })
        }

        const workspaceFiles = await Promise.all(
          selectedFileIds.map((id) => getWorkspaceFile(workspaceId, id))
        )
        const missingFileId = selectedFileIds.find((_, index) => !workspaceFiles[index])
        if (missingFileId) {
          return NextResponse.json(
            { success: false, error: `File not found: "${missingFileId}"` },
            { status: 404 }
          )
        }

        const userFiles: UserFile[] = workspaceFiles
          .map((file) => workspaceFileToUserFile(file))
          .filter((file): file is NonNullable<ReturnType<typeof workspaceFileToUserFile>> =>
            Boolean(file)
          )
          .concat(selectedInputFiles)

        const contents: string[] = []
        let totalBytes = 0
        for (const userFile of userFiles) {
          const denied = await assertToolFileAccess(userFile.key, userId, requestId, logger)
          if (denied) return denied

          const content = await extractUserFileTextContent(userFile, requestId)
          totalBytes += Buffer.byteLength(content, 'utf8')
          if (totalBytes > MAX_GET_CONTENT_TOTAL_BYTES) {
            return NextResponse.json(
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

        return NextResponse.json({
          success: true,
          data: { contents },
        })
      }

      case 'write': {
        const { fileName, content, contentType } = body
        const { folderSegments, leafName } = splitWorkspaceFilePath(fileName)
        const folderId = await ensureWorkspaceFileFolderPath({
          workspaceId,
          userId,
          pathSegments: folderSegments,
        })
        const mimeType = contentType || getMimeTypeFromExtension(getFileExtension(leafName))
        const fileBuffer = Buffer.from(content ?? '', 'utf-8')
        const result = await uploadWorkspaceFile(
          workspaceId,
          userId,
          fileBuffer,
          leafName,
          mimeType,
          { folderId }
        )

        logger.info('File created', {
          fileId: result.id,
          name: fileName,
          size: fileBuffer.length,
        })

        return NextResponse.json({
          success: true,
          data: {
            id: result.id,
            name: result.name,
            size: fileBuffer.length,
            url: ensureAbsoluteUrl(result.url),
          },
        })
      }

      case 'move': {
        const { fileId, targetFolder } = body
        const pathSegments = targetFolder.trim()
          ? targetFolder
              .trim()
              .split('/')
              .map((s) => s.trim())
              .filter(Boolean)
          : []
        const targetFolderId = await ensureWorkspaceFileFolderPath({
          workspaceId,
          userId,
          pathSegments,
        })
        const moveResult = await performMoveWorkspaceFileItems({
          workspaceId,
          userId,
          fileIds: [fileId],
          targetFolderId,
        })
        if (!moveResult.success) {
          return NextResponse.json(
            { success: false, error: moveResult.error },
            {
              status:
                moveResult.errorCode === 'conflict'
                  ? 409
                  : moveResult.errorCode === 'not_found'
                    ? 404
                    : 400,
            }
          )
        }
        logger.info('File moved', { fileId, targetFolder: targetFolder || '(root)' })
        return NextResponse.json({
          success: true,
          data: { fileId, targetFolder: targetFolder || '(root)' },
        })
      }

      case 'manage_sharing': {
        const { fileId, isActive, authType, password, allowedEmails } = body

        // Check permission before probing file existence so a read-only caller
        // can't distinguish 404 from 403 as a file-existence side channel.
        // Publishing is more sensitive than the other mutating ops, so it
        // requires write/admin (not just workspace access) like the share route.
        const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
        if (permission !== 'admin' && permission !== 'write') {
          return NextResponse.json(
            { success: false, error: 'Insufficient permissions' },
            { status: 403 }
          )
        }

        const file = await getWorkspaceFile(workspaceId, fileId)
        if (!file) {
          return NextResponse.json(
            { success: false, error: `File not found: "${fileId}"` },
            { status: 404 }
          )
        }

        // Enabling a share is gated by the org's access-control policy; disabling
        // is always allowed so users can un-share after the policy is turned on.
        if (isActive) {
          // Resolve the auth type the same way upsertFileShare will (falling back
          // to the existing share's type) so the policy gate can't be bypassed by
          // re-enabling a pre-existing restricted share without an explicit authType.
          const existingShare = await getShareForResource('file', fileId)
          const resolvedAuthType = authType ?? existingShare?.authType ?? 'public'
          try {
            await validatePublicFileSharing(userId, workspaceId, resolvedAuthType)
          } catch (error) {
            if (error instanceof PublicFileSharingNotAllowedError) {
              return NextResponse.json({ success: false, error: error.message }, { status: 403 })
            }
            throw error
          }
        }

        const share = await upsertFileShare({
          workspaceId,
          fileId,
          userId,
          isActive,
          authType,
          password,
          allowedEmails,
        })

        recordAudit({
          workspaceId,
          actorId: userId,
          action: isActive ? AuditAction.FILE_SHARED : AuditAction.FILE_SHARE_DISABLED,
          resourceType: AuditResourceType.FILE,
          resourceId: fileId,
          resourceName: file.name,
          description: `${isActive ? 'Enabled' : 'Disabled'} public share for "${file.name}"`,
          request,
        })

        logger.info('File sharing updated', { fileId, isActive, authType: share.authType })

        // A disabled link doesn't resolve, so don't hand back a dead URL.
        const responseShare = share.isActive ? share : { ...share, url: '' }
        return NextResponse.json({ success: true, data: { share: responseShare } })
      }

      case 'append': {
        const { fileName, content } = body

        const existing = await resolveWorkspaceFileReference(workspaceId, fileName)
        if (!existing) {
          return NextResponse.json(
            { success: false, error: `File not found: "${fileName}"` },
            { status: 404 }
          )
        }

        const lockKey = `file-append:${workspaceId}:${existing.id}`
        const lockValue = `${Date.now()}-${generateShortId()}`
        const acquired = await acquireLock(lockKey, lockValue, 30)
        if (!acquired) {
          return NextResponse.json(
            { success: false, error: 'File is busy, please retry' },
            { status: 409 }
          )
        }

        try {
          const existingBuffer = await fetchWorkspaceFileBuffer(existing)
          const finalContent = existingBuffer.toString('utf-8') + content
          const fileBuffer = Buffer.from(finalContent, 'utf-8')
          await updateWorkspaceFileContent(workspaceId, existing.id, userId, fileBuffer)

          logger.info('File appended', {
            fileId: existing.id,
            name: existing.name,
            size: fileBuffer.length,
          })

          return NextResponse.json({
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
        const requestId = generateRequestId()

        const selectedFileIds = Array.isArray(fileId)
          ? fileId.map((id) => id.trim()).filter(Boolean)
          : fileId
            ? normalizeFileIdList(fileId)
            : extractFileIdsFromInput(fileInput)
        const selectedInputFiles = fileId ? [] : extractUserFilesFromInput(fileInput)

        if (selectedFileIds.length === 0 && selectedInputFiles.length === 0) {
          return NextResponse.json({ success: false, error: 'File is required' }, { status: 400 })
        }

        const workspaceFiles = await Promise.all(
          selectedFileIds.map((id) => getWorkspaceFile(workspaceId, id))
        )
        const missingFileId = selectedFileIds.find((_, index) => !workspaceFiles[index])
        if (missingFileId) {
          return NextResponse.json(
            { success: false, error: `File not found: "${missingFileId}"` },
            { status: 404 }
          )
        }

        const userFiles: UserFile[] = workspaceFiles
          .map((file) => workspaceFileToUserFile(file))
          .filter((file): file is NonNullable<ReturnType<typeof workspaceFileToUserFile>> =>
            Boolean(file)
          )
          .concat(selectedInputFiles)

        const zip = new JSZip()
        const usedNames = new Set<string>()
        let totalBytes = 0
        for (const userFile of userFiles) {
          const denied = await assertToolFileAccess(userFile.key, userId, requestId, logger)
          if (denied) return denied

          const buffer = await downloadFileFromStorage(userFile, requestId, logger, {
            maxBytes: MAX_COMPRESS_FILE_BYTES,
          })
          totalBytes += buffer.length
          if (totalBytes > MAX_COMPRESS_TOTAL_BYTES) {
            return NextResponse.json(
              {
                success: false,
                error: `Combined input is too large to compress. Maximum is ${
                  MAX_COMPRESS_TOTAL_BYTES / (1024 * 1024)
                } MB.`,
              },
              { status: 413 }
            )
          }
          zip.file(uniqueZipEntryName(toFlatFileName(userFile.name, 'file'), usedNames), buffer)
        }

        const zipBuffer = await zip.generateAsync({
          type: 'nodebuffer',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 },
        })

        const requestedName = typeof archiveName === 'string' ? archiveName.trim() : ''
        const baseName = requestedName
          ? toFlatFileName(requestedName, 'archive')
          : userFiles.length === 1
            ? stripExtension(toFlatFileName(userFiles[0].name, 'archive'))
            : 'archive'
        const leafName = ensureZipExtension(baseName)
        const folderId = await ensureWorkspaceFileFolderPath({
          workspaceId,
          userId,
          pathSegments: [],
        })
        const result = await uploadWorkspaceFile(
          workspaceId,
          userId,
          zipBuffer,
          leafName,
          'application/zip',
          { folderId }
        )

        const compressedFile: UserFile = {
          ...result,
          url: ensureAbsoluteUrl(result.url),
          size: zipBuffer.length,
        }

        logger.info('Files compressed', {
          fileId: result.id,
          name: result.name,
          fileCount: userFiles.length,
          size: zipBuffer.length,
        })

        return NextResponse.json({
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
        const requestId = generateRequestId()

        const selectedFileIds = fileId ? [fileId] : extractFileIdsFromInput(fileInput)
        const selectedInputFiles = fileId ? [] : extractUserFilesFromInput(fileInput)

        if (selectedFileIds.length === 0 && selectedInputFiles.length === 0) {
          return NextResponse.json({ success: false, error: 'File is required' }, { status: 400 })
        }
        if (selectedFileIds.length + selectedInputFiles.length > 1) {
          return NextResponse.json(
            { success: false, error: 'Decompress accepts a single .zip archive at a time' },
            { status: 400 }
          )
        }

        const workspaceFiles = await Promise.all(
          selectedFileIds.map((id) => getWorkspaceFile(workspaceId, id))
        )
        const missingFileId = selectedFileIds.find((_, index) => !workspaceFiles[index])
        if (missingFileId) {
          return NextResponse.json(
            { success: false, error: `File not found: "${missingFileId}"` },
            { status: 404 }
          )
        }

        const archive = workspaceFiles
          .map((file) => workspaceFileToUserFile(file))
          .filter((file): file is NonNullable<ReturnType<typeof workspaceFileToUserFile>> =>
            Boolean(file)
          )
          .concat(selectedInputFiles)[0]

        if (!archive) {
          return NextResponse.json({ success: false, error: 'File is required' }, { status: 400 })
        }

        const denied = await assertToolFileAccess(archive.key, userId, requestId, logger)
        if (denied) return denied

        const archiveBuffer = await downloadFileFromStorage(archive, requestId, logger, {
          maxBytes: MAX_DECOMPRESS_ARCHIVE_BYTES,
        })

        let zip: JSZip
        try {
          zip = await JSZip.loadAsync(archiveBuffer)
        } catch {
          return NextResponse.json(
            { success: false, error: `"${archive.name}" is not a valid .zip archive` },
            { status: 400 }
          )
        }

        const entries = Object.values(zip.files).filter(
          (entry) => !entry.dir && !isSymlinkEntry(entry)
        )
        if (entries.length > MAX_DECOMPRESS_ENTRIES) {
          return NextResponse.json(
            {
              success: false,
              error: `Archive has too many entries to extract. Maximum is ${MAX_DECOMPRESS_ENTRIES}.`,
            },
            { status: 413 }
          )
        }

        const entryTooLargeResponse = (name: string) =>
          NextResponse.json(
            {
              success: false,
              error: `Archive entry "${name}" is too large to extract. Maximum is ${
                MAX_DECOMPRESS_ENTRY_BYTES / (1024 * 1024)
              } MB per file.`,
            },
            { status: 413 }
          )
        const totalTooLargeResponse = () =>
          NextResponse.json(
            {
              success: false,
              error: `Archive expands to more than the ${
                MAX_DECOMPRESS_TOTAL_BYTES / (1024 * 1024)
              } MB extraction limit.`,
            },
            { status: 413 }
          )

        // Resolve which entries are safe to extract first, so unsafe entries
        // (skipped below) never count toward the size caps.
        const safeEntries: Array<{ entry: JSZip.JSZipObject; segments: string[] }> = []
        let skippedCount = 0
        for (const entry of entries) {
          const segments = sanitizeArchiveEntryPath(entry.name)
          if (!segments) {
            skippedCount += 1
            logger.warn('Skipping unsafe archive entry', { name: entry.name })
            continue
          }
          safeEntries.push({ entry, segments })
        }

        let declaredTotal = 0
        for (const { entry } of safeEntries) {
          const declaredSize = readEntryUncompressedSize(entry)
          if (declaredSize === undefined) continue
          if (declaredSize > MAX_DECOMPRESS_ENTRY_BYTES) return entryTooLargeResponse(entry.name)
          declaredTotal += declaredSize
          if (declaredTotal > MAX_DECOMPRESS_TOTAL_BYTES) return totalTooLargeResponse()
        }

        const pending: Array<{ segments: string[]; buffer: Buffer }> = []
        let totalBytes = 0
        for (const { entry, segments } of safeEntries) {
          const result = await inflateEntryWithinCaps(
            entry,
            MAX_DECOMPRESS_TOTAL_BYTES - totalBytes
          )
          if (!result.ok) {
            return result.reason === 'entry'
              ? entryTooLargeResponse(entry.name)
              : totalTooLargeResponse()
          }
          totalBytes += result.buffer.length
          pending.push({ segments, buffer: result.buffer })
        }

        if (pending.length === 0) {
          return NextResponse.json(
            {
              success: false,
              error: `No files could be extracted from "${archive.name}".`,
            },
            { status: 422 }
          )
        }

        const folderIdCache = new Map<string, string | null>()
        const extractedFiles: UserFile[] = []
        for (const { segments, buffer } of pending) {
          const leafName = segments[segments.length - 1]
          const folderSegments = segments.slice(0, -1)
          const folderKey = folderSegments.join('/')
          let folderId = folderIdCache.get(folderKey)
          if (folderId === undefined) {
            folderId = await ensureWorkspaceFileFolderPath({
              workspaceId,
              userId,
              pathSegments: folderSegments,
            })
            folderIdCache.set(folderKey, folderId)
          }

          const mimeType = getMimeTypeFromExtension(getFileExtension(leafName))
          const uploaded = await uploadWorkspaceFile(
            workspaceId,
            userId,
            buffer,
            leafName,
            mimeType,
            { folderId }
          )
          extractedFiles.push({ ...uploaded, url: ensureAbsoluteUrl(uploaded.url) })
        }

        logger.info('Archive decompressed', {
          fileId: archive.id,
          name: archive.name,
          extractedCount: extractedFiles.length,
          skippedCount,
        })

        return NextResponse.json({
          success: true,
          data: {
            files: extractedFiles,
          },
        })
      }
    }
  } catch (error) {
    if (isWorkspaceAccessDeniedError(error)) {
      return NextResponse.json(
        { success: false, error: 'Workspace access denied' },
        { status: 403 }
      )
    }
    if (error instanceof ShareValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 })
    }
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('File operation failed', { operation: body.operation, error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
})
