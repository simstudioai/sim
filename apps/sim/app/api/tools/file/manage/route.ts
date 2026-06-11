import { Buffer, isUtf8 } from 'buffer'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
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
  isWorkspaceAccessDeniedError,
} from '@/lib/workspaces/permissions/utils'
import { assertToolFileAccess } from '@/app/api/files/authorization'
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
    }
  } catch (error) {
    if (isWorkspaceAccessDeniedError(error)) {
      return NextResponse.json(
        { success: false, error: 'Workspace access denied' },
        { status: 403 }
      )
    }
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('File operation failed', { operation: body.operation, error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
})
