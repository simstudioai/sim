import { NextResponse } from 'next/server'
import { DocCompileUserError } from '@/lib/copilot/tools/server/files/doc-compile'

/** True when `error` means a generated document's artifact is still compiling. */
export function isDocNotReadyError(error: unknown): error is DocCompileUserError {
  return error instanceof DocCompileUserError
}

/**
 * Message for a still-compiling generated document. Batch callers pass the names
 * they resolved so the copy says which documents to wait on.
 */
export function docNotReadyMessage(fileNames?: string[]): string {
  if (!fileNames || fileNames.length === 0) {
    return 'A document is still being generated. Wait for it to finish, then try again.'
  }
  const subject = fileNames.length === 1 ? 'A document is' : `${fileNames.length} documents are`
  return `${subject} still being generated: ${fileNames.join(', ')}. Wait for them to finish, then try again.`
}

/**
 * Canonical retryable response for an attachment/upload whose generated-document
 * artifact is still compiling. Returns the 409 when `error` is a
 * {@link DocCompileUserError} (thrown by `downloadServableFileFromStorage`),
 * otherwise `null` so the caller falls through to its own error handling. Shared
 * by every tool route that downloads workspace files so the status, body shape,
 * and user-facing copy stay identical instead of being re-typed per route.
 *
 * Routes whose error envelope differs, or that resolved a batch and want the pending
 * files named, build the 409 themselves from {@link docNotReadyMessage}.
 */
export function docNotReadyResponse(error: unknown): NextResponse | null {
  if (isDocNotReadyError(error)) {
    return NextResponse.json({ success: false, error: docNotReadyMessage() }, { status: 409 })
  }
  return null
}
