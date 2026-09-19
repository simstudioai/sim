import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import { getServePathPrefix } from '@/lib/uploads'
import {
  type ActiveWorkspaceFileContext,
  ContentVersionConflictError,
  deleteWorkspaceFileVersion as deleteStoredWorkspaceFileVersion,
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  updateWorkspaceFileContent,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import {
  getCurrentWorkspaceFileVersion,
  getWorkspaceFileVersion,
  getWorkspaceFileVersionProvenance,
  queryWorkspaceFileVersions,
  type WorkspaceFileVersionRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-versions'
import { hasObjectNotFoundCause } from '@/lib/uploads/core/errors'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import {
  type DownloadWorkspaceFileStreamResult,
  streamWorkspaceFileRecord,
} from '@/lib/workspace-files/application/download-workspace-file'
import { resolveWorkspaceFileVersionWrite } from '@/lib/workspace-files/application/file-version-write'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import {
  extractWorkspaceFileRecordText,
  type ReadWorkspaceFileTextInput,
  type ReadWorkspaceFileTextResult,
} from '@/lib/workspace-files/application/read-workspace-file-text'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'

const logger = createLogger('WorkspaceFileVersions')

interface FileVersionTarget {
  fileId: string
  assertedWorkspaceId?: string
}

interface FileVersionRef extends FileVersionTarget {
  version: number
}

export interface ListWorkspaceFileVersionsInput extends FileVersionTarget {
  sortOrder: ListSortOrder
  limit: number
  after?: CursorKey[]
}

export interface ListWorkspaceFileVersionsResult {
  versions: WorkspaceFileVersionRecord[]
  nextKeys: CursorKey[] | null
}

export interface ReadWorkspaceFileVersionResult {
  version: WorkspaceFileVersionRecord
}

export type ReadWorkspaceFileVersionTextInput = FileVersionRef &
  Pick<ReadWorkspaceFileTextInput, 'maxBytes' | 'offset' | 'limit'>

export interface ReadWorkspaceFileVersionTextResult extends ReadWorkspaceFileTextResult {
  version: WorkspaceFileVersionRecord
}

export interface DownloadWorkspaceFileVersionResult extends DownloadWorkspaceFileStreamResult {
  version: WorkspaceFileVersionRecord
}

export interface RevertWorkspaceFileVersionInput extends FileVersionRef {
  /** When set, the revert commits only while this is still the file's current version. */
  expectedCurrentVersion?: number
}

export interface RevertWorkspaceFileVersionResult {
  file: WorkspaceFileRecord
  version: WorkspaceFileVersionRecord
  /** False when the requested version was already current and nothing was written. */
  reverted: boolean
  /** The version that was current before the revert. */
  revertedFrom: number
}

async function loadActiveFile(context: ActiveWorkspaceFileContext): Promise<WorkspaceFileRecord> {
  const file = await getWorkspaceFile(context.workspaceId, context.fileId, { throwOnError: true })
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  return file
}

async function loadVersion(
  file: WorkspaceFileRecord,
  version: number
): Promise<WorkspaceFileVersionRecord> {
  const record = await getWorkspaceFileVersion(file, version)
  if (!record) throw new OrchestrationError('not_found', `Version ${version} not found`)
  return record
}

/**
 * Runs a read of a version's stored object, answering 404 when the object is gone — retention or a
 * delete can remove a superseded version between loading its row and reading its bytes.
 */
async function readVersionObject<T>(version: number, read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (hasObjectNotFoundCause(error)) {
      throw new OrchestrationError('not_found', `Version ${version} not found`)
    }
    throw error
  }
}

/**
 * The file as it was at `version`: current name and location, that version's bytes. Rename and move
 * are metadata writes that never create versions, so a version always reads under today's name.
 */
function recordAtVersion(
  file: WorkspaceFileRecord,
  version: WorkspaceFileVersionRecord
): WorkspaceFileRecord {
  if (version.isCurrent) return file
  return {
    ...file,
    key: version.key,
    path: `${getServePathPrefix()}${encodeURIComponent(version.key)}?context=workspace`,
    url: undefined,
    size: version.size,
    type: version.contentType,
  }
}

export const listWorkspaceFileVersions = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.listVersions,
  resolveContext: ({ input }: { input: ListWorkspaceFileVersionsInput }) =>
    resolveActiveWorkspaceFileContext(input),
  async execute({ input, context }): Promise<ListWorkspaceFileVersionsResult> {
    const file = await loadActiveFile(context)
    const { versions, nextKeys } = await queryWorkspaceFileVersions(file, {
      sortOrder: input.sortOrder,
      limit: input.limit,
      after: input.after,
    })
    return { versions, nextKeys }
  },
})

export const readWorkspaceFileVersion = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readVersion,
  resolveContext: ({ input }: { input: FileVersionRef }) =>
    resolveActiveWorkspaceFileContext(input),
  async execute({ input, context }): Promise<ReadWorkspaceFileVersionResult> {
    const file = await loadActiveFile(context)
    return { version: await loadVersion(file, input.version) }
  },
})

export const readWorkspaceFileVersionText = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readVersionContent,
  resolveContext: ({ input }: { input: ReadWorkspaceFileVersionTextInput }) =>
    resolveActiveWorkspaceFileContext(input),
  async execute({
    input,
    context,
    principal,
    request,
  }): Promise<ReadWorkspaceFileVersionTextResult> {
    const file = await loadActiveFile(context)
    const version = await loadVersion(file, input.version)
    const fileAtVersion = recordAtVersion(file, version)
    const result = await readVersionObject(version.version, () =>
      extractWorkspaceFileRecordText(fileAtVersion, input, principal, request?.signal)
    )
    return { ...result, file: fileAtVersion, version }
  },
})

export const downloadWorkspaceFileVersion = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.downloadVersion,
  resolveContext: ({ input }: { input: FileVersionRef }) =>
    resolveActiveWorkspaceFileContext(input),
  async execute({ input, context, principal }): Promise<DownloadWorkspaceFileVersionResult> {
    const file = await loadActiveFile(context)
    const version = await loadVersion(file, input.version)
    const result = await readVersionObject(version.version, () =>
      streamWorkspaceFileRecord(recordAtVersion(file, version), principal)
    )
    return { ...result, file, version }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.FILE_DOWNLOADED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.file.id,
    resourceName: result.file.name,
    description: `Downloaded version ${result.version.version} of file "${result.file.name}"`,
    metadata: {
      fileId: result.file.id,
      fileName: result.file.name,
      version: result.version.version,
      bytes: result.contentLength,
    },
  }),
})

async function executeRevertWorkspaceFileVersion({
  input,
  context,
  principal,
}: {
  input: RevertWorkspaceFileVersionInput
  context: ActiveWorkspaceFileContext
  principal: Principal
}): Promise<RevertWorkspaceFileVersionResult> {
  const file = await loadActiveFile(context)
  const current = await getCurrentWorkspaceFileVersion(file)
  if (
    input.expectedCurrentVersion !== undefined &&
    current.version !== input.expectedCurrentVersion
  ) {
    throw new OrchestrationError(
      'conflict',
      `The current version is ${current.version}, not ${input.expectedCurrentVersion}`
    )
  }
  const target = await loadVersion(file, input.version)
  if (target.isCurrent) {
    return { file, version: target, reverted: false, revertedFrom: current.version }
  }
  if (target.size > MAX_BUFFERED_TRANSFER_BYTES) {
    throw new OrchestrationError(
      'payload_too_large',
      `Version ${target.version} is ${formatFileSize(target.size)}, above the ${formatFileSize(MAX_BUFFERED_TRANSFER_BYTES)} revert limit`
    )
  }

  const [content, provenance] = await Promise.all([
    readVersionObject(target.version, () =>
      fetchWorkspaceFileBuffer(recordAtVersion(file, target), {
        maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
      })
    ),
    getWorkspaceFileVersionProvenance(file.id, target.version),
  ])
  if (!provenance) throw new OrchestrationError('not_found', `Version ${target.version} not found`)
  const attribution = resolvePrincipalAttribution(principal, {
    workspaceBillingOwnerUserId: context.billedAccountUserId,
  })
  let updated: Awaited<ReturnType<typeof updateWorkspaceFileContent>>
  try {
    updated = await updateWorkspaceFileContent(
      context.workspaceId,
      context.fileId,
      attribution.attributedUserId,
      content,
      target.contentType,
      {
        version: resolveWorkspaceFileVersionWrite(principal, {
          source: 'revert',
          restoredFromVersion: target.version,
        }),
        expectedUpdatedAt: file.contentUpdatedAt ?? file.updatedAt,
        secretProvenancePolicy: { mode: 'reinstate', snapshot: provenance },
      }
    )
  } catch (error) {
    if (error instanceof ContentVersionConflictError) {
      throw new OrchestrationError('conflict', error.message)
    }
    throw error
  }

  logger.info('Reverted workspace file to a previous version', {
    workspaceId: context.workspaceId,
    fileId: context.fileId,
    fromVersion: current.version,
    toVersion: target.version,
  })
  return {
    file: updated,
    version: await loadVersion(updated, updated.currentVersion),
    reverted: true,
    revertedFrom: current.version,
  }
}

/**
 * Makes a previous version's bytes current again by writing them as a new version, so the revert is
 * itself undoable. The bytes carry the provenance captured with that version, open editors merge
 * the change, and a content write that races the revert fails it with a conflict.
 */
export const revertWorkspaceFileVersion = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.revertVersion,
  resolveContext: ({ input }: { input: RevertWorkspaceFileVersionInput }) =>
    resolveActiveWorkspaceFileContext(input),
  execute: executeRevertWorkspaceFileVersion,
  projectAudit: ({ input, result }) =>
    result.reverted
      ? {
          action: AuditAction.FILE_REVERTED,
          resourceType: AuditResourceType.FILE,
          resourceId: result.file.id,
          resourceName: result.file.name,
          description: `Reverted file "${result.file.name}" to version ${input.version}`,
          metadata: {
            previousVersion: result.revertedFrom,
            restoredVersion: input.version,
            newVersion: result.version.version,
          },
        }
      : [],
  async afterSuccess({ context, result }) {
    if (result.reverted) await notifyWorkspaceFilesChanged(context.workspaceId)
  },
})

export interface DeleteWorkspaceFileVersionResult {
  file: WorkspaceFileRecord
  version: number
}

/**
 * Permanently deletes one superseded version and its stored bytes — the way to purge content from
 * history before retention would. The current version cannot be deleted: it is the file itself.
 */
export const deleteWorkspaceFileVersion = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.deleteVersion,
  resolveContext: ({ input }: { input: FileVersionRef }) =>
    resolveActiveWorkspaceFileContext(input),
  async execute({ input, context }): Promise<DeleteWorkspaceFileVersionResult> {
    const file = await loadActiveFile(context)
    const target = await loadVersion(file, input.version)
    if (target.isCurrent) {
      throw new OrchestrationError(
        'conflict',
        `Version ${target.version} is the current version and cannot be deleted; revert to another version first`
      )
    }
    const deletion = await deleteStoredWorkspaceFileVersion(
      context.workspaceId,
      context.fileId,
      target.version
    )
    if (deletion === 'not_found') {
      throw new OrchestrationError('not_found', `Version ${target.version} not found`)
    }
    if (deletion === 'newest') {
      throw new OrchestrationError(
        'conflict',
        `Version ${target.version} is the newest recorded version and cannot be deleted`
      )
    }
    return { file, version: target.version }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.FILE_VERSION_DELETED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.file.id,
    resourceName: result.file.name,
    description: `Deleted version ${result.version} of file "${result.file.name}"`,
    metadata: { version: result.version },
  }),
})
