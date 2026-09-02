import { isUtf8 } from 'node:buffer'
import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  ContentVersionConflictError,
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  updateWorkspaceFileContent as updateStoredWorkspaceFileContent,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'
import {
  applyLineInsertion,
  applyStringReplacement,
  countLines,
  EditContentError,
} from '@/lib/workspace-files/edit-content'
import { MAX_WORKSPACE_FILE_CONTENT_BYTES } from '@/lib/workspace-files/orchestration'

const logger = createLogger('EditWorkspaceFileContent')

/** Seconds a single edit may hold its file. Matches the append path. */
const EDIT_LOCK_SECONDS = 30

export type EditWorkspaceFileContentEdit =
  | { mode: 'replace_string'; oldString: string; newString: string }
  | { mode: 'insert_lines'; afterLine: number; content: string }

export interface EditWorkspaceFileContentInput {
  fileId: string
  assertedWorkspaceId?: string
  edit: EditWorkspaceFileContentEdit
  secretProvenance?: WorkspaceFileSecretProvenance
}

export interface EditWorkspaceFileContentResult {
  file: WorkspaceFileRecord
  /** Lines in the file after the edit, so a caller can re-anchor without re-reading. */
  lineCount: number
}

/**
 * Edits part of a file in place.
 *
 * This is a compound mutation — read, transform, write — so it lives in one
 * application operation rather than being sequenced by each surface. The tool
 * handler and the v2 route are both adapters over it, which is what keeps the
 * uniqueness rule and the concurrency guards from drifting apart.
 *
 * Two guards, because they cover different failures. The advisory lock
 * serializes concurrent edits to one file so two agents do not both read the
 * same text and each write a version missing the other's change; it is
 * best-effort and no-ops without Redis. `expectedUpdatedAt` is the guard that
 * actually holds: the manager compares it under `select ... for update` and
 * refuses a stale write outright. It is deliberately `contentUpdatedAt` and not
 * `updatedAt`, because a rename or a move bumps the latter and would fail an
 * edit that raced nothing.
 */
export const editWorkspaceFileContent = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.updateContent,
  resolveContext: ({ input }: { input: EditWorkspaceFileContentInput }) =>
    resolveActiveWorkspaceFileContext(input),
  async execute({ principal, input, context }): Promise<EditWorkspaceFileContentResult> {
    const lockKey = `file-edit:${context.workspaceId}:${context.fileId}`
    const lockValue = `${Date.now()}-${generateShortId()}`
    /*
     * `reclaimOnFailure` because a throw here means this operation does no work
     * at all: the try/finally that releases the lock has not started, so a
     * Redis timeout after the key was set would strand the file for the full
     * TTL with nothing holding it.
     */
    const acquired = await acquireLock(lockKey, lockValue, EDIT_LOCK_SECONDS, {
      reclaimOnFailure: true,
    })
    if (!acquired) {
      throw new OrchestrationError('locked', 'File is busy, please retry')
    }

    try {
      const file = await getWorkspaceFile(context.workspaceId, context.fileId, {
        throwOnError: true,
      })
      if (!file) throw new OrchestrationError('not_found', 'File not found')
      if (!file.contentUpdatedAt) {
        throw new OrchestrationError(
          'conflict',
          'File has no recorded content version, so it cannot be edited safely'
        )
      }

      /*
       * A file already larger than the edit ceiling throws from storage before
       * anything is read, and an unclassified throw becomes a 500 on a request
       * that is merely too big. The post-edit check below covers the other
       * direction, where an edit grows a file past the same ceiling.
       */
      let buffer: Buffer
      try {
        buffer = await fetchWorkspaceFileBuffer(file, {
          maxBytes: MAX_WORKSPACE_FILE_CONTENT_BYTES,
        })
      } catch (error) {
        if (error instanceof PayloadSizeLimitError) {
          throw new OrchestrationError(
            'payload_too_large',
            `${file.name} is larger than the ${MAX_WORKSPACE_FILE_CONTENT_BYTES / 1024 / 1024}MB in-place edit limit`
          )
        }
        throw error
      }
      /*
       * Editing works on the stored bytes, never on parser-extracted text:
       * extraction is one-way, so writing it back would replace a PDF or a
       * DOCX with a transcript of itself. A file that is not UTF-8 text has no
       * lines to edit, so it is refused rather than silently mangled.
       */
      if (!isUtf8(buffer) || buffer.includes(0)) {
        throw new OrchestrationError(
          'validation',
          `${file.name} is not a text file, so it cannot be edited in place`
        )
      }

      const before = buffer.toString('utf-8')
      let after: string
      try {
        after =
          input.edit.mode === 'replace_string'
            ? applyStringReplacement(before, input.edit.oldString, input.edit.newString)
            : applyLineInsertion(before, input.edit.afterLine, input.edit.content)
      } catch (error) {
        if (error instanceof EditContentError) {
          throw new OrchestrationError(
            error.failure.reason === 'not_found' ? 'not_found' : 'validation',
            error.message
          )
        }
        throw error
      }

      const content = Buffer.from(after, 'utf-8')
      /*
       * The guard above inspects the bytes that were read; this one inspects
       * the bytes about to be written. A NUL inside the caller's replacement
       * text passes the first and would store a file that every later read
       * classifies as binary and refuses to edit again.
       */
      if (content.includes(0)) {
        throw new OrchestrationError(
          'validation',
          'Replacement text cannot contain NUL bytes, which would make the file unreadable as text'
        )
      }
      if (content.length > MAX_WORKSPACE_FILE_CONTENT_BYTES) {
        throw new OrchestrationError(
          'payload_too_large',
          `File size exceeds ${MAX_WORKSPACE_FILE_CONTENT_BYTES / 1024 / 1024}MB limit`
        )
      }

      const attribution = resolvePrincipalAttribution(principal, {
        workspaceBillingOwnerUserId: context.billedAccountUserId,
      })
      let updated: WorkspaceFileRecord
      try {
        updated = await updateStoredWorkspaceFileContent(
          context.workspaceId,
          context.fileId,
          attribution.attributedUserId,
          content,
          file.type,
          {
            expectedUpdatedAt: file.contentUpdatedAt,
            secretProvenancePolicy: input.secretProvenance
              ? { mode: 'replace' as const, provenance: input.secretProvenance }
              : /*
                 * An edit changes part of a file whose other parts keep whatever
                 * provenance they already carried, so the existing record is
                 * preserved rather than replaced with one describing only the
                 * text that just arrived.
                 */
                { mode: 'preserve' as const },
          }
        )
      } catch (error) {
        if (error instanceof ContentVersionConflictError) {
          throw new OrchestrationError('conflict', error.message)
        }
        throw error
      }

      logger.info('Edited workspace file content', {
        workspaceId: context.workspaceId,
        fileId: context.fileId,
        mode: input.edit.mode,
        size: content.length,
        principalKind: principal.kind,
      })
      return { file: updated, lineCount: countLines(after) }
    } finally {
      /*
       * A release failure is never the caller's problem: the edit has either
       * committed or already failed for its own reason, and letting Redis
       * throw here would replace that outcome with an unrelated error. The
       * lock expires on its own.
       */
      try {
        await releaseLock(lockKey, lockValue)
      } catch (error) {
        logger.warn('Failed to release the file edit lock', {
          workspaceId: context.workspaceId,
          fileId: context.fileId,
          error: getErrorMessage(error, 'Unknown error'),
        })
      }
    }
  },
  projectAudit: ({ result }) =>
    ({
      action: AuditAction.FILE_UPDATED,
      resourceType: AuditResourceType.FILE,
      resourceId: result.file.id,
      resourceName: result.file.name,
      description: `Edited content of file "${result.file.name}"`,
      metadata: { contentSize: result.file.size },
    }) as const,
})
