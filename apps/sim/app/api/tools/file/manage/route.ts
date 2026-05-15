import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { fileManageContract } from '@/lib/api/contracts/tools/file'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { ensureAbsoluteUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  getWorkspaceFileByName,
  updateWorkspaceFileContent,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import { assertActiveWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

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
            ? typeof fileInput.id === 'string'
              ? fileInput.id
              : typeof fileInput.fileId === 'string'
                ? fileInput.fileId
                : ''
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

      case 'write': {
        const { fileName, content, contentType } = body
        const mimeType = contentType || getMimeTypeFromExtension(getFileExtension(fileName))
        const fileBuffer = Buffer.from(content ?? '', 'utf-8')
        const result = await uploadWorkspaceFile(
          workspaceId,
          userId,
          fileBuffer,
          fileName,
          mimeType
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

      case 'append': {
        const { fileName, content } = body

        const existing = await getWorkspaceFileByName(workspaceId, fileName)
        if (!existing) {
          return NextResponse.json(
            { success: false, error: `File not found: "${fileName}"` },
            { status: 404 }
          )
        }

        const lockKey = `file-append:${workspaceId}:${existing.id}`
        const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`
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
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('File operation failed', { operation: body.operation, error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
})
