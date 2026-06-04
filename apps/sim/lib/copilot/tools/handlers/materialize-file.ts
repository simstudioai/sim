import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workflow, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { findMothershipUploadRowByChatAndName } from '@/lib/copilot/tools/handlers/upload-file-reader'
import {
  batchInsertRows,
  CSV_MAX_BATCH_SIZE,
  coerceRowsForTable,
  createTable,
  deleteTable,
  getWorkspaceTableLimits,
  inferSchemaFromCsv,
  parseFileRows,
  sanitizeName,
  TABLE_LIMITS,
  type TableSchema,
} from '@/lib/table'
import { getServePathPrefix } from '@/lib/uploads'
import { fetchWorkspaceFileBuffer } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { parseWorkflowJson } from '@/lib/workflows/operations/import-export'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { deduplicateWorkflowName } from '@/lib/workflows/utils'
import { extractWorkflowMetadata } from '@/app/api/v1/admin/types'

const logger = createLogger('MaterializeFile')

function toFileRecord(row: typeof workspaceFiles.$inferSelect) {
  const pathPrefix = getServePathPrefix()
  return {
    id: row.id,
    workspaceId: row.workspaceId || '',
    name: row.displayName ?? row.originalName,
    key: row.key,
    path: `${pathPrefix}${encodeURIComponent(row.key)}?context=mothership`,
    size: row.size,
    type: row.contentType,
    uploadedBy: row.userId,
    deletedAt: row.deletedAt,
    uploadedAt: row.uploadedAt,
    updatedAt: row.updatedAt,
    storageContext: 'mothership' as const,
  }
}

async function executeSave(fileName: string, chatId: string): Promise<ToolCallResult> {
  const row = await findMothershipUploadRowByChatAndName(chatId, fileName)
  if (!row) {
    return {
      success: false,
      error: `Upload not found: "${fileName}". Use glob("uploads/*") to list available uploads.`,
    }
  }

  const [updated] = await db
    .update(workspaceFiles)
    .set({ context: 'workspace', chatId: null, originalName: row.displayName ?? row.originalName })
    .where(and(eq(workspaceFiles.id, row.id), isNull(workspaceFiles.deletedAt)))
    .returning({ id: workspaceFiles.id, originalName: workspaceFiles.originalName })

  if (!updated) {
    return {
      success: false,
      error: `Upload not found: "${fileName}". Use glob("uploads/*") to list available uploads.`,
    }
  }

  logger.info('Materialized file', { fileName, fileId: updated.id, chatId })

  return {
    success: true,
    output: {
      message: `File "${fileName}" materialized. It is now available at files/${fileName} and will persist independently of this chat.`,
      fileId: updated.id,
      path: `files/${fileName}`,
    },
    resources: [{ type: 'file', id: updated.id, title: fileName }],
  }
}

async function executeImport(
  fileName: string,
  chatId: string,
  workspaceId: string,
  userId: string
): Promise<ToolCallResult> {
  const row = await findMothershipUploadRowByChatAndName(chatId, fileName)
  if (!row) {
    return {
      success: false,
      error: `Upload not found: "${fileName}". Use glob("uploads/*") to list available uploads.`,
    }
  }

  const buffer = await fetchWorkspaceFileBuffer(toFileRecord(row))
  const content = buffer.toString('utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return { success: false, error: `"${fileName}" is not valid JSON.` }
  }

  const { data: workflowData, errors } = parseWorkflowJson(content)
  if (!workflowData || errors.length > 0) {
    return {
      success: false,
      error: `Invalid workflow JSON: ${errors.join(', ')}`,
    }
  }

  const {
    name: rawName,
    color: workflowColor,
    description: workflowDescription,
  } = extractWorkflowMetadata(parsed)

  const workflowId = generateId()
  const now = new Date()
  const dedupedName = await deduplicateWorkflowName(rawName, workspaceId, null)

  await db.insert(workflow).values({
    id: workflowId,
    userId,
    workspaceId,
    folderId: null,
    name: dedupedName,
    description: workflowDescription,
    color: workflowColor,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
    isDeployed: false,
    runCount: 0,
    variables: {},
  })

  const saveResult = await saveWorkflowToNormalizedTables(workflowId, workflowData)
  if (!saveResult.success) {
    await db.delete(workflow).where(eq(workflow.id, workflowId))
    return { success: false, error: `Failed to save workflow state: ${saveResult.error}` }
  }

  if (workflowData.variables && Array.isArray(workflowData.variables)) {
    const variablesRecord: Record<
      string,
      { id: string; name: string; type: string; value: unknown }
    > = {}
    for (const v of workflowData.variables) {
      const varId = (v as { id?: string }).id || generateId()
      const variable = v as { name: string; type?: string; value: unknown }
      variablesRecord[varId] = {
        id: varId,
        name: variable.name,
        type: variable.type || 'string',
        value: variable.value,
      }
    }

    await db
      .update(workflow)
      .set({ variables: variablesRecord, updatedAt: new Date() })
      .where(eq(workflow.id, workflowId))
  }

  logger.info('Imported workflow from upload', {
    fileName,
    workflowId,
    workflowName: dedupedName,
    chatId,
  })

  recordAudit({
    workspaceId,
    actorId: userId,
    action: AuditAction.WORKFLOW_CREATED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: workflowId,
    resourceName: dedupedName,
    description: `Imported workflow "${dedupedName}" from file`,
    metadata: { fileName, source: 'copilot-import' },
  })

  return {
    success: true,
    output: {
      message: `Workflow "${dedupedName}" imported successfully. It is now available in the workspace and can be edited or run.`,
      workflowId,
      workflowName: dedupedName,
    },
    resources: [{ type: 'workflow', id: workflowId, title: dedupedName }],
  }
}

async function executeTable(
  fileName: string,
  chatId: string,
  workspaceId: string,
  userId: string,
  requestedTableName?: string
): Promise<ToolCallResult> {
  const row = await findMothershipUploadRowByChatAndName(chatId, fileName)
  if (!row) {
    return {
      success: false,
      error: `Upload not found: "${fileName}". Use glob("uploads/*") to list available uploads.`,
    }
  }

  const fileRecord = toFileRecord(row)
  const buffer = await fetchWorkspaceFileBuffer(fileRecord)
  const { headers, rows } = await parseFileRows(buffer, fileRecord.name, fileRecord.type)
  if (rows.length === 0) {
    return { success: false, error: `"${fileName}" contains no data rows.` }
  }

  const { columns, headerToColumn } = inferSchemaFromCsv(headers, rows)
  const baseName = requestedTableName?.trim() || fileName.replace(/\.[^.]+$/, '')
  const tableName = sanitizeName(baseName, 'imported_table').slice(
    0,
    TABLE_LIMITS.MAX_TABLE_NAME_LENGTH
  )
  const schema: TableSchema = { columns }
  const planLimits = await getWorkspaceTableLimits(workspaceId)
  const requestId = generateId().slice(0, 8)

  const table = await createTable(
    {
      name: tableName,
      description: `Imported from ${fileName}`,
      schema,
      workspaceId,
      userId,
      maxRows: planLimits.maxRowsPerTable,
      maxTables: planLimits.maxTables,
    },
    requestId
  )

  try {
    const coerced = coerceRowsForTable(rows, schema, headerToColumn)
    let inserted = 0
    for (let i = 0; i < coerced.length; i += CSV_MAX_BATCH_SIZE) {
      const batch = coerced.slice(i, i + CSV_MAX_BATCH_SIZE)
      const result = await batchInsertRows(
        { tableId: table.id, rows: batch, workspaceId, userId },
        table,
        generateId().slice(0, 8)
      )
      inserted += result.length
    }

    logger.info('Created table from upload', {
      fileName,
      tableId: table.id,
      columns: columns.length,
      rows: inserted,
      chatId,
    })

    return {
      success: true,
      output: {
        message: `File "${fileName}" imported as table "${table.name}" with ${columns.length} columns and ${inserted} rows.`,
        tableId: table.id,
        tableName: table.name,
        rowCount: inserted,
      },
      resources: [{ type: 'table', id: table.id, title: table.name }],
    }
  } catch (insertError) {
    await deleteTable(table.id, requestId).catch(() => {})
    throw insertError
  }
}

export async function executeMaterializeFile(
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const fileNames: string[] =
    (params.fileNames as string[] | undefined) ??
    ([params.fileName as string | undefined].filter(Boolean) as string[])

  if (fileNames.length === 0) {
    return { success: false, error: "Missing required parameter 'fileNames'" }
  }

  if (!context.chatId) {
    return { success: false, error: 'No chat context available for materialize_file' }
  }

  if (!context.workspaceId) {
    return { success: false, error: 'No workspace context available for materialize_file' }
  }

  const operation = (params.operation as string | undefined) || 'save'

  const supportedOperations = new Set(['save', 'import', 'table'])
  if (!supportedOperations.has(operation)) {
    return {
      success: false,
      error: `materialize_file operation "${operation}" is not implemented. Supported operations: ${[...supportedOperations].join(', ')}.`,
    }
  }

  const requestedTableName = params.tableName as string | undefined
  const succeeded: string[] = []
  const failed: Array<{ fileName: string; error: string }> = []
  const resources: NonNullable<ToolCallResult['resources']> = []

  for (const fileName of fileNames) {
    try {
      let result: ToolCallResult
      if (operation === 'import') {
        result = await executeImport(fileName, context.chatId, context.workspaceId, context.userId)
      } else if (operation === 'table') {
        result = await executeTable(
          fileName,
          context.chatId,
          context.workspaceId,
          context.userId,
          requestedTableName
        )
      } else {
        result = await executeSave(fileName, context.chatId)
      }

      if (result.success) {
        succeeded.push(fileName)
        if (result.resources) resources.push(...result.resources)
      } else {
        failed.push({ fileName, error: result.error ?? 'Failed to materialize file' })
      }
    } catch (err) {
      logger.error('materialize_file failed', {
        fileName,
        operation,
        chatId: context.chatId,
        error: toError(err).message,
      })
      failed.push({
        fileName,
        error: getErrorMessage(err, 'Failed to materialize file'),
      })
    }
  }

  return {
    success: succeeded.length > 0,
    output: { succeeded, failed },
    error:
      failed.length > 0
        ? `Failed to materialize: ${failed.map((f) => f.fileName).join(', ')}`
        : undefined,
    resources: resources.length > 0 ? resources : undefined,
  }
}
