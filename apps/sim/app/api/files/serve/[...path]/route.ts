import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { fileServeParamsSchema, fileServeQuerySchema } from '@/lib/api/contracts/storage-transfer'
import {
  concealCrossTenantResourceError,
  InternalUnauthenticatedError,
} from '@/lib/api/server/routes'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { assertKnownSizeWithinLimit, isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveServableDocBytes } from '@/lib/mothership/tools/server/files/doc-compile'
import { DocCompileUserError } from '@/lib/mothership/tools/server/files/doc-compile-error'
import { CopilotFiles, isUsingCloudStorage } from '@/lib/uploads'
import type { StorageContext } from '@/lib/uploads/config'
import { parseWorkspaceFileKey } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { resolveServableImageBytes } from '@/lib/uploads/server/image-derivative'
import { resolveStoredFileContext } from '@/lib/uploads/server/metadata'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { inferContextFromKey } from '@/lib/uploads/utils/file-utils'
import { internalWorkspaceFileServeAuth } from '@/lib/workspace-files/api'
import { readWorkspaceFileContentByKey } from '@/lib/workspace-files/application/read-workspace-file-content-by-key'
import { isSimPageSource, SIM_PAGE_CONTENT_TYPE } from '@/lib/workspace-files/page-compile'
import { renderSimPageDocumentWithAssets } from '@/lib/workspace-files/page-document.server'
import { verifyFileAccess } from '@/app/api/files/authorization'
import {
  createErrorResponse,
  createFileResponse,
  FileNotFoundError,
  findLocalFile,
  getContentType,
  readLocalFileWithinLimit,
} from '@/app/api/files/utils'

const logger = createLogger('FilesServeAPI')

/**
 * Records a failed serve at a level that matches whose fault it is.
 *
 * A file that is not there is an ordinary answer rather than a server fault: a
 * workspace file is rewritten under a new key on every content update, so a reader
 * holding the previous key lands here routinely and correctly receives a 404. Each
 * handler rethrows into the outer one, so logging those at `error` reports the same
 * expected 404 twice and buries the failures that do warrant attention. A file too
 * large to serve resident is the same kind of answer — a 413 the caller cannot retry
 * its way out of, not something on call needs to look at.
 */
function logServeFailure(message: string, error: unknown): void {
  if (error instanceof FileNotFoundError || isPayloadSizeLimitError(error)) {
    logger.info(message, { reason: getErrorMessage(error) })
    return
  }
  logger.error(message, error)
}

interface ServeOptions {
  /** `raw=1` — bypass all resolution and serve the stored source as-is. */
  raw: boolean
  /** `preview=1` — the caller renders these bytes rather than saving them. */
  preview: boolean
  /** `v=<updatedAt>` — the URL addresses content-immutable bytes. */
  versioned: boolean
}

/**
 * Resolves the bytes + content type to serve for a stored file.
 *
 * Document compilation is unconditional: a generated `.docx`/`.xlsx`/`.pptx` is
 * stored as source, so the compiled artifact *is* the file, and every download
 * routes through here. An image derivative is the opposite — the stored bytes are
 * the file — so it is served only when the caller asked to preview, never when it
 * asked to download.
 *
 * Every branch that replaces the source bytes is re-checked against the transfer
 * ceiling on the way out. Bounding the read alone does not bound the response: a
 * page inlines its images, a generated document resolves to a compiled artifact
 * fetched separately, and a derivative is transcoded here — so each can turn a
 * source under the ceiling into a response over it. One check where the branches
 * converge is what makes that impossible to miss when a branch is added.
 */
async function resolveServableBytes(params: {
  buffer: Buffer
  filename: string
  storageKey: string
  workspaceId: string | undefined
  options: ServeOptions
  ownerKey: string | undefined
  filePrincipal?: Principal
  /** The stored record's content type, where the caller has the record. */
  fileType?: string
  signal: AbortSignal | undefined
}): Promise<{ buffer: Buffer; contentType: string }> {
  // `raw` is the stored source, already bounded by the read that produced it, but it
  // goes through the same check so the ceiling holds for everything this returns
  // rather than for every branch someone remembered to cover.
  const resolved = params.options.raw
    ? { buffer: params.buffer, contentType: getContentType(params.filename) }
    : await resolveTransformedBytes(params)
  assertKnownSizeWithinLimit(
    resolved.buffer.length,
    MAX_BUFFERED_TRANSFER_BYTES,
    'served file response'
  )
  return resolved
}

async function resolveTransformedBytes(params: {
  buffer: Buffer
  filename: string
  storageKey: string
  workspaceId: string | undefined
  options: ServeOptions
  ownerKey: string | undefined
  filePrincipal?: Principal
  fileType?: string
  signal: AbortSignal | undefined
}): Promise<{ buffer: Buffer; contentType: string }> {
  const {
    buffer,
    filename,
    storageKey,
    workspaceId,
    options,
    ownerKey,
    filePrincipal,
    fileType,
    signal,
  } = params

  // The pdf model for pages: a page file stores its SOURCE (frontmatter +
  // markdown + sim: fences) and serving compiles it to the rendered document,
  // the same way a .pdf key stores its script and serves the binary. Raw
  // requests above still return the source; bespoke/legacy HTML falls through
  // untouched. Sim pages store an EXTENSIONLESS name — the record type marks
  // them; legacy pages still carry .html.
  if (fileType === SIM_PAGE_CONTENT_TYPE || filename.toLowerCase().endsWith('.html')) {
    const text = buffer.toString('utf8')
    if (isSimPageSource(text)) {
      const rendered = Buffer.from(
        await renderSimPageDocumentWithAssets(text, { workspaceId }),
        'utf8'
      )
      return { buffer: rendered, contentType: 'text/html' }
    }
  }

  if (options.preview) {
    // Images resolve independently of the document path: a HEIF has no compiled-source
    // concept, so it never reaches the doc branch.
    const image = await resolveServableImageBytes(buffer, storageKey)
    if (image) return image
  }

  return resolveServableDocBytes({
    rawBuffer: buffer,
    fileName: filename,
    workspaceId,
    filePrincipal,
    ownerKey,
    signal,
  })
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
/** For the genuinely-public, pre-auth asset routes (avatars, OG images, workspace logos) — these are
 *  intentionally shared-cacheable. Passed EXPLICITLY so the default response cache stays `private`. */
const PUBLIC_ASSET_CACHE_CONTROL = 'public, max-age=31536000'

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
      const isGcsPath = path[0] === 'gcs'
      const isCloudPath = isS3Path || isBlobPath || isGcsPath
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

      // Which module owns the object decides which branch below may serve it, and that
      // is the row's answer, not the prefix's — a `workspace/` key carries both Files
      // module files and mothership chat attachments. Reading the prefix alone here is
      // what sent every attachment into the workspace-file use case, which matches on
      // `context = 'workspace'` and answered 404 for a file that was present.
      const storageContext = await resolveStoredFileContext(cloudKey)
      const workspacePrincipal =
        storageContext === 'workspace'
          ? await internalWorkspaceFileServeAuth.authenticate(request, { path })
          : undefined
      const legacyAuthResult = workspacePrincipal
        ? undefined
        : await checkSessionOrInternalAuth(request, { requireWorkflowId: false })

      if (legacyAuthResult && (!legacyAuthResult.success || !legacyAuthResult.userId)) {
        logger.warn('Unauthorized file access attempt', {
          path,
          error: legacyAuthResult.error || 'Missing userId',
        })
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const query = fileServeQuerySchema.parse({
        raw: request.nextUrl.searchParams.get('raw'),
        preview: request.nextUrl.searchParams.get('preview'),
        v: request.nextUrl.searchParams.get('v'),
      })
      const options: ServeOptions = {
        raw: query.raw === '1',
        preview: query.preview === '1',
        versioned: query.v != null,
      }

      if (workspacePrincipal) {
        return await handleWorkspaceFile(cloudKey, workspacePrincipal, options, request)
      }

      const userId = legacyAuthResult?.userId
      if (!userId) throw new Error('Authenticated file serve request is missing a user ID')

      if (isUsingCloudStorage()) {
        return await handleCloudProxy(cloudKey, userId, options, request.signal, storageContext)
      }

      return await handleLocalFile(cloudKey, userId, options, request.signal, storageContext)
    } catch (error) {
      if (error instanceof InternalUnauthenticatedError) {
        logger.warn('Unauthorized file access attempt', { error: error.message })
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

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

      const orchestrationError = asOrchestrationError(
        concealCrossTenantResourceError(error, 'File not found')
      )
      if (orchestrationError?.code === 'not_found') {
        const notFound = new FileNotFoundError('File not found')
        logServeFailure('Error serving file:', notFound)
        return createErrorResponse(notFound)
      }

      logServeFailure('Error serving file:', error)

      if (error instanceof FileNotFoundError) {
        return createErrorResponse(error)
      }

      return createErrorResponse(error instanceof Error ? error : new Error('Failed to serve file'))
    }
  }
)

async function handleWorkspaceFile(
  key: string,
  principal: Principal,
  options: ServeOptions,
  request: NextRequest
): Promise<NextResponse> {
  const workspaceId = getWorkspaceIdForCompile(key)
  if (!workspaceId) throw new FileNotFoundError(`File not found: ${key}`)

  const { file, content } = await readWorkspaceFileContentByKey.execute({
    principal,
    input: { key, assertedWorkspaceId: workspaceId },
    request,
  })
  const ownerKey = `user:${requirePrincipalSubjectUserId(principal)}`
  const resolved = await resolveServableBytes({
    buffer: content,
    filename: file.name,
    storageKey: key,
    workspaceId,
    options,
    ownerKey,
    filePrincipal: principal,
    fileType: file.type,
    signal: request.signal,
  })

  logger.info('Workspace file served', {
    fileId: file.id,
    workspaceId,
    size: resolved.buffer.length,
  })
  return createFileResponse({
    buffer: resolved.buffer,
    contentType: resolved.contentType,
    filename: file.name,
    cacheControl: resolveServeCacheControl(options.versioned, 'workspace'),
  })
}

async function handleLocalFile(
  filename: string,
  userId: string,
  options: ServeOptions,
  signal: AbortSignal | undefined,
  context: StorageContext
): Promise<NextResponse> {
  const ownerKey = `user:${userId}`
  try {
    const hasAccess = await verifyFileAccess(
      filename,
      userId,
      undefined, // customConfig
      context,
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

    const rawBuffer = await readLocalFileWithinLimit(
      filePath,
      MAX_BUFFERED_TRANSFER_BYTES,
      'served file'
    )
    const segment = filename.split('/').pop() || filename
    const displayName = stripStorageKeyPrefix(segment)
    const workspaceId = getWorkspaceIdForCompile(filename)
    const { buffer: fileBuffer, contentType } = await resolveServableBytes({
      buffer: rawBuffer,
      filename: displayName,
      storageKey: filename,
      workspaceId,
      options,
      ownerKey,
      signal,
    })

    logger.info('Local file served', { userId, filename, size: fileBuffer.length })

    return createFileResponse({
      buffer: fileBuffer,
      contentType,
      filename: displayName,
      cacheControl: resolveServeCacheControl(options.versioned, context),
    })
  } catch (error) {
    logServeFailure('Error reading local file:', error)
    throw error
  }
}

async function handleCloudProxy(
  cloudKey: string,
  userId: string,
  options: ServeOptions,
  signal: AbortSignal | undefined,
  context: StorageContext
): Promise<NextResponse> {
  const ownerKey = `user:${userId}`
  try {
    logger.info(`Resolved context: ${context} for key: ${cloudKey}`)

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
      rawBuffer = await CopilotFiles.downloadCopilotFile(cloudKey, {
        maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
      })
    } else {
      rawBuffer = await downloadFile({
        key: cloudKey,
        context,
        maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
      })
    }

    const segment = cloudKey.split('/').pop() || 'download'
    const displayName = stripStorageKeyPrefix(segment)
    const workspaceId = getWorkspaceIdForCompile(cloudKey)
    const { buffer: fileBuffer, contentType } = await resolveServableBytes({
      buffer: rawBuffer,
      filename: displayName,
      storageKey: cloudKey,
      workspaceId,
      options,
      ownerKey,
      signal,
    })

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
      cacheControl: resolveServeCacheControl(options.versioned, context),
    })
  } catch (error) {
    logServeFailure('Error downloading from cloud storage:', error)
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
      fileBuffer = await CopilotFiles.downloadCopilotFile(cloudKey, {
        maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
      })
    } else {
      fileBuffer = await downloadFile({
        key: cloudKey,
        context,
        maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
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
      cacheControl: PUBLIC_ASSET_CACHE_CONTROL,
    })
  } catch (error) {
    logServeFailure('Error serving public cloud file:', error)
    throw error
  }
}

async function handleLocalFilePublic(filename: string): Promise<NextResponse> {
  try {
    const filePath = await findLocalFile(filename)

    if (!filePath) {
      throw new FileNotFoundError(`File not found: ${filename}`)
    }

    const fileBuffer = await readLocalFileWithinLimit(
      filePath,
      MAX_BUFFERED_TRANSFER_BYTES,
      'served file'
    )
    const contentType = getContentType(filename)

    logger.info('Public local file served', { filename, size: fileBuffer.length })

    return createFileResponse({
      buffer: fileBuffer,
      contentType,
      filename,
      cacheControl: PUBLIC_ASSET_CACHE_CONTROL,
    })
  } catch (error) {
    logServeFailure('Error reading public local file:', error)
    throw error
  }
}
