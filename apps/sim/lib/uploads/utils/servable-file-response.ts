import { NextResponse } from 'next/server'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'

/**
 * Canonical retryable response for an attachment/upload whose generated-document
 * artifact is still compiling. Returns the 409 when `error` is a
 * `DocCompileUserError` (thrown by `downloadServableFileFromStorage`), otherwise
 * `null` so the caller falls through to its own error handling. Shared by every
 * tool route that downloads workspace files so the status, body shape, and
 * user-facing copy stay identical instead of being re-typed per route.
 *
 * Routes whose error envelope differs, or that resolved a batch and want the pending
 * files named, build the 409 themselves from `docNotReadyMessage`. Non-route callers
 * import those two helpers from `@/lib/uploads/utils/doc-not-ready` directly, which
 * carries no `next/server` dependency.
 */
export function docNotReadyResponse(error: unknown): NextResponse | null {
  if (isDocNotReadyError(error)) {
    return NextResponse.json({ success: false, error: docNotReadyMessage() }, { status: 409 })
  }
  return null
}
