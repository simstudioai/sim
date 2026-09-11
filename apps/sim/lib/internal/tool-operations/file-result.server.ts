import { PrincipalSubjectUserRequiredError, resolvePrincipalSubject } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { assertKnownSizeWithinLimit } from '@/lib/core/utils/stream-limits'
import type {
  InternalToolFile,
  InternalToolFileResult,
  StoredToolFile,
} from '@/lib/internal/tool-operations/file-result'
import { MAX_TOOL_RESPONSE_BODY_BYTES } from '@/lib/internal/tool-operations/response-limits'
import type {
  InternalToolOperationContext,
  InternalToolOperationResult,
} from '@/lib/internal/tool-operations/types'
import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import type { ExecutionContext } from '@/lib/uploads/contexts/execution/utils'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { deleteFileMetadata } from '@/lib/uploads/server/metadata'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { resolveStoredFileMetadata } from '@/lib/uploads/utils/stored-file-metadata'

const logger = createLogger('InternalToolFileResult')

type FileStorageScope =
  | { kind: 'execution'; context: ExecutionContext; userId?: string }
  | { kind: 'copilot'; userId: string }

interface CreatedFile {
  key: string
  context: FileStorageScope['kind']
}

function resolveCopilotUserId(context: InternalToolOperationContext): string {
  const origin = context.executorDelegationOrigin
  const principal = origin?.principal
  const subject = principal ? resolvePrincipalSubject(principal) : null
  if (principal && subject?.kind !== 'sim_user') {
    throw new PrincipalSubjectUserRequiredError(principal.kind)
  }
  const userId =
    subject?.kind === 'sim_user' ? subject.userId : (origin?.subjectUserId ?? context.userId)
  if (!userId?.trim()) throw new Error('Authentication required')
  if (
    (origin?.subjectUserId !== undefined && origin.subjectUserId !== userId) ||
    (context.userId !== undefined && context.userId !== userId)
  ) {
    throw new Error('Tool file owner does not match the authenticated subject')
  }
  return userId
}

function resolveFileStorageScope(context: InternalToolOperationContext): FileStorageScope {
  if (context.executionId) {
    if (!context.workspaceId?.trim() || !context.workflowId.trim() || !context.executionId.trim()) {
      throw new Error('Execution file output requires a complete trusted execution scope')
    }
    return {
      kind: 'execution',
      context: {
        workspaceId: context.workspaceId,
        workflowId: context.workflowId,
        executionId: context.executionId,
      },
      userId: context.userId,
    }
  }
  return { kind: 'copilot', userId: resolveCopilotUserId(context) }
}

function validateFiles(result: InternalToolFileResult): readonly InternalToolFile[] {
  const files = [...new Set(result.files)]
  let totalBytes = 0
  for (const file of files) {
    if (
      !Buffer.isBuffer(file.buffer) ||
      typeof file.name !== 'string' ||
      !file.name.trim() ||
      typeof file.mimeType !== 'string' ||
      !file.mimeType.trim()
    ) {
      throw new Error('Tool file output requires a buffer, filename, and MIME type')
    }
    assertKnownSizeWithinLimit(file.buffer.length, MAX_BUFFERED_TRANSFER_BYTES, 'Tool output file')
    totalBytes += file.buffer.length
    assertKnownSizeWithinLimit(totalBytes, MAX_BUFFERED_TRANSFER_BYTES, 'Tool output files')
  }
  return files
}

/** Rollback must finish even when the operation's signal is already aborted. */
async function rollbackCreatedFiles(files: readonly CreatedFile[]): Promise<void> {
  for (const file of files) {
    try {
      await deleteFile(file)
      await deleteFileMetadata(file.key)
    } catch (error) {
      logger.error('Failed to roll back an unpublished tool output file', {
        key: file.key,
        context: file.context,
        error: getErrorMessage(error),
      })
    }
  }
}

/** Stores file results and rolls back their objects if final presentation fails. */
export async function storeInternalToolFileResult<T>(
  result: InternalToolFileResult,
  context: InternalToolOperationContext,
  finalize: (body: unknown) => T,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted()
  const files = validateFiles(result)
  const scope = resolveFileStorageScope(context)
  const createdFiles: CreatedFile[] = []
  const storedFiles = new Map<InternalToolFile, StoredToolFile>()

  try {
    for (const file of files) {
      signal?.throwIfAborted()
      const metadata = resolveStoredFileMetadata(file.name, file.mimeType, file.buffer)
      const storedFile =
        scope.kind === 'execution'
          ? await uploadExecutionFile(
              scope.context,
              file.buffer,
              metadata.fileName,
              metadata.mimeType,
              scope.userId
            )
          : await uploadCopilotFile({
              buffer: file.buffer,
              fileName: metadata.fileName,
              contentType: metadata.mimeType,
              userId: scope.userId,
            })
      createdFiles.push({ key: storedFile.key, context: scope.kind })
      storedFiles.set(file, { ...storedFile, mimeType: storedFile.type })
      signal?.throwIfAborted()
    }
    const presentedFiles = result.files.map((file) => {
      const storedFile = storedFiles.get(file)
      if (!storedFile) throw new Error('Tool output file was not stored')
      return storedFile
    })
    const output = await finalize(result.present(presentedFiles))
    signal?.throwIfAborted()
    return output
  } catch (error) {
    await rollbackCreatedFiles(createdFiles)
    signal?.throwIfAborted()
    throw error
  }
}

/** Stores trusted in-process file results before their small JSON envelope crosses transport. */
export async function presentInternalToolOperationResult(
  result: InternalToolOperationResult,
  context: InternalToolOperationContext,
  signal?: AbortSignal
): Promise<Response> {
  if (result instanceof Response) return result
  return storeInternalToolFileResult(
    result,
    context,
    (presented) => {
      const body = JSON.stringify(presented)
      if (body === undefined) throw new TypeError('Tool file result must be JSON serializable')
      assertKnownSizeWithinLimit(
        Buffer.byteLength(body, 'utf8'),
        MAX_TOOL_RESPONSE_BODY_BYTES,
        'Tool response body'
      )
      const headers = new Headers(result.init?.headers)
      headers.delete('content-length')
      headers.delete('content-encoding')
      headers.set('content-type', 'application/json')
      return new Response(body, { ...result.init, headers })
    },
    signal
  )
}
