import type { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { NextResponse } from 'next/server'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import { validateS3BucketName } from '@/lib/core/security/input-validation'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import type { RawFileInput } from '@/lib/uploads/utils/file-utils'
import { isInternalFileUrl, processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import {
  downloadServableFileFromStorage,
  resolveInternalFileUrl,
} from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'

type RouteLogger = ReturnType<typeof createLogger>

/** Thrown by AWS SDK call sites so route handlers can map failures to the right HTTP status. */
export class TextractRouteError extends Error {
  status: number

  constructor(message: string, status = 500) {
    super(message)
    this.name = 'TextractRouteError'
    this.status = status
  }
}

export function textractErrorResponse(
  error: unknown,
  requestId: string,
  logger: RouteLogger
): NextResponse {
  const notReady = docNotReadyResponse(error)
  if (notReady) return notReady

  logger.error(`[${requestId}] Error in Textract request:`, error)
  const status = error instanceof TextractRouteError ? error.status : 500
  return NextResponse.json(
    { success: false, error: getErrorMessage(error, 'Internal server error') },
    { status }
  )
}

/**
 * Maps an AWS SDK TextractClient rejection to a client-facing error, with a friendly hint for the
 * common "PDF used in single-page mode" mistake. The real AWS HTTP status (including 5xx) is
 * passed through so the tool-execution layer's retry logic can still treat throttling/internal
 * errors as retryable, matching the pre-migration hand-rolled-signing behavior.
 */
export function mapTextractSdkError(
  error: unknown,
  isPdf: boolean,
  options?: { hasAsyncMode?: boolean }
): TextractRouteError {
  const err = error as {
    name?: string
    message?: string
    $metadata?: { httpStatusCode?: number }
  }
  const hasAsyncMode = options?.hasAsyncMode ?? true

  const isUnsupportedFormat =
    err.name === 'UnsupportedDocumentException' ||
    Boolean(err.message?.toLowerCase().includes('unsupported document'))

  if (isUnsupportedFormat && isPdf) {
    const hint = hasAsyncMode
      ? ' If this is a multi-page PDF, please use "Multi-Page (PDF, TIFF via S3)" mode instead, which requires uploading your document to S3 first. Single Page mode only supports JPEG, PNG, and single-page PDF files.'
      : ' Only JPEG, PNG, and single-page PDF files are supported.'
    return new TextractRouteError(`This document format is not supported.${hint}`, 400)
  }

  const status = err.$metadata?.httpStatusCode || 400
  return new TextractRouteError(err.message || 'Textract API error', status)
}

export interface ResolvedDocument {
  bytes: Buffer
  contentType: string
  isPdf: boolean
}

export type ResolveDocumentResult =
  | { ok: true; document: ResolvedDocument }
  | { ok: false; response: NextResponse }

async function fetchDocumentBytes(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const urlValidation = await validateUrlWithDNS(url, 'Document URL')
  if (!urlValidation.isValid) {
    throw new TextractRouteError(urlValidation.error || 'Invalid document URL', 400)
  }

  const response = await secureFetchWithPinnedIP(url, urlValidation.resolvedIP!, {
    method: 'GET',
  })
  if (!response.ok) {
    await response.text().catch(() => {})
    throw new TextractRouteError(`Failed to fetch document: ${response.statusText}`, 400)
  }

  const arrayBuffer = await response.arrayBuffer()
  const contentType = response.headers.get('content-type') || 'application/octet-stream'

  return { bytes: Buffer.from(arrayBuffer), contentType }
}

/** Resolves a document input (uploaded file reference or URL) to raw bytes for the Textract Document.Bytes field. */
export async function resolveDocumentInput(
  input: { file?: RawFileInput; filePath?: string },
  userId: string,
  requestId: string,
  logger: RouteLogger
): Promise<ResolveDocumentResult> {
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

    const { buffer, contentType } = await downloadServableFileFromStorage(
      userFile,
      requestId,
      logger
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
      const urlValidation = await validateUrlWithDNS(fileUrl, 'Document URL')
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

    const fetched = await fetchDocumentBytes(fileUrl)
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
    throw new TextractRouteError(
      `Invalid S3 URI format: ${s3Uri}. Expected format: s3://bucket-name/path/to/object`,
      400
    )
  }

  const bucket = match[1]
  const key = match[2]

  const bucketValidation = validateS3BucketName(bucket, 'S3 bucket name')
  if (!bucketValidation.isValid) {
    throw new TextractRouteError(bucketValidation.error || 'Invalid S3 bucket name', 400)
  }

  if (key.includes('..') || key.startsWith('/')) {
    throw new TextractRouteError('S3 key contains invalid path traversal sequences', 400)
  }

  return { bucket, key }
}

interface PollableJobResult {
  JobStatus?: string
  StatusMessage?: string
  NextToken?: string
}

/** Polls a started async Textract job (StartDocumentAnalysis/StartDocumentTextDetection/StartExpenseAnalysis) until it completes, following NextToken pagination on success. */
export async function pollTextractJob<TResult extends PollableJobResult>(
  requestId: string,
  logger: RouteLogger,
  getPage: (nextToken?: string) => Promise<TResult>,
  mergePage: (accumulated: TResult, page: TResult) => TResult
): Promise<TResult> {
  const pollIntervalMs = 5000
  const maxPollTimeMs = getMaxExecutionTimeout()
  const maxAttempts = Math.ceil(maxPollTimeMs / pollIntervalMs)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await getPage()
    const jobStatus = result.JobStatus

    if (jobStatus === 'SUCCEEDED' || jobStatus === 'PARTIAL_SUCCESS') {
      if (jobStatus === 'PARTIAL_SUCCESS') {
        logger.warn(`[${requestId}] Job completed with partial success: ${result.StatusMessage}`)
      } else {
        logger.info(`[${requestId}] Async job completed successfully after ${attempt + 1} polls`)
      }

      let merged = result
      let nextToken = result.NextToken
      while (nextToken) {
        const page = await getPage(nextToken)
        merged = mergePage(merged, page)
        nextToken = page.NextToken
      }
      return merged
    }

    if (jobStatus === 'FAILED') {
      throw new TextractRouteError(
        `Textract job failed: ${result.StatusMessage || 'Unknown error'}`,
        502
      )
    }

    logger.info(`[${requestId}] Job status: ${jobStatus}, attempt ${attempt + 1}/${maxAttempts}`)
    await sleep(pollIntervalMs)
  }

  throw new TextractRouteError(
    `Timeout waiting for Textract job to complete (max ${maxPollTimeMs / 1000} seconds)`,
    504
  )
}
