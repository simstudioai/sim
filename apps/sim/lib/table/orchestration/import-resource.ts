import { db } from '@sim/db'
import { tableJobs } from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import {
  type V2CreateTableImportBody,
  type V2TableImport,
  type V2TableImportSource,
  type V2TableImportTarget,
  v2CreateTableImportBodySchema,
  v2TableImportSourceSchema,
  v2TableImportTargetSchema,
} from '@/lib/api/contracts/v2/tables'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { runDetached } from '@/lib/core/utils/background'
import { generateRequestId } from '@/lib/core/utils/request'
import { findActiveFolder } from '@/lib/folders/queries'
import { getWorkspaceTableLimits } from '@/lib/table/billing'
import { runTableImport, type TableImportPayload } from '@/lib/table/import-runner'
import { markJobCanceled, markJobFailed, markTableJobRunning } from '@/lib/table/jobs/service'
import { assertRowDelete, assertRowInsert } from '@/lib/table/mutation-locks'
import { createTable, getTableById } from '@/lib/table/service'
import type { TableImportJobPayload } from '@/lib/table/types'
import { getWorkspaceFile, type WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  abortUploadSession,
  createUploadSession,
  getOwnedUploadSession,
  type UploadSessionRecord,
} from '@/lib/uploads/multipart-session/service'
import { getUserSettings } from '@/lib/users/queries'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

type TableImportStatus = 'uploading' | 'running' | 'ready' | 'failed' | 'canceled'

interface TableImportResource {
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
  upload: UploadSessionRecord | null
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
}

interface CreateTableImportResult {
  record: TableImportResource
  upload: UploadSessionRecord | null
}

export async function createTableImportResource(
  body: V2CreateTableImportBody,
  userId: string
): Promise<CreateTableImportResult> {
  await assertWorkspaceWrite(userId, body.workspaceId)
  await validateTarget(body.workspaceId, body.target)
  const importId = generateId()
  const options = importOptions(body)

  if (body.source.type === 'upload') {
    assertCsvFileName(body.source.name)
    const upload = await createUploadSession({
      id: importId,
      workspaceId: body.workspaceId,
      userId,
      purpose: 'table_import',
      fileName: body.source.name,
      contentType: body.source.contentType,
      fileSize: body.source.size,
      metadata: { tableImport: body },
    })
    return { record: resourceFromUpload(upload, body), upload }
  }

  const file = await requireWorkspaceSource(body.workspaceId, body.source.fileId)
  assertCsvFileName(file.name)
  return {
    record: await startTableImport({
      id: importId,
      workspaceId: body.workspaceId,
      userId,
      source: body.source,
      target: body.target,
      options,
      fileKey: file.key,
      fileName: file.name,
      storageContext: 'workspace',
      deleteSourceFile: false,
    }),
    upload: null,
  }
}

export async function startUploadedTableImport(
  upload: UploadSessionRecord
): Promise<TableImportResource> {
  const body = tableImportBodyFromUpload(upload)
  const existing = await findOwnedTableImport({
    importId: upload.id,
    workspaceId: upload.workspaceId,
    userId: upload.userId,
  })
  if (existing) return existing
  return startTableImport({
    id: upload.id,
    workspaceId: upload.workspaceId,
    userId: upload.userId,
    source: body.source,
    target: body.target,
    options: importOptions(body),
    fileKey: upload.storageKey,
    fileName: upload.fileName,
    storageContext: 'table-import',
    deleteSourceFile: true,
  })
}

export function getOwnedTableImportUpload(params: {
  importId: string
  workspaceId: string
  userId: string
  uploadToken: string
}): UploadSessionRecord {
  const upload = getOwnedUploadSession({
    uploadId: params.importId,
    workspaceId: params.workspaceId,
    userId: params.userId,
    purpose: 'table_import',
    uploadToken: params.uploadToken,
  })
  tableImportBodyFromUpload(upload)
  return upload
}

export async function abortTableImportUpload(params: {
  importId: string
  workspaceId: string
  userId: string
  uploadToken: string
}): Promise<TableImportResource> {
  const upload = getOwnedTableImportUpload(params)
  const body = tableImportBodyFromUpload(upload)
  return resourceFromUpload(await abortUploadSession(upload), body)
}

export async function getOwnedTableImport(params: {
  importId: string
  workspaceId: string
  userId: string
}): Promise<TableImportResource> {
  const record = await findOwnedTableImport(params)
  if (!record) throw new OrchestrationError('not_found', 'Table import not found')
  return record
}

export async function findOwnedTableImport(params: {
  importId: string
  workspaceId: string
  userId: string
}): Promise<TableImportResource | null> {
  const [job] = await db
    .select()
    .from(tableJobs)
    .where(
      and(
        eq(tableJobs.id, params.importId),
        eq(tableJobs.workspaceId, params.workspaceId),
        eq(tableJobs.type, 'import')
      )
    )
    .limit(1)
  if (!job) return null
  const payload = parseImportJobPayload(job.payload)
  if (payload.userId !== params.userId) return null
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
    upload: null,
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
  await markJobCanceled(record.tableId, record.id)
  return getOwnedTableImport({
    importId: record.id,
    workspaceId: record.workspaceId,
    userId: record.userId,
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
    upload: record.upload
      ? {
          uploadToken: record.upload.uploadToken,
          partSize: record.upload.partSize,
          partCount: record.upload.partCount,
          expiresAt: record.upload.expiresAt.toISOString(),
        }
      : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
  }
}

interface StartTableImportParams {
  id: string
  workspaceId: string
  userId: string
  source: V2TableImportSource
  target: V2TableImportTarget
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
          folderId: params.target.folderId ?? null,
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
      if (!(await markTableJobRunning(tableId, params.id, 'import', jobPayload))) {
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
    return getOwnedTableImport({
      importId: params.id,
      workspaceId: params.workspaceId,
      userId: params.userId,
    })
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to dispatch table import')
    if (tableId) await markJobFailed(tableId, params.id, message).catch(() => {})
    if (params.deleteSourceFile) {
      const { deleteFile } = await import('@/lib/uploads/core/storage-service')
      await deleteFile({ key: params.fileKey, context: params.storageContext }).catch(() => {})
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
    workspaceId: upload.workspaceId,
    userId: upload.userId,
    source: body.source,
    target: body.target,
    options: importOptions(body),
    tableId: body.target.type === 'existing' ? body.target.tableId : null,
    status: upload.status === 'aborted' ? 'canceled' : 'uploading',
    rowsProcessed: 0,
    error: null,
    upload,
    createdAt: upload.createdAt,
    updatedAt: upload.updatedAt,
    completedAt: upload.completedAt,
  }
}

function tableImportBodyFromUpload(upload: UploadSessionRecord): V2CreateTableImportBody {
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

async function validateTarget(workspaceId: string, target: V2TableImportTarget): Promise<void> {
  if (target.type === 'new') {
    if (target.folderId && !(await findActiveFolder(target.folderId, workspaceId, 'table'))) {
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
  fileId: string
): Promise<WorkspaceFileRecord> {
  const file = await getWorkspaceFile(workspaceId, fileId, { throwOnError: true })
  if (!file) throw new OrchestrationError('not_found', 'Workspace file not found')
  return file
}

async function assertWorkspaceWrite(userId: string, workspaceId: string): Promise<void> {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (permission !== 'write' && permission !== 'admin') {
    throw new OrchestrationError('forbidden', 'Access denied')
  }
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
