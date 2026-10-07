import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { type WorkspaceFileRow, workspaceFiles } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import type {
  ProjectFileAuthorizationContext,
  ProjectFileTarget,
} from '@/lib/projects/files/application/authorization'
import { defineAuthorizedProjectFileUseCase } from '@/lib/projects/files/application/authorized-use-case'
import {
  type ProjectFileOperation,
  projectFileOperations,
} from '@/lib/projects/files/application/operations'
import {
  finishProjectFileWrite,
  mapProjectFileResult,
  prepareProjectFileAccounting,
  recordProjectFileWriteEffects,
} from '@/lib/projects/files/application/write-effects'
import {
  ContentVersionConflictError,
  commitFileContentInTx,
  discardStagedFileContent,
  mapFileRecord,
  type StagedFileContent,
  stageFileContent,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  snapshotWorkspaceFileSecretProvenanceInTx,
  type WorkspaceFileSecretProvenanceSnapshot,
  workspaceFileSecretProvenanceFromSnapshot,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  enqueueWorkspaceFileStorageCleanups,
  processWorkspaceFileStorageCleanupsNow,
} from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'
import {
  deleteWorkspaceFileVersionInTx,
  getCurrentWorkspaceFileVersion,
  getWorkspaceFileVersion,
  getWorkspaceFileVersionProvenance,
  queryWorkspaceFileVersions,
  type WorkspaceFileVersionRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-versions'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { enqueueFileLiveDocReconciliation } from '@/lib/uploads/server/live-doc-outbox'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { isMarkdownFile } from '@/lib/uploads/utils/file-utils'
import { reportWorkspaceFileDelivery } from '@/lib/workspace-files/application/file-delivery-observer'
import { workspaceFileRevisionField } from '@/lib/workspace-files/application/file-revision'
import { resolveWorkspaceFileVersionWrite } from '@/lib/workspace-files/application/file-version-write'
import { projectFileVersionAuthors } from '@/lib/workspace-files/application/version-authors'
import {
  assertFileVersionRevision,
  readFileVersionObject,
} from '@/lib/workspace-files/application/version-content'
import { fileOwnerCondition } from '@/lib/workspace-files/ownership-query'

interface VersionTarget extends ProjectFileTarget {
  fileId: string
  version: number
}
interface RevertInput extends VersionTarget {
  expectedCurrentVersion?: number
  expectedRevision?: string
}
interface VersionArgs<I, P = undefined> {
  principal: Principal
  input: I
  context: ProjectFileAuthorizationContext
  tx: DbTransaction
  prepared?: P
}
interface VersionSnapshot {
  file: WorkspaceFileRow
  current: WorkspaceFileVersionRecord
  version: WorkspaceFileVersionRecord
  provenance: WorkspaceFileSecretProvenanceSnapshot
}
interface PreparedVersionRead {
  snapshot: VersionSnapshot
  content: Buffer
}
interface PreparedRevert {
  snapshot: VersionSnapshot
  staged?: StagedFileContent
}

function requireFile(context: ProjectFileAuthorizationContext) {
  if (!context.file) throw new OrchestrationError('not_found', 'File not found')
  return context.file
}

async function projectVersionAuthor(tx: DbTransaction, version: WorkspaceFileVersionRecord) {
  const [result] = await projectFileVersionAuthors([version], tx)
  return result
}

async function lockFile(tx: DbTransaction, context: ProjectFileAuthorizationContext) {
  const [file] = await tx
    .select()
    .from(workspaceFiles)
    .where(
      and(
        fileOwnerCondition(context.owner),
        eq(workspaceFiles.id, requireFile(context).id),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .for('update')
    .limit(1)
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  return { ...context, file }
}

function versionNumber(version: number) {
  if (!Number.isSafeInteger(version) || version < 1)
    throw new OrchestrationError('validation', 'Invalid file version')
}

async function loadVersion(
  tx: DbTransaction,
  context: ProjectFileAuthorizationContext,
  version: number
) {
  versionNumber(version)
  const file = mapFileRecord(requireFile(context), context.owner, new Map())
  const target = await getWorkspaceFileVersion(file, version, tx)
  if (!target) throw new OrchestrationError('not_found', `Version ${version} not found`)
  return target
}

async function captureVersion(
  tx: DbTransaction,
  context: ProjectFileAuthorizationContext,
  input: RevertInput
): Promise<VersionSnapshot> {
  const file = requireFile(context)
  const mapped = mapFileRecord(file, context.owner, new Map())
  const current = await getCurrentWorkspaceFileVersion(mapped, tx)
  if (
    input.expectedCurrentVersion !== undefined &&
    current.version !== input.expectedCurrentVersion
  )
    throw new OrchestrationError('conflict', 'The current file version changed')
  assertFileVersionRevision(
    file,
    input.expectedRevision,
    'The file changed since the revision you read'
  )
  const version = await loadVersion(tx, context, input.version)
  const provenance = version.isCurrent
    ? await snapshotWorkspaceFileSecretProvenanceInTx(
        tx,
        file.id,
        file.contentUpdatedAt,
        file.secretProvenanceVersion
      )
    : await getWorkspaceFileVersionProvenance(file.id, version.version, version.key, tx)
  if (!provenance) throw new OrchestrationError('not_found', `Version ${version.version} not found`)
  return {
    file,
    current,
    version,
    provenance: provenance.status === null ? { status: 'unknown', entries: [] } : provenance,
  }
}

function snapshotUseCase<const O extends ProjectFileOperation>(operation: O) {
  return defineAuthorizedProjectFileUseCase<O, RevertInput, VersionSnapshot>({
    operation,
    execute: ({ tx, context, input }) => captureVersion(tx, context, input),
  })
}

const snapshotRead = snapshotUseCase(projectFileOperations.readVersionContent)
const snapshotRevert = snapshotUseCase(projectFileOperations.revertVersion)

async function readVersionBytes(
  version: WorkspaceFileVersionRecord,
  maxBytes = MAX_BUFFERED_TRANSFER_BYTES
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BUFFERED_TRANSFER_BYTES)
    throw new OrchestrationError('validation', 'Invalid file byte limit')
  return readFileVersionObject(version.version, () =>
    downloadFile({ key: version.key, context: 'project', maxBytes })
  )
}

function requireVersionMatch(
  current: VersionSnapshot,
  expected: VersionSnapshot,
  requireHead: boolean
) {
  if (
    current.version.key !== expected.version.key ||
    current.version.updatedAt.getTime() !== expected.version.updatedAt.getTime() ||
    (requireHead &&
      (current.file.key !== expected.file.key ||
        current.file.contentUpdatedAt.getTime() !== expected.file.contentUpdatedAt.getTime()))
  )
    throw new OrchestrationError(
      'conflict',
      'The file or selected version changed during the operation'
    )
}

export const listProjectFileVersions = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.listVersions,
  async execute({
    input,
    context,
    tx,
  }: VersionArgs<
    ProjectFileTarget & {
      fileId: string
      sortOrder: ListSortOrder
      limit: number
      after?: CursorKey[]
    }
  >) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 1000)
      throw new OrchestrationError('validation', 'Invalid version page size')
    const page = await queryWorkspaceFileVersions(
      mapFileRecord(requireFile(context), context.owner, new Map()),
      input,
      tx
    )
    return {
      ...page,
      ...workspaceFileRevisionField(requireFile(context)),
      versions: await projectFileVersionAuthors(page.versions, tx),
    }
  },
})

export const readProjectFileVersion = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.readVersion,
  async execute({ input, context, tx }: VersionArgs<VersionTarget>) {
    return {
      version: await projectVersionAuthor(tx, await loadVersion(tx, context, input.version)),
    }
  },
})

export const readProjectFileVersionContent = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.readVersionContent,
  async prepare({
    principal,
    input,
  }: Omit<VersionArgs<VersionTarget & { maxBytes?: number }>, 'tx'>): Promise<PreparedVersionRead> {
    const snapshot = await snapshotRead.execute({ principal, input })
    return { snapshot, content: await readVersionBytes(snapshot.version, input.maxBytes) }
  },
  async execute({
    input,
    context,
    tx,
    prepared,
  }: VersionArgs<VersionTarget & { maxBytes?: number }, PreparedVersionRead>) {
    if (!prepared) throw new Error('Version read was not prepared')
    const current = await captureVersion(tx, context, input)
    requireVersionMatch(current, prepared.snapshot, false)
    return {
      ...(await mapProjectFileResult(tx, context, current.file)),
      version: await projectVersionAuthor(tx, current.version),
      content: prepared.content,
      secretProvenance: workspaceFileSecretProvenanceFromSnapshot(current.provenance),
    }
  },
  afterSuccess: ({ result }) => reportWorkspaceFileDelivery(result.secretProvenance),
})

export const revertProjectFileVersion = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.revertVersion,
  invalidatesFileList: ({ result }) => result.reverted,
  async prepare({
    principal,
    input,
    context,
  }: Omit<VersionArgs<RevertInput>, 'tx'>): Promise<PreparedRevert> {
    const snapshot = await snapshotRevert.execute({ principal, input })
    if (snapshot.version.isCurrent) return { snapshot }
    const content = await readVersionBytes(snapshot.version)
    const staged = await stageFileContent({
      owner: context.owner,
      userId: requirePrincipalSubjectUserId(principal),
      name: snapshot.file.originalName,
      contentType: snapshot.version.contentType,
      content,
    })
    return { snapshot, staged }
  },
  async execute({
    principal,
    input,
    context,
    tx,
    prepared,
  }: VersionArgs<RevertInput, PreparedRevert>) {
    if (!prepared) throw new Error('Revert was not prepared')
    const accounting = prepared.staged ? await prepareProjectFileAccounting(tx, context) : undefined
    const canonical = await lockFile(tx, context)
    const current = await captureVersion(tx, canonical, input)
    requireVersionMatch(current, prepared.snapshot, true)
    if (!prepared.staged || !accounting) {
      return {
        ...(await mapProjectFileResult(tx, canonical, current.file)),
        version: await projectVersionAuthor(tx, current.version),
        reverted: false,
        revertedFrom: current.current.version,
      }
    }
    let committed
    try {
      committed = await commitFileContentInTx(tx, {
        owner: canonical.owner,
        fileId: input.fileId,
        staged: prepared.staged,
        expectedUpdatedAt: prepared.snapshot.file.contentUpdatedAt,
        version: resolveWorkspaceFileVersionWrite(principal, {
          source: 'revert',
          restoredFromVersion: current.version.version,
        }),
        secretProvenancePolicy: { mode: 'reinstate', snapshot: current.provenance },
      })
    } catch (error) {
      if (error instanceof ContentVersionConflictError)
        throw new OrchestrationError('conflict', error.message)
      throw error
    }
    const liveDocEventId =
      isMarkdownFile({ name: current.file.originalName, type: current.file.contentType }) ||
      isMarkdownFile({ name: committed.file.originalName, type: committed.file.contentType })
        ? await enqueueFileLiveDocReconciliation(tx, {
            owner: canonical.owner,
            fileId: input.fileId,
            version: committed.file.contentUpdatedAt.getTime(),
          })
        : undefined
    const usage = await accounting.mutation.applyDelta(committed.sizeDiff)
    const result = {
      ...(await mapProjectFileResult(tx, canonical, committed.file)),
      version: await projectVersionAuthor(
        tx,
        await getCurrentWorkspaceFileVersion(
          mapFileRecord(committed.file, canonical.owner, new Map()),
          tx
        )
      ),
      reverted: true,
      revertedFrom: current.current.version,
    }
    recordProjectFileWriteEffects(result, {
      billing: accounting.billing,
      usage,
      delta: committed.sizeDiff,
      cleanupIds: committed.storageCleanupEventIds,
      liveDocEventId,
    })
    return result
  },
  async onCommitFailure({ prepared }) {
    if (prepared.staged) await discardStagedFileContent(prepared.staged)
  },
  async afterSuccess({ result }) {
    if (result.reverted) await finishProjectFileWrite(result)
  },
  projectAudit: ({ input, result }) =>
    result.reverted
      ? {
          action: AuditAction.FILE_REVERTED,
          resourceType: AuditResourceType.FILE,
          resourceId: result.file.id,
          resourceName: result.file.name,
          description: `Reverted Project file "${result.file.name}"`,
          metadata: {
            projectId: input.projectId,
            previousVersion: result.revertedFrom,
            restoredVersion: input.version,
            newVersion: result.version.version,
          },
        }
      : [],
})

const deletionEffects = new WeakMap<object, string[]>()

export const deleteProjectFileVersion = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.deleteVersion,
  async execute({ input, context, tx }: VersionArgs<VersionTarget>) {
    const canonical = await lockFile(tx, context)
    const version = await loadVersion(tx, canonical, input.version)
    if (version.isCurrent)
      throw new OrchestrationError('conflict', 'The current version cannot be deleted')
    const deletion = await deleteWorkspaceFileVersionInTx(tx, input.fileId, input.version)
    if (deletion.status === 'not_found')
      throw new OrchestrationError('not_found', 'Version not found')
    if (deletion.status === 'newest')
      throw new OrchestrationError('conflict', 'The newest version cannot be deleted')
    const events = await enqueueWorkspaceFileStorageCleanups(tx, [deletion.key], 'project')
    const result = {
      ...(await mapProjectFileResult(tx, canonical, canonical.file)),
      version: version.version,
    }
    deletionEffects.set(result, events)
    return result
  },
  async afterSuccess({ result, input }) {
    const events = deletionEffects.get(result) ?? []
    deletionEffects.delete(result)
    await processWorkspaceFileStorageCleanupsNow(events, {
      projectId: input.projectId,
      fileId: input.fileId,
      reason: 'deleted version',
    })
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.FILE_VERSION_DELETED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.file.id,
    resourceName: result.file.name,
    description: `Deleted version ${result.version} of Project file "${result.file.name}"`,
    metadata: { projectId: input.projectId, version: result.version },
  }),
})
