import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { tableJobs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import {
  type V2CreateTableImportBody,
  type V2CreateTableImportData,
  type V2TableImport,
  type V2TableImportSource,
  type V2TableImportTarget,
  v2CreateTableImportBodySchema,
  v2CreateTableImportDataSchema,
  v2TableImportSourceSchema,
  v2TableImportTargetSchema,
} from '@/lib/api/contracts/v2/tables'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { runDetached } from '@/lib/core/utils/background'
import { generateRequestId } from '@/lib/core/utils/request'
import { findActiveFolder } from '@/lib/folders/queries'
import { getWorkspaceTableLimits } from '@/lib/table/billing'
import {
  CSV_DURABLE_MAX_FILE_SIZE_BYTES,
  CSV_DURABLE_MAX_FILE_SIZE_MESSAGE,
} from '@/lib/table/import'
import { runTableImport, type TableImportPayload } from '@/lib/table/import-runner'
import { markTableJobRunningInWorkspace } from '@/lib/table/jobs/service'
import { assertRowDelete, assertRowInsert } from '@/lib/table/mutation-locks'
import { createTable, getTableById } from '@/lib/table/service'
import type { TableImportJobPayload } from '@/lib/table/types'
import { getWorkspaceFile, type WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  abortUploadSession,
  assertUploadSessionAuthBinding,
  type CreatedUploadSession,
  createUploadSession,
  getOwnedUploadSession,
  type UploadSessionRecord,
} from '@/lib/uploads/upload-session/service'
import { getUserSettings } from '@/lib/users/queries'

const logger = createLogger('TableImportResource')

type TableImportStatus = 'uploading' | 'running' | 'ready' | 'failed' | 'canceled' | 'expired'

export type CreateTableImportRequest = V2CreateTableImportBody

export interface TableImportResource {
  id: string
  workspaceId: string
  userId: string
  source: V2TableImportSource
  target: V2TableImportTarget
  options: TableImportJobPayload['options']
  tableId: string | null
  status: TableImportStatus
  rowsProcessed: number
  error: string | null
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
}

export interface CreateTableImportResult {
  record: TableImportResource
  upload: CreatedUploadSession | null
}

interface AuthorizedTableImportResourceParams {
  body: CreateTableImportRequest
  userId: string
  principal?: Principal
  localOrigin?: string
  resolvedFolderId?: string | null
  workspaceFile?: WorkspaceFileRecord
}

async function createTableImportResourceCore(
  params: AuthorizedTableImportResourceParams
): Promise<CreateTableImportResult> {
  const { body, userId, principal, localOrigin, resolvedFolderId, workspaceFile } = params
  await validateTarget(body.workspaceId, body.target, resolvedFolderId)
  const importId = generateId()
  const options = importOptions(body)

  if (body.source.type === 'upload') {
    assertCsvFileName(body.source.name)
    if (body.source.size > CSV_DURABLE_MAX_FILE_SIZE_BYTES) {
      throw new OrchestrationError('validation', CSV_DURABLE_MAX_FILE_SIZE_MESSAGE)
    }
    const upload = await createUploadSession({
      id: importId,
      workspaceId: body.workspaceId,
      userId,
      ...(principal ? { principal } : {}),
      purpose: 'table_import',
      fileName: body.source.name,
      contentType: body.source.contentType,
      fileSize: body.source.size,
      metadata: { tableImport: body, tableImportFolderId: resolvedFolderId ?? null },
      localOrigin,
    })
    return { record: resourceFromUpload(upload, body), upload }
  }

  const file = await requireWorkspaceSource(body.workspaceId, body.source.fileId, workspaceFile)
  assertCsvFileName(file.name)
  return {
    record: await startTableImport({
      id: importId,
      workspaceId: body.workspaceId,
      userId,
      source: body.source,
      target: body.target,
      folderId: resolvedFolderId,
      options,
      fileKey: file.key,
      fileName: file.name,
      storageContext: 'workspace',
      deleteSourceFile: false,
    }),
    upload: null,
  }
}

export async function createAuthorizedTableImportResource(
  params: AuthorizedTableImportResourceParams & { principal: Principal }
): Promise<CreateTableImportResult> {
  return createTableImportResourceCore(params)
}

export async function startUploadedTableImport(
  upload: UploadSessionRecord
): Promise<TableImportResource> {
  const body = tableImportBodyFromUpload(upload)
  const workspaceId = body.workspaceId
  const existing = await findTableImportResource({
    importId: upload.id,
    assertedWorkspaceId: workspaceId,
  })
  if (existing) return existing
  const storedFolderId = upload.metadata.tableImportFolderId
  let folderId: string | null | undefined
  if (body.target.type === 'new') {
    if (storedFolderId !== null && typeof storedFolderId !== 'string') {
      throw new Error('Table import upload is missing its resolved folder target')
    }
    folderId = storedFolderId
  }
  await validateTarget(workspaceId, body.target, folderId)
  return startTableImport({
    id: upload.id,
    workspaceId,
    userId: upload.userId,
    source: body.source,
    target: body.target,
    folderId,
    options: importOptions(body),
    fileKey: upload.storageKey,
    fileName: upload.fileName,
    storageContext: 'table-import',
    deleteSourceFile: true,
  })
}

export async function getPrincipalTableImportUpload(params: {
  importId: string
  assertedWorkspaceId?: string
  principal: Principal
  uploadToken: string
}): Promise<UploadSessionRecord> {
  const upload = await getOwnedUploadSession({
    uploadId: params.importId,
    workspaceId: params.assertedWorkspaceId,
    purpose: 'table_import',
    uploadToken: params.uploadToken,
    principal: params.principal,
  })
  tableImportBodyFromUpload(upload)
  return upload
}

export async function abortAuthorizedTableImportUpload(
  upload: UploadSessionRecord,
  principal: Principal
): Promise<TableImportResource> {
  assertUploadSessionAuthBinding(upload, principal)
  const body = tableImportBodyFromUpload(upload)
  return resourceFromUpload(await abortUploadSession(upload), body)
}

export async function getTableImportResource(params: {
  importId: string
  assertedWorkspaceId?: string
}): Promise<TableImportResource> {
  const record = await findTableImportResource(params)
  if (!record) throw new OrchestrationError('not_found', 'Table import not found')
  return record
}

export async function findTableImportResource(params: {
  importId: string
  assertedWorkspaceId?: string
}): Promise<TableImportResource | null> {
  const [job] = await db
    .select()
    .from(tableJobs)
    .where(
      and(
        eq(tableJobs.id, params.importId),
        eq(tableJobs.type, 'import'),
        params.assertedWorkspaceId === undefined
          ? undefined
          : eq(tableJobs.workspaceId, params.assertedWorkspaceId)
      )
    )
    .limit(1)
  if (!job) return null
  const payload = parseImportJobPayload(job.payload)
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    userId: payload.userId,
    source: v2TableImportSourceSchema.parse(payload.source),
    target: v2TableImportTargetSchema.parse(payload.target),
    options: payload.options,
    tableId: job.tableId,
    status: tableImportStatus(job.status),
    rowsProcessed: job.rowsProcessed,
    error: job.error,
    createdAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  }
}

export async function cancelTableImportResource(
  record: TableImportResource
): Promise<TableImportResource> {
  if (record.status === 'canceled') return record
  if (record.status !== 'running' || !record.tableId) {
    throw new OrchestrationError('conflict', `Table import is ${publicImportStatus(record.status)}`)
  }
  const now = new Date()
  const canceled = await db
    .update(tableJobs)
    .set({ status: 'canceled', completedAt: now, updatedAt: now })
    .where(
      and(
        eq(tableJobs.id, record.id),
        eq(tableJobs.tableId, record.tableId),
        eq(tableJobs.workspaceId, record.workspaceId),
        eq(tableJobs.type, 'import'),
        eq(tableJobs.status, 'running')
      )
    )
    .returning({ id: tableJobs.id })
  if (canceled.length === 0) {
    const current = await getTableImportResource({
      importId: record.id,
      assertedWorkspaceId: record.workspaceId,
    })
    if (current.status === 'canceled') return current
    throw new OrchestrationError(
      'conflict',
      `Table import is ${publicImportStatus(current.status)}`
    )
  }
  return getTableImportResource({
    importId: record.id,
    assertedWorkspaceId: record.workspaceId,
  })
}

export function toV2TableImport(record: TableImportResource): V2TableImport {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    status: publicImportStatus(record.status),
    source: record.source,
    target: record.target,
    tableId: record.tableId,
    rowsProcessed: record.rowsProcessed,
    error: record.error,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
  }
}

export function toV2CreateTableImport(result: CreateTableImportResult): V2CreateTableImportData {
  return v2CreateTableImportDataSchema.parse({
    session: toV2TableImport(result.record),
    uploadToken: result.upload?.uploadToken ?? null,
    transfer: result.upload?.transfer ?? null,
  })
}

interface StartTableImportParams {
  id: string
  workspaceId: string
  userId: string
  source: V2TableImportSource
  target: V2TableImportTarget
  folderId?: string | null
  options: TableImportJobPayload['options']
  fileKey: string
  fileName: string
  storageContext: 'workspace' | 'table-import'
  deleteSourceFile: boolean
}

async function startTableImport(params: StartTableImportParams): Promise<TableImportResource> {
  const requestId = generateRequestId()
  const jobPayload: TableImportJobPayload = {
    kind: 'table_import',
    userId: params.userId,
    source: params.source,
    target: params.target,
    options: params.options,
  }
  let tableId: string | null = null
  try {
    if (params.target.type === 'new') {
      const limits = await getWorkspaceTableLimits(params.workspaceId)
      const table = await createTable(
        {
          name: params.target.name,
          description: `Imported from ${params.fileName}`,
          schema: { columns: [{ name: 'column_1', type: 'string' }] },
          workspaceId: params.workspaceId,
          folderId: params.folderId ?? null,
          userId: params.userId,
          maxTables: limits.maxTables,
          jobStatus: 'running',
          jobType: 'import',
          jobId: params.id,
          jobPayload,
        },
        requestId
      )
      tableId = table.id
    } else {
      const table = await requireExistingTarget(params.workspaceId, params.target)
      tableId = table.id
      if (
        !(await markTableJobRunningInWorkspace(
          tableId,
          params.workspaceId,
          params.id,
          'import',
          jobPayload
        ))
      ) {
        throw new OrchestrationError('conflict', 'A job is already in progress for this table')
      }
    }

    const payload: TableImportPayload = {
      importId: params.id,
      tableId,
      workspaceId: params.workspaceId,
      userId: params.userId,
      fileKey: params.fileKey,
      fileName: params.fileName,
      delimiter: params.fileName.toLowerCase().endsWith('.tsv') ? '\t' : ',',
      mode: params.target.type === 'new' ? 'create' : params.target.mode,
      mapping: params.options.mapping as TableImportPayload['mapping'],
      createColumns: params.options.createColumns,
      deleteSourceFile: params.deleteSourceFile,
      storageContext: params.storageContext,
      timezone: params.options.timezone ?? (await getUserSettings(params.userId)).timezone ?? 'UTC',
    }

    if (isTriggerDevEnabled) {
      const [{ tableImportTask }, { tasks }, { resolveTriggerRegion }] = await Promise.all([
        import('@/background/table-import'),
        import('@trigger.dev/sdk'),
        import('@/lib/core/async-jobs/region'),
      ])
      await tasks.trigger<typeof tableImportTask>('table-import', payload, {
        tags: [`tableId:${tableId}`, `jobId:${params.id}`],
        region: await resolveTriggerRegion(),
      })
    } else {
      runDetached('table-import', () => runTableImport(payload))
    }
    return getTableImportResource({
      importId: params.id,
      assertedWorkspaceId: params.workspaceId,
    })
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to dispatch table import')
    if (tableId) {
      try {
        await markImportFailed({
          tableId,
          workspaceId: params.workspaceId,
          importId: params.id,
          error: message,
        })
      } catch (cleanupError) {
        logger.error('Failed to mark table import dispatch failure', {
          importId: params.id,
          tableId,
          workspaceId: params.workspaceId,
          error: getErrorMessage(cleanupError, 'Unknown cleanup error'),
        })
      }
    }
    if (params.deleteSourceFile) {
      const { deleteFile } = await import('@/lib/uploads/core/storage-service')
      try {
        await deleteFile({ key: params.fileKey, context: params.storageContext })
      } catch (cleanupError) {
        logger.error('Failed to delete table import source after dispatch failure', {
          importId: params.id,
          tableId,
          workspaceId: params.workspaceId,
          storageContext: params.storageContext,
          error: getErrorMessage(cleanupError, 'Unknown cleanup error'),
        })
      }
    }
    throw error
  }
}

function resourceFromUpload(
  upload: UploadSessionRecord,
  body: V2CreateTableImportBody
): TableImportResource {
  return {
    id: upload.id,
    workspaceId: body.workspaceId,
    userId: upload.userId,
    source: body.source,
    target: body.target,
    options: importOptions(body),
    tableId: body.target.type === 'existing' ? body.target.tableId : null,
    status: uploadStatus(upload),
    rowsProcessed: 0,
    error: null,
    createdAt: upload.createdAt,
    updatedAt: upload.updatedAt,
    completedAt: upload.completedAt,
  }
}

export function tableImportBodyFromUpload(upload: UploadSessionRecord): V2CreateTableImportBody {
  if (upload.purpose !== 'table_import' || upload.storageContext !== 'table-import') {
    throw new OrchestrationError('conflict', 'Upload is not a table import')
  }
  const body = v2CreateTableImportBodySchema.parse(upload.metadata.tableImport)
  if (body.workspaceId !== upload.workspaceId || body.source.type !== 'upload') {
    throw new OrchestrationError('conflict', 'Upload token table import metadata does not match')
  }
  return body
}

function importOptions(body: V2CreateTableImportBody): TableImportJobPayload['options'] {
  return {
    ...(body.mapping ? { mapping: body.mapping } : {}),
    ...(body.createColumns ? { createColumns: body.createColumns as string[] } : {}),
    ...(body.timezone ? { timezone: body.timezone } : {}),
  }
}

function parseImportJobPayload(payload: unknown): TableImportJobPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Table import job is missing its payload')
  }
  const candidate = payload as Partial<TableImportJobPayload>
  if (
    candidate.kind !== 'table_import' ||
    typeof candidate.userId !== 'string' ||
    !candidate.options ||
    typeof candidate.options !== 'object'
  ) {
    throw new Error('Table import job has an invalid payload')
  }
  v2TableImportSourceSchema.parse(candidate.source)
  v2TableImportTargetSchema.parse(candidate.target)
  return candidate as TableImportJobPayload
}

async function validateTarget(
  workspaceId: string,
  target: V2TableImportTarget,
  resolvedFolderId?: string | null
): Promise<void> {
  if (target.type === 'new') {
    if (resolvedFolderId && !(await findActiveFolder(resolvedFolderId, workspaceId, 'table'))) {
      throw new OrchestrationError('not_found', 'Folder not found in this workspace')
    }
    return
  }
  await requireExistingTarget(workspaceId, target)
}

async function requireExistingTarget(
  workspaceId: string,
  target: Extract<V2TableImportTarget, { type: 'existing' }>
) {
  const table = await getTableById(target.tableId)
  if (!table || table.workspaceId !== workspaceId) {
    throw new OrchestrationError('not_found', 'Table not found')
  }
  if (table.archivedAt) {
    throw new OrchestrationError('validation', 'Cannot import into an archived table')
  }
  assertRowInsert(table)
  if (target.mode === 'replace') assertRowDelete(table)
  return table
}

async function requireWorkspaceSource(
  workspaceId: string,
  fileId: string,
  file: WorkspaceFileRecord | undefined
): Promise<WorkspaceFileRecord> {
  const resolved = file ?? (await getWorkspaceFile(workspaceId, fileId, { throwOnError: true }))
  if (!resolved || resolved.id !== fileId || resolved.workspaceId !== workspaceId) {
    throw new OrchestrationError('not_found', 'Workspace file not found')
  }
  if (resolved.size > CSV_DURABLE_MAX_FILE_SIZE_BYTES) {
    throw new OrchestrationError('validation', CSV_DURABLE_MAX_FILE_SIZE_MESSAGE)
  }
  return resolved
}

function uploadStatus(upload: UploadSessionRecord): TableImportStatus {
  switch (upload.status) {
    case 'uploading':
    case 'completing':
    case 'finalizing':
    case 'completed':
      return 'uploading'
    case 'aborting':
    case 'aborted':
      return 'canceled'
    case 'failed':
      return 'failed'
    case 'expired':
      return 'expired'
  }
}

async function markImportFailed(params: {
  tableId: string
  workspaceId: string
  importId: string
  error: string
}): Promise<void> {
  const now = new Date()
  await db
    .update(tableJobs)
    .set({
      status: 'failed',
      error: params.error.slice(0, 2000),
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(tableJobs.id, params.importId),
        eq(tableJobs.tableId, params.tableId),
        eq(tableJobs.workspaceId, params.workspaceId),
        eq(tableJobs.type, 'import'),
        eq(tableJobs.status, 'running')
      )
    )
}

function assertCsvFileName(fileName: string): void {
  const normalized = fileName.toLowerCase()
  if (!normalized.endsWith('.csv') && !normalized.endsWith('.tsv')) {
    throw new OrchestrationError('validation', 'Only CSV and TSV files are supported')
  }
}

function tableImportStatus(status: string): TableImportStatus {
  if (status !== 'running' && status !== 'ready' && status !== 'failed' && status !== 'canceled') {
    throw new Error(`Invalid table import job status: ${status}`)
  }
  return status
}

function publicImportStatus(status: TableImportStatus): V2TableImport['status'] {
  if (status === 'running') return 'processing'
  if (status === 'ready') return 'completed'
  return status
}
