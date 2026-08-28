import type { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { NextResponse } from 'next/server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'

type TextractLogger = ReturnType<typeof createLogger>

export class TextractOperationError extends Error {
  status: number

  constructor(message: string, status = 500) {
    super(message)
    this.name = 'TextractOperationError'
    this.status = status
  }
}

export function textractErrorResponse(
  error: unknown,
  requestId: string,
  logger: TextractLogger
): NextResponse {
  const notReady = docNotReadyResponse(error)
  if (notReady) return notReady

  logger.error(`[${requestId}] Error in Textract request:`, error)
  const status = error instanceof TextractOperationError ? error.status : 500
  return NextResponse.json(
    { success: false, error: getErrorMessage(error, 'Internal server error') },
    { status }
  )
}

export function mapTextractSdkError(
  error: unknown,
  isPdf: boolean,
  options?: { hasAsyncMode?: boolean }
): TextractOperationError {
  const sdkError = error as {
    name?: string
    message?: string
    $metadata?: { httpStatusCode?: number }
  }
  const hasAsyncMode = options?.hasAsyncMode ?? true
  const isUnsupportedFormat =
    sdkError.name === 'UnsupportedDocumentException' ||
    Boolean(sdkError.message?.toLowerCase().includes('unsupported document'))

  if (isUnsupportedFormat && isPdf) {
    const hint = hasAsyncMode
      ? ' If this is a multi-page PDF, please use "Multi-Page (PDF, TIFF via S3)" mode instead, which requires uploading your document to S3 first. Single Page mode only supports JPEG, PNG, and single-page PDF files.'
      : ' Only JPEG, PNG, and single-page PDF files are supported.'
    return new TextractOperationError(`This document format is not supported.${hint}`, 400)
  }

  return new TextractOperationError(
    sdkError.message || 'Textract API error',
    sdkError.$metadata?.httpStatusCode ?? 500
  )
}
