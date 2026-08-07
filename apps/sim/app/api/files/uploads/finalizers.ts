import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import type { V2File } from '@/lib/api/contracts/v2/files'
import { captureServerEvent } from '@/lib/posthog/server'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import { getServeStoragePrefix } from '@/lib/uploads/config'
import {
  getWorkspaceFile,
  registerUploadedWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import { type StorageContext, toLegacyWorkspaceFileSize } from '@/lib/uploads/shared/types'
import { UploadSessionError, type UploadSessionRecord } from '@/lib/uploads/upload-session/service'
import { toV2File } from '@/app/api/v2/files/utils'

export interface UploadActor {
  id: string
  name?: string | null
  email?: string | null
}

export interface StoredUploadResult {
  path: string
  key: string
  name: string
  size: number
  type: string
}

export interface ExecutionUploadResult {
  id: string
  name: string
  url: string
  size: number
  type: string
  key: string
  context: 'execution'
}

export type UploadPurposeResult = V2File | StoredUploadResult | ExecutionUploadResult

interface FinalizedWorkspaceFile {
  file: WorkspaceFileRecord
  created: boolean
}

interface FinalizeUploadPurposeParams {
  session: UploadSessionRecord
  actor: UploadActor
  request: NextRequest
}

interface FinalizedUploadPurpose {
  value: UploadPurposeResult
  completedFileId?: string
}

interface FinalizedMetadataInput {
  key: string
  userId: string
  workspaceId: string
  context: StorageContext
  originalName: string
  contentType: string
  size: number
}

type FileMetadataRecord = typeof workspaceFiles.$inferSelect

/**
 * Finalizes the domain resource represented by a verified upload object.
 * Metadata-backed purposes use the storage key as their idempotency identity.
 */
export async function finalizeUploadPurpose({
  session,
  actor,
  request,
}: FinalizeUploadPurposeParams): Promise<FinalizedUploadPurpose> {
  switch (session.purpose) {
    case 'workspace_file':
      return finalizeInternalWorkspaceFile(session, actor, request)
    case 'profile_picture':
      return { value: storedAssetResult(session, 'profile-pictures') }
    case 'workspace_logo':
      return finalizeWorkspaceLogo(session, actor, request)
    case 'mothership_attachment':
      return finalizeMothershipAttachment(session)
    case 'execution_attachment':
      return finalizeExecutionAttachment(session)
    case 'table_import':
    case 'knowledge_document':
      throw new UploadSessionError(
        'validation',
        `Purpose ${session.purpose} is not finalized by the internal files route`
      )
  }
}

async function finalizeInternalWorkspaceFile(
  session: UploadSessionRecord,
  actor: UploadActor,
  request: NextRequest
): Promise<FinalizedUploadPurpose> {
  const finalized = await finalizeWorkspaceFileUpload({ session, actor, request, source: 'ui' })
  return {
    value: await toV2File(finalized.file),
    completedFileId: finalized.file.id,
  }
}

/**
 * Registers a verified workspace object and emits its one-time domain side effects.
 * The metadata insert winner is the only caller that notifies, audits, or records analytics.
 */
export async function finalizeWorkspaceFileUpload(params: {
  session: UploadSessionRecord
  actor: UploadActor
  request: NextRequest
  source: 'api' | 'ui'
}): Promise<FinalizedWorkspaceFile> {
  const { session, actor, request, source } = params
  const workspaceId = requireWorkspaceId(session)
  const metadata = session.metadata as { folderId?: string | null }
  const registered = await registerUploadedWorkspaceFile({
    workspaceId,
    userId: actor.id,
    key: session.storageKey,
    originalName: session.fileName,
    contentType: session.contentType,
    folderId: metadata.folderId,
  })
  const file = await getWorkspaceFile(workspaceId, registered.file.id, {
    includeDeleted: true,
    throwOnError: true,
  })
  if (!file) {
    throw new Error(`Completed workspace file ${registered.file.id} not found`)
  }
  if (file.deletedAt) {
    throw new UploadSessionError('conflict', 'Upload result was deleted')
  }
  if (registered.created) {
    await notifyWorkspaceFilesChanged(workspaceId)
    captureServerEvent(
      actor.id,
      'file_uploaded',
      { workspace_id: workspaceId, file_type: session.contentType },
      { groups: { workspace: workspaceId } }
    )
    recordAudit({
      workspaceId,
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      action: AuditAction.FILE_UPLOADED,
      resourceType: AuditResourceType.FILE,
      resourceId: file.id,
      resourceName: file.name,
      description: `Uploaded file "${file.name}"${source === 'api' ? ' via API' : ''}`,
      metadata: { fileSize: file.size, fileType: file.type },
      request,
    })
  }
  return { file, created: registered.created }
}

async function finalizeWorkspaceLogo(
  session: UploadSessionRecord,
  actor: UploadActor,
  request: NextRequest
): Promise<FinalizedUploadPurpose> {
  const workspaceId = requireWorkspaceId(session)
  const finalized = await insertOrLoadFileMetadata({
    key: session.storageKey,
    userId: session.userId,
    workspaceId,
    context: 'workspace-logos',
    originalName: session.fileName,
    contentType: session.contentType,
    size: session.fileSize,
  })

  if (finalized.created) {
    recordAudit({
      workspaceId,
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      action: AuditAction.FILE_UPLOADED,
      resourceType: AuditResourceType.WORKSPACE,
      resourceId: workspaceId,
      description: `Uploaded workspace logo "${session.fileName}"`,
      metadata: {
        fileName: session.fileName,
        fileKey: session.storageKey,
        fileSize: session.fileSize,
        fileType: session.contentType,
      },
      request,
    })
    captureServerEvent(actor.id, 'workspace_logo_uploaded', {
      workspace_id: workspaceId,
      file_name: session.fileName,
      file_size: session.fileSize,
    })
  }

  return { value: storedAssetResult(session, 'workspace-logos') }
}

async function finalizeMothershipAttachment(
  session: UploadSessionRecord
): Promise<FinalizedUploadPurpose> {
  const workspaceId = requireWorkspaceId(session)
  await insertOrLoadFileMetadata({
    key: session.storageKey,
    userId: session.userId,
    workspaceId,
    context: 'mothership',
    originalName: session.fileName,
    contentType: session.contentType,
    size: session.fileSize,
  })
  return {
    value: storedAssetResult(session, 'mothership'),
  }
}

async function finalizeExecutionAttachment(
  session: UploadSessionRecord
): Promise<FinalizedUploadPurpose> {
  const workspaceId = requireWorkspaceId(session)
  const finalized = await insertOrLoadFileMetadata({
    key: session.storageKey,
    userId: session.userId,
    workspaceId,
    context: 'execution',
    originalName: session.fileName,
    contentType: session.contentType,
    size: session.fileSize,
  })
  return {
    value: {
      id: finalized.file.id,
      name: session.fileName,
      url: servePath(session.storageKey, 'execution'),
      size: session.fileSize,
      type: session.contentType,
      key: session.storageKey,
      context: 'execution',
    },
    completedFileId: finalized.file.id,
  }
}

async function insertOrLoadFileMetadata(
  input: FinalizedMetadataInput
): Promise<{ file: FileMetadataRecord; created: boolean }> {
  const existing = await findFileMetadataByKey(input.key)
  if (existing) {
    assertMatchingMetadata(existing, input)
    assertActiveFileMetadata(existing)
    return { file: existing, created: false }
  }

  const now = new Date()
  const [inserted] = await db
    .insert(workspaceFiles)
    .values({
      id: generateId(),
      key: input.key,
      userId: input.userId,
      workspaceId: input.workspaceId,
      context: input.context,
      originalName: input.originalName,
      displayName: input.originalName,
      contentType: input.contentType,
      size: toLegacyWorkspaceFileSize(input.size),
      sizeBytes: input.size,
      deletedAt: null,
      uploadedAt: now,
      updatedAt: now,
      contentUpdatedAt: now,
    })
    .onConflictDoNothing()
    .returning()

  if (inserted) return { file: inserted, created: true }

  const raceWinner = await findFileMetadataByKey(input.key)
  if (!raceWinner) {
    throw new UploadSessionError('conflict', `Storage key ${input.key} could not be registered`)
  }
  assertMatchingMetadata(raceWinner, input)
  assertActiveFileMetadata(raceWinner)
  return { file: raceWinner, created: false }
}

async function findFileMetadataByKey(key: string): Promise<FileMetadataRecord | undefined> {
  const [file] = await db
    .select()
    .from(workspaceFiles)
    .where(eq(workspaceFiles.key, key))
    .orderBy(sql`${workspaceFiles.deletedAt} IS NULL DESC`)
    .limit(1)
  return file
}

function assertMatchingMetadata(existing: FileMetadataRecord, input: FinalizedMetadataInput): void {
  const existingSize = existing.sizeBytes ?? existing.size
  if (
    existing.key !== input.key ||
    existing.userId !== input.userId ||
    existing.workspaceId !== input.workspaceId ||
    existing.context !== input.context ||
    existing.originalName !== input.originalName ||
    existing.contentType !== input.contentType ||
    existingSize !== input.size
  ) {
    throw new UploadSessionError(
      'conflict',
      `Storage key ${input.key} belongs to a different upload`
    )
  }
}

function assertActiveFileMetadata(file: FileMetadataRecord): void {
  if (file.deletedAt) {
    throw new UploadSessionError('conflict', 'Upload result was deleted')
  }
}

function servePath(key: string, context: StorageContext): string {
  return `/api/files/serve/${getServeStoragePrefix()}/${encodeURIComponent(key)}?context=${context}`
}

function storedAssetResult(
  session: UploadSessionRecord,
  context: 'profile-pictures' | 'workspace-logos' | 'mothership'
): StoredUploadResult {
  return {
    path: servePath(session.storageKey, context),
    key: session.storageKey,
    name: session.fileName,
    size: session.fileSize,
    type: session.contentType,
  }
}

function requireWorkspaceId(session: UploadSessionRecord): string {
  if (!session.workspaceId) {
    throw new UploadSessionError(
      'forbidden',
      `Upload session ${session.id} is missing its workspace scope`
    )
  }
  return session.workspaceId
}
