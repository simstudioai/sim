import { NextResponse } from 'next/server'
import { DocCompileUserError } from '@/lib/copilot/tools/server/files/doc-compile'

/**
 * Canonical retryable response for an attachment/upload whose generated-document
 * artifact is still compiling. Returns the 409 when `error` is a
 * {@link DocCompileUserError} (thrown by `downloadServableFileFromStorage`),
 * otherwise `null` so the caller falls through to its own error handling. Shared
 * by every tool route that downloads workspace files so the status, body shape,
 * and user-facing copy stay identical instead of being re-typed per route.
 */
export function docNotReadyResponse(error: unknown): NextResponse | null {
  if (error instanceof DocCompileUserError) {
    return NextResponse.json(
      {
        success: false,
        error: 'A document is still being generated. Wait for it to finish, then try again.',
      },
      { status: 409 }
    )
  }
  return null
}
