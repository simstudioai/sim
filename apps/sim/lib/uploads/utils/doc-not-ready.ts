import { DocCompileUserError } from '@/lib/copilot/tools/server/files/doc-compile-error'

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
