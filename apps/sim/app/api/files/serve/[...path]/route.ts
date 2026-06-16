import { readFile } from 'fs/promises'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { fileServeParamsSchema, fileServeQuerySchema } from '@/lib/api/contracts/storage-transfer'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import {
  DocCompileUserError,
  getE2BDocFormat,
  loadCompiledDocByExt,
} from '@/lib/copilot/tools/server/files/doc-compile'
import { isE2BDocEnabled } from '@/lib/core/config/env-flags'
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
  const extNoDot = ext.replace(/^\./, '')
  const format = COMPILABLE_FORMATS[ext]

  // Already a binary file (uploaded or pre-compiled)? Serve as-is.
  if (format) {
    const magicLen = format.magic.length
    if (buffer.length >= magicLen && buffer.subarray(0, magicLen).equals(format.magic)) {
      return { buffer, contentType: getContentType(filename) }
    }
  }

  // .xlsx is a ZIP container with no JS compile path. An uploaded/binary xlsx
  // must short-circuit here (it isn't in COMPILABLE_FORMATS) — otherwise every
  // xlsx open would utf-8-decode the whole binary and do an always-miss S3 GET.
  // Only a Python-source xlsx (UTF-8 text, no ZIP magic) falls through.
  if (
    extNoDot === 'xlsx' &&
    buffer.length >= ZIP_MAGIC.length &&
    buffer.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)
  ) {
    return { buffer, contentType: getContentType(filename) }
  }

  // Generated docs render from a content-addressed compiled binary that is built
  // exactly ONCE per edit_content/create (at write time) and stored in S3. Serve
  // only LOADS it — it must never compile, or it would re-run E2B on every preview
  // fetch, including against the incomplete source mid-generation. A hit returns
  // the (possibly partial) committed doc; a miss in the E2B regime means the doc
  // is still being generated → 409, and the client polls until the artifact lands.
  if (workspaceId && (format || extNoDot === 'xlsx')) {
    const source = buffer.toString('utf-8')
    // Load the prebuilt artifact directly from S3 (content-addressed). No extra
    // in-memory layer here: the store is the source of truth, the client (react
    // query) already caches the bytes, and this branch never recomputes.
    const stored = await loadCompiledDocByExt(workspaceId, source, extNoDot)
    if (stored) {
      return { buffer: stored.buffer, contentType: stored.contentType }
    }

    if (isE2BDocEnabled && (await getE2BDocFormat(filename))) {
      // Artifact not built yet (still generating, or the source didn't compile at
      // write time). Signal "not ready" without compiling — handled as 409.
      throw new DocCompileUserError('Document is still being generated')
    }
  }

  if (!format) return { buffer, contentType: getContentType(filename) }

  // E2B disabled and no stored artifact → compile JS source via isolated-vm.
  const code = buffer.toString('utf-8')
  const cacheKey = sha256Hex(`${ext}${code}${workspaceId ?? ''}`)
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

const IMMUTABLE_CACHE_CONTROL = 'private, max-age=31536000, immutable'
const WORKSPACE_REVALIDATE_CACHE_CONTROL = 'private, no-cache, must-revalidate'

/**
 * Cache-Control for a served file. A versioned request (`?v=<updatedAt>`) addresses
 * content-immutable bytes — generated docs are content-addressed and the version
 * bumps on every edit — so the browser may cache it indefinitely; re-opens and
 * focus refetches then resolve from cache with no round trip. Unversioned workspace
 * reads stay revalidated because the same storage key is edited in place.
 */
function resolveServeCacheControl(
  versioned: boolean,
  context: string | undefined
): string | undefined {
  if (versioned) return IMMUTABLE_CACHE_CONTROL
  return context === 'workspace' ? WORKSPACE_REVALIDATE_CACHE_CONTROL : undefined
}

export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) => {
    try {
      const paramsResult = fileServeParamsSchema.safeParse(await params)
      if (!paramsResult.success) {
        throw new FileNotFoundError('No file path provided')
      }
      const { path } = paramsResult.data

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

      const query = fileServeQuerySchema.parse({
        raw: request.nextUrl.searchParams.get('raw'),
        v: request.nextUrl.searchParams.get('v'),
      })
      const raw = query.raw === '1'
      const versioned = query.v != null

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
        return await handleCloudProxy(cloudKey, userId, raw, versioned, request.signal)
      }

      return await handleLocalFile(cloudKey, userId, raw, versioned, request.signal)
    } catch (error) {
      // An in-progress/incomplete doc source fails to compile — this is expected
      // mid-generation, not a server fault. Return 409 (not 500) so it isn't an
      // alarming error; the client re-fetches once the doc finishes (the serve
      // URL is busted on the file's updatedAt).
      if (error instanceof DocCompileUserError) {
        logger.info('Serve: document still compiling, returning 409', {
          message: error.message,
        })
        return NextResponse.json({ error: 'Document is still being generated' }, { status: 409 })
      }

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
  versioned: boolean,
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
      cacheControl: resolveServeCacheControl(versioned, contextParam),
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
  versioned = false,
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
      cacheControl: resolveServeCacheControl(versioned, context),
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
