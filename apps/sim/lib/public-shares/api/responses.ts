import { NextResponse } from 'next/server'
import {
  asOrchestrationError,
  messageForOrchestrationError,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'

/** Keep the public cookie endpoints' existing error envelope and retry header. */
export function publicFileAuthDenied(result: {
  error?: string
  status?: number
  retryAfterMs?: number
}) {
  const response = NextResponse.json(
    { error: result.error ?? 'auth_required_password' },
    { status: result.status ?? 401 }
  )
  if (result.status === 429 && result.retryAfterMs !== undefined)
    response.headers.set('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)))
  return response
}

function classifyPublicFileError(error: unknown, fallback: string) {
  const classified = asOrchestrationError(error)
  return {
    code: classified?.code,
    status: statusForOrchestrationError(classified?.code),
    message:
      classified?.code === 'not_found'
        ? 'Not found'
        : messageForOrchestrationError(
            { errorCode: classified?.code, error: classified?.message },
            fallback
          ),
  }
}

/** Conceal unavailable targets and driver failures while preserving classified domain failures. */
export function publicFileErrorResponse(error: unknown, fallback: string) {
  const result = classifyPublicFileError(error, fallback)
  return NextResponse.json({ error: result.message }, { status: result.status })
}

/** Binary URLs retain the legacy file-error envelope; pending artifacts use their existing challenge. */
export function publicFileBinaryErrorResponse(error: unknown, fallback: string) {
  const result = classifyPublicFileError(error, fallback)
  if (result.code === 'conflict')
    return NextResponse.json({ error: result.message }, { status: result.status })
  const name =
    result.code === 'not_found'
      ? 'FileNotFoundError'
      : result.code === 'payload_too_large'
        ? 'PayloadSizeLimitError'
        : 'Error'
  return NextResponse.json({ error: name, message: result.message }, { status: result.status })
}
