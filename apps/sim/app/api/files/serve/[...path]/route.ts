import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { runSandboxTask } from '@/lib/execution/sandbox/run-task'
import { CopilotFiles, isUsingCloudStorage } from '@/lib/uploads'
import type { StorageContext } from '@/lib/uploads/config'
import { parseWorkspaceFileKey } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { inferContextFromKey } from '@/lib/uploads/utils/file-utils'
import { verifyFileAccess } from '@/app/api/files/authorization'
import {
  createErrorResponse,
  createFileResponse,
  FileNotFoundError,
  findLocalFile,
  getContentType,
} from '@/app/api/files/utils'
import type { SandboxTaskId } from '@/sandbox-tasks/registry'

const logger = createLogger('FilesServeAPI')

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF-

interface CompilableFormat {
  magic: Buffer
  taskId: SandboxTaskId
  contentType: string
}

const COMPILABLE_FORMATS: Record<string, CompilableFormat> = {
  '.pptx': {
    magic: ZIP_MAGIC,
    taskId: 'pptx-generate',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  '.docx': {
    magic: ZIP_MAGIC,
    taskId: 'docx-generate',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  '.pdf': {
    magic: PDF_MAGIC,
    taskId: 'pdf-generate',
    contentType: 'application/pdf',
  },
}

const MAX_COMPILED_DOC_CACHE = 10
const compiledDocCache = new Map<string, Buffer>()

function compiledCacheSet(key: string, buffer: Buffer): void {
  if (compiledDocCache.size >= MAX_COMPILED_DOC_CACHE) {
    compiledDocCache.delete(compiledDocCache.keys().next().value as string)
  }
  compiledDocCache.set(key, buffer)
}

async function compileDocumentIfNeeded(
  buffer: Buffer,
  filename: string,
  workspaceId: string | undefined,
  raw: boolean,
  ownerKey: string | undefined,
  signal: AbortSignal | undefined
): Promise<{ buffer: Buffer; contentType: string }> {
  if (raw) return { buffer, contentType: getContentType(filename) }

  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  const format = COMPILABLE_FORMATS[ext]
  if (!format) return { buffer, contentType: getContentType(filename) }

  const magicLen = format.magic.length
  if (buffer.length >= magicLen && buffer.subarray(0, magicLen).equals(format.magic)) {
    return { buffer, contentType: getContentType(filename) }
  }

  const code = buffer.toString('utf-8')
  const cacheKey = createHash('sha256')
    .update(ext)
    .update(code)
    .update(workspaceId ?? '')
    .digest('hex')
  const cached = compiledDocCache.get(cacheKey)
  if (cached) {
    return { buffer: cached, contentType: format.contentType }
  }

  const compiled = await runSandboxTask(
    format.taskId,
    { code, workspaceId: workspaceId || '' },
    { ownerKey, signal }
  )
  compiledCacheSet(cacheKey, compiled)
  return { buffer: compiled, contentType: format.contentType }
}

const STORAGE_KEY_PREFIX_RE = /^\d{13}-[a-z0-9]{7}-/

function stripStorageKeyPrefix(segment: string): string {
  return STORAGE_KEY_PREFIX_RE.test(segment) ? segment.replace(STORAGE_KEY_PREFIX_RE, '') : segment
}

function getWorkspaceIdForCompile(key: string): string | undefined {
  return parseWorkspaceFileKey(key) ?? undefined
}

export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) => {
    try {
      const { path } = await params

      if (!path || path.length === 0) {
        throw new FileNotFoundError('No file path provided')
      }

      logger.info('File serve request:', { path })

      const fullPath = path.join('/')
      const isS3Path = path[0] === 's3'
      const isBlobPath = path[0] === 'blob'
      const isCloudPath = isS3Path || isBlobPath
      const cloudKey = isCloudPath ? path.slice(1).join('/') : fullPath

      const isPublicByKeyPrefix =
        cloudKey.startsWith('profile-pictures/') ||
        cloudKey.startsWith('og-images/') ||
        cloudKey.startsWith('workspace-logos/')

      if (isPublicByKeyPrefix) {
        const context = inferContextFromKey(cloudKey)
        logger.info(`Serving public ${context}:`, { cloudKey })
        if (isUsingCloudStorage() || isCloudPath) {
          return await handleCloudProxyPublic(cloudKey, context)
        }
        return await handleLocalFilePublic(fullPath)
      }

      const raw = request.nextUrl.searchParams.get('raw') === '1'

      const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })

      if (!authResult.success || !authResult.userId) {
        logger.warn('Unauthorized file access attempt', {
          path,
          error: authResult.error || 'Missing userId',
        })
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const userId = authResult.userId

      if (isUsingCloudStorage()) {
        return await handleCloudProxy(cloudKey, userId, raw, request.signal)
      }

      return await handleLocalFile(cloudKey, userId, raw, request.signal)
    } catch (error) {
      logger.error('Error serving file:', error)

      if (error instanceof FileNotFoundError) {
        return createErrorResponse(error)
      }

      return createErrorResponse(error instanceof Error ? error : new Error('Failed to serve file'))
    }
  }
)

async function handleLocalFile(
  filename: string,
  userId: string,
  raw: boolean,
  signal: AbortSignal | undefined
): Promise<NextResponse> {
  const ownerKey = `user:${userId}`
  try {
    const contextParam: StorageContext | undefined = inferContextFromKey(filename) as
      | StorageContext
      | undefined

    const hasAccess = await verifyFileAccess(
      filename,
      userId,
      undefined, // customConfig
      contextParam, // context
      true // isLocal
    )

    if (!hasAccess) {
      logger.warn('Unauthorized local file access attempt', { userId, filename })
      throw new FileNotFoundError(`File not found: ${filename}`)
    }

    const filePath = await findLocalFile(filename)

    if (!filePath) {
      throw new FileNotFoundError(`File not found: ${filename}`)
    }

    const rawBuffer = await readFile(filePath)
    const segment = filename.split('/').pop() || filename
    const displayName = stripStorageKeyPrefix(segment)
    const workspaceId = getWorkspaceIdForCompile(filename)
    const { buffer: fileBuffer, contentType } = await compileDocumentIfNeeded(
      rawBuffer,
      displayName,
      workspaceId,
      raw,
      ownerKey,
      signal
    )

    logger.info('Local file served', { userId, filename, size: fileBuffer.length })

    return createFileResponse({
      buffer: fileBuffer,
      contentType,
      filename: displayName,
      cacheControl: contextParam === 'workspace' ? 'private, no-cache, must-revalidate' : undefined,
    })
  } catch (error) {
    logger.error('Error reading local file:', error)
    throw error
  }
}

async function handleCloudProxy(
  cloudKey: string,
  userId: string,
  raw = false,
  signal: AbortSignal | undefined = undefined
): Promise<NextResponse> {
  const ownerKey = `user:${userId}`
  try {
    const context = inferContextFromKey(cloudKey)
    logger.info(`Inferred context: ${context} from key pattern: ${cloudKey}`)

    const hasAccess = await verifyFileAccess(
      cloudKey,
      userId,
      undefined, // customConfig
      context, // context
      false // isLocal
    )

    if (!hasAccess) {
      logger.warn('Unauthorized cloud file access attempt', { userId, key: cloudKey, context })
      throw new FileNotFoundError(`File not found: ${cloudKey}`)
    }

    let rawBuffer: Buffer

    if (context === 'copilot') {
      rawBuffer = await CopilotFiles.downloadCopilotFile(cloudKey)
    } else {
      rawBuffer = await downloadFile({
        key: cloudKey,
        context,
      })
    }

    const segment = cloudKey.split('/').pop() || 'download'
    const displayName = stripStorageKeyPrefix(segment)
    const workspaceId = getWorkspaceIdForCompile(cloudKey)
    const { buffer: fileBuffer, contentType } = await compileDocumentIfNeeded(
      rawBuffer,
      displayName,
      workspaceId,
      raw,
      ownerKey,
      signal
    )

    logger.info('Cloud file served', {
      userId,
      key: cloudKey,
      size: fileBuffer.length,
      context,
    })

    return createFileResponse({
      buffer: fileBuffer,
      contentType,
      filename: displayName,
      cacheControl: context === 'workspace' ? 'private, no-cache, must-revalidate' : undefined,
    })
  } catch (error) {
    logger.error('Error downloading from cloud storage:', error)
    throw error
  }
}

async function handleCloudProxyPublic(
  cloudKey: string,
  context: StorageContext
): Promise<NextResponse> {
  try {
    let fileBuffer: Buffer

    if (context === 'copilot') {
      fileBuffer = await CopilotFiles.downloadCopilotFile(cloudKey)
    } else {
      fileBuffer = await downloadFile({
        key: cloudKey,
        context,
      })
    }

    const filename = cloudKey.split('/').pop() || 'download'
    const contentType = getContentType(filename)

    logger.info('Public cloud file served', {
      key: cloudKey,
      size: fileBuffer.length,
      context,
    })

    return createFileResponse({
      buffer: fileBuffer,
      contentType,
      filename,
    })
  } catch (error) {
    logger.error('Error serving public cloud file:', error)
    throw error
  }
}

async function handleLocalFilePublic(filename: string): Promise<NextResponse> {
  try {
    const filePath = await findLocalFile(filename)

    if (!filePath) {
      throw new FileNotFoundError(`File not found: ${filename}`)
    }

    const fileBuffer = await readFile(filePath)
    const contentType = getContentType(filename)

    logger.info('Public local file served', { filename, size: fileBuffer.length })

    return createFileResponse({
      buffer: fileBuffer,
      contentType,
      filename,
    })
  } catch (error) {
    logger.error('Error reading public local file:', error)
    throw error
  }
}
