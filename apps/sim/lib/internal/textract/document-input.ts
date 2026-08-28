import type { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { NextResponse } from 'next/server'
import { validateS3BucketName } from '@/lib/core/security/input-validation'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { TextractOperationError } from '@/lib/internal/textract/errors'
import {
  isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import type { RawFileInput } from '@/lib/uploads/utils/file-utils'
import {
  extractStorageKey,
  isInternalFileUrl,
  processSingleFileToUserFile,
} from '@/lib/uploads/utils/file-utils'
import {
  downloadServableFileFromStorage,
  resolveInternalFileUrl,
} from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

type TextractLogger = ReturnType<typeof createLogger>

export interface ResolvedDocument {
  bytes: Buffer
  contentType: string
  isPdf: boolean
}

export type ResolveDocumentResult =
  | { ok: true; document: ResolvedDocument }
  | { ok: false; response: NextResponse }

async function fetchDocumentBytes(
  url: string,
  signal?: AbortSignal
): Promise<{ bytes: Buffer; contentType: string }> {
  signal?.throwIfAborted()
  const urlValidation = await validateUrlWithDNS(url, 'Document URL', 'contentFetch')
  if (!urlValidation.isValid) {
    throw new TextractOperationError(urlValidation.error || 'Invalid document URL', 400)
  }

  const response = await secureFetchWithPinnedIP(url, urlValidation.resolvedIP!, {
    profile: 'contentFetch',
    method: 'GET',
    signal,
  })
  if (!response.ok) {
    await response.text().catch(() => {})
    throw new TextractOperationError(
      `Failed to fetch document: ${response.statusText}`,
      response.status
    )
  }

  const arrayBuffer = await response.arrayBuffer()
  const contentType = response.headers.get('content-type') || 'application/octet-stream'
  return { bytes: Buffer.from(arrayBuffer), contentType }
}

export async function resolveDocumentInput(
  input: { file?: RawFileInput; filePath?: string },
  userId: string,
  requestId: string,
  logger: TextractLogger,
  signal?: AbortSignal
): Promise<ResolveDocumentResult> {
  signal?.throwIfAborted()
  if (input.file) {
    let userFile: ReturnType<typeof processSingleFileToUserFile>
    try {
      userFile = processSingleFileToUserFile(input.file, requestId, logger)
    } catch (error) {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: getErrorMessage(error, 'Failed to process file') },
          { status: 400 }
        ),
      }
    }

    const denied = await assertToolFileAccess(userFile.key, userId, requestId, logger)
    if (denied) return { ok: false, response: denied }
    if (!(await isModelSafeWorkspaceFileKey(userFile.key))) {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE },
          { status: 400 }
        ),
      }
    }

    signal?.throwIfAborted()
    const { buffer, contentType } = await downloadServableFileFromStorage(
      userFile,
      requestId,
      logger,
      { maxBytes: MAX_BUFFERED_TRANSFER_BYTES }
    )
    const resolvedContentType = contentType || userFile.type || 'application/octet-stream'

    return {
      ok: true,
      document: {
        bytes: buffer,
        contentType: resolvedContentType,
        isPdf:
          resolvedContentType.includes('pdf') ||
          Boolean(userFile.name?.toLowerCase().endsWith('.pdf')),
      },
    }
  }

  if (input.filePath) {
    let fileUrl = input.filePath
    const isInternalFilePath = isInternalFileUrl(fileUrl)

    if (isInternalFilePath) {
      const resolution = await resolveInternalFileUrl(fileUrl, userId, requestId, logger)
      if (resolution.error) {
        return {
          ok: false,
          response: NextResponse.json(
            { success: false, error: resolution.error.message },
            { status: resolution.error.status }
          ),
        }
      }
      fileUrl = resolution.fileUrl || fileUrl
      if (!(await isModelSafeWorkspaceFileKey(extractStorageKey(input.filePath)))) {
        return {
          ok: false,
          response: NextResponse.json(
            { success: false, error: MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE },
            { status: 400 }
          ),
        }
      }
    } else if (fileUrl.startsWith('/')) {
      logger.warn(`[${requestId}] Invalid internal path`, {
        userId,
        path: fileUrl.substring(0, 50),
      })
      return {
        ok: false,
        response: NextResponse.json(
          {
            success: false,
            error: 'Invalid file path. Only uploaded files are supported for internal paths.',
          },
          { status: 400 }
        ),
      }
    } else {
      const urlValidation = await validateUrlWithDNS(fileUrl, 'Document URL', 'contentFetch')
      if (!urlValidation.isValid) {
        logger.warn(`[${requestId}] SSRF attempt blocked`, {
          userId,
          url: fileUrl.substring(0, 100),
          error: urlValidation.error,
        })
        return {
          ok: false,
          response: NextResponse.json(
            { success: false, error: urlValidation.error },
            { status: 400 }
          ),
        }
      }
    }

    const fetched = await fetchDocumentBytes(fileUrl, signal)
    return {
      ok: true,
      document: {
        bytes: fetched.bytes,
        contentType: fetched.contentType,
        isPdf: fetched.contentType.includes('pdf') || fileUrl.toLowerCase().endsWith('.pdf'),
      },
    }
  }

  return {
    ok: false,
    response: NextResponse.json(
      { success: false, error: 'Document input is required' },
      { status: 400 }
    ),
  }
}

export function parseS3Uri(s3Uri: string): { bucket: string; key: string } {
  const match = s3Uri.match(/^s3:\/\/([^/]+)\/(.+)$/)
  if (!match) {
    throw new TextractOperationError(
      `Invalid S3 URI format: ${s3Uri}. Expected format: s3://bucket-name/path/to/object`,
      400
    )
  }

  const bucket = match[1]
  const key = match[2]
  const bucketValidation = validateS3BucketName(bucket, 'S3 bucket name')
  if (!bucketValidation.isValid) {
    throw new TextractOperationError(bucketValidation.error || 'Invalid S3 bucket name', 400)
  }
  if (key.includes('..') || key.startsWith('/')) {
    throw new TextractOperationError('S3 key contains invalid path traversal sequences', 400)
  }
  return { bucket, key }
}
