import { db } from '@sim/db'
import { tableImports } from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import {
  type V2CreateTableImportBody,
  type V2TableImport,
  type V2TableImportStatus,
  type V2TableImportTarget,
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
  getTableImport,
  markTrackedImportTerminal,
  type TableImportRecord,
} from '@/lib/table/import-resource-store'
import { runTableImport, type TableImportPayload } from '@/lib/table/import-runner'
import { markJobCanceled, markJobFailed, markTableJobRunning } from '@/lib/table/jobs/service'
import { assertRowDelete, assertRowInsert } from '@/lib/table/mutation-locks'
import { createTable, getTableById } from '@/lib/table/service'
import { getWorkspaceFile, type WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  abortUploadSession,
  createUploadSession,
  getOwnedUploadSession,
  type UploadSessionRecord,
} from '@/lib/uploads/multipart-session/service'
import { getUserSettings } from '@/lib/users/queries'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

interface CreateTableImportResult {
  record: TableImportRecord
  upload: UploadSessionRecord | null
}

export async function createTableImportResource(
  body: V2CreateTableImportBody,
  userId: string
): Promise<CreateTableImportResult> {
  await assertWorkspaceWrite(userId, body.workspaceId)
  await validateTarget(body.workspaceId, body.target)
  const importId = generateId()
  const options = {
    mapping: body.mapping,
    createColumns: body.createColumns,
    timezone: body.timezone,
  }

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
    })
    try {
      const [record] = await db
        .insert(tableImports)
        .values({
          id: importId,
          workspaceId: body.workspaceId,
          userId,
          uploadSessionId: upload.id,
          sourceType: 'upload',
          targetType: body.target.type,
          sourceFileId: null,
          tableId: body.target.type === 'existing' ? body.target.tableId : null,
          source: body.source,
          target: body.target,
          options,
          status: 'uploading',
        })
        .returning()
      if (!record) throw new Error('Table import insert returned no row')
      return { record, upload }
    } catch (error) {
      await abortUploadSession(upload).catch(() => {})
      throw error
    }
  }

  const file = await requireWorkspaceSource(body.workspaceId, body.source.fileId)
  assertCsvFileName(file.name)
  const [record] = await db
    .insert(tableImports)
    .values({
      id: importId,
      workspaceId: body.workspaceId,
      userId,
      uploadSessionId: null,
      sourceFileId: file.id,
      sourceType: 'workspace_file',
      targetType: body.target.type,
      tableId: body.target.type === 'existing' ? body.target.tableId : null,
      source: body.source,
      target: body.target,
      options,
      status: 'queued',
    })
    .returning()
  if (!record) throw new Error('Table import insert returned no row')
  return {
    record: await startTableImport(record, file.key, file.name, 'workspace', false),
    upload: null,
  }
}

export async function startUploadedTableImport(importId: string): Promise<TableImportRecord> {
  const record = await getTableImport(importId)
  if (!record) throw new OrchestrationError('not_found', 'Table import not found')
  if (record.status !== 'uploading') return record
  if (!record.uploadSessionId) throw new Error(`Table import ${importId} has no upload session`)
  const upload = await getOwnedUploadSession({
    uploadId: record.uploadSessionId,
    workspaceId: record.workspaceId,
    userId: record.userId,
  })
  if (upload.status !== 'completed') {
    throw new OrchestrationError('conflict', `Table import upload is ${upload.status}`)
  }
  return startTableImport(record, upload.storageKey, upload.fileName, 'table-import', true)
}

export async function getOwnedTableImport(params: {
  importId: string
  workspaceId: string
  userId: string
}): Promise<TableImportRecord> {
  const [record] = await db
    .select()
    .from(tableImports)
    .where(
      and(
        eq(tableImports.id, params.importId),
        eq(tableImports.workspaceId, params.workspaceId),
        eq(tableImports.userId, params.userId)
      )
    )
    .limit(1)
  if (!record) throw new OrchestrationError('not_found', 'Table import not found')
  return record
}

export async function cancelTableImportResource(
  record: TableImportRecord
): Promise<TableImportRecord> {
  if (record.status === 'canceled') return record
  if (record.status === 'completed' || record.status === 'failed' || record.status === 'expired') {
    throw new OrchestrationError('conflict', `Table import is ${record.status}`)
  }

  if (record.status === 'uploading') {
    if (!record.uploadSessionId) throw new Error(`Table import ${record.id} has no upload session`)
    const upload = await getOwnedUploadSession({
      uploadId: record.uploadSessionId,
      workspaceId: record.workspaceId,
      userId: record.userId,
    })
    await abortUploadSession(upload)
  } else if (record.tableId) {
    await markJobCanceled(record.tableId, record.id)
  }
  await markTrackedImportTerminal({ importId: record.id, status: 'canceled' })
  const updated = await getTableImport(record.id)
  if (!updated) throw new Error(`Canceled table import ${record.id} disappeared`)
  return updated
}

export async function toV2TableImport(record: TableImportRecord): Promise<V2TableImport> {
  const source = v2TableImportSourceSchema.parse(record.source)
  const target = v2TableImportTargetSchema.parse(record.target)
  let upload: V2TableImport['upload'] = null
  if (record.uploadSessionId) {
    const session = await getOwnedUploadSession({
      uploadId: record.uploadSessionId,
      workspaceId: record.workspaceId,
      userId: record.userId,
    })
    upload = {
      partSize: session.partSize,
      partCount: session.partCount,
      expiresAt: session.expiresAt.toISOString(),
    }
  }
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    status: publicImportStatus(record.status),
    source,
    target,
    tableId: record.tableId,
    rowsProcessed: record.rowsProcessed,
    error: record.error,
    upload,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
  }
}

async function startTableImport(
  record: TableImportRecord,
  fileKey: string,
  fileName: string,
  storageContext: 'workspace' | 'table-import',
  deleteSourceFile: boolean
): Promise<TableImportRecord> {
  const [claimed] = await db
    .update(tableImports)
    .set({ status: 'preparing', updatedAt: new Date() })
    .where(and(eq(tableImports.id, record.id), eq(tableImports.status, record.status)))
    .returning()
  if (!claimed) {
    const current = await getTableImport(record.id)
    if (!current) throw new Error(`Table import ${record.id} disappeared while starting`)
    return current
  }

  const target = v2TableImportTargetSchema.parse(claimed.target)
  const options = claimed.options as {
    mapping?: TableImportPayload['mapping']
    createColumns?: string[]
    timezone?: string
  }
  const requestId = generateRequestId()
  let tableId: string | null = null
  try {
    if (target.type === 'new') {
      const limits = await getWorkspaceTableLimits(claimed.workspaceId)
      const table = await createTable(
        {
          name: target.name,
          description: `Imported from ${fileName}`,
          schema: { columns: [{ name: 'column_1', type: 'string' }] },
          workspaceId: claimed.workspaceId,
          folderId: target.folderId ?? null,
          userId: claimed.userId,
          maxTables: limits.maxTables,
          jobStatus: 'running',
          jobType: 'import',
          jobId: claimed.id,
        },
        requestId
      )
      tableId = table.id
    } else {
      const table = await requireExistingTarget(claimed.workspaceId, target)
      tableId = table.id
      if (!(await markTableJobRunning(tableId, claimed.id, 'import'))) {
        throw new OrchestrationError('conflict', 'A job is already in progress for this table')
      }
    }

    const [queued] = await db
      .update(tableImports)
      .set({ tableId, status: 'queued', updatedAt: new Date() })
      .where(and(eq(tableImports.id, claimed.id), eq(tableImports.status, 'preparing')))
      .returning()
    if (!queued)
      throw new OrchestrationError('conflict', 'Table import was canceled while starting')

    const payload: TableImportPayload = {
      importId: claimed.id,
      tableId,
      workspaceId: claimed.workspaceId,
      userId: claimed.userId,
      fileKey,
      fileName,
      delimiter: fileName.toLowerCase().endsWith('.tsv') ? '\t' : ',',
      mode: target.type === 'new' ? 'create' : target.mode,
      mapping: options.mapping,
      createColumns: options.createColumns,
      deleteSourceFile,
      storageContext,
      trackImportResource: true,
      timezone: options.timezone ?? (await getUserSettings(claimed.userId)).timezone ?? 'UTC',
    }

    if (isTriggerDevEnabled) {
      const [{ tableImportTask }, { tasks }, { resolveTriggerRegion }] = await Promise.all([
        import('@/background/table-import'),
        import('@trigger.dev/sdk'),
        import('@/lib/core/async-jobs/region'),
      ])
      await tasks.trigger<typeof tableImportTask>('table-import', payload, {
        tags: [`tableId:${tableId}`, `jobId:${claimed.id}`],
        region: await resolveTriggerRegion(),
      })
    } else {
      runDetached('table-import', () => runTableImport(payload))
    }
    return queued
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to dispatch table import')
    if (tableId) await markJobFailed(tableId, claimed.id, message).catch(() => {})
    await markTrackedImportTerminal({ importId: claimed.id, status: 'failed', error: message })
    if (deleteSourceFile) {
      const { deleteFile } = await import('@/lib/uploads/core/storage-service')
      await deleteFile({ key: fileKey, context: storageContext }).catch(() => {})
    }
    throw error
  }
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
  if (table.archivedAt)
    throw new OrchestrationError('validation', 'Cannot import into an archived table')
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

function publicImportStatus(status: string): V2TableImportStatus {
  if (status === 'preparing') return 'queued'
  if (
    status !== 'uploading' &&
    status !== 'queued' &&
    status !== 'processing' &&
    status !== 'completed' &&
    status !== 'failed' &&
    status !== 'canceled' &&
    status !== 'expired'
  ) {
    throw new Error(`Invalid table import status: ${status}`)
  }
  return status
}
