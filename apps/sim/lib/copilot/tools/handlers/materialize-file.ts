import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workflow, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, sql } from 'drizzle-orm'
import {
  checkStorageQuotaForBillingContext,
  incrementStorageUsageForBillingContextInTx,
  maybeNotifyStorageLimitForBillingContext,
  resolveStorageBillingContext,
} from '@/lib/billing/storage'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { findMothershipUploadRowByChatAndName } from '@/lib/copilot/tools/handlers/upload-file-reader'
import { canonicalWorkspaceFilePath } from '@/lib/copilot/vfs/path-utils'
import { getServePathPrefix } from '@/lib/uploads'
import { fetchWorkspaceFileBuffer } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { hasCloudStorage, headObject } from '@/lib/uploads/core/storage-service'
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

async function executeSave(
  fileName: string,
  chatId: string,
  workspaceId: string
): Promise<ToolCallResult> {
  const row = await findMothershipUploadRowByChatAndName(chatId, fileName)
  if (!row) {
    return {
      success: false,
      error: `Upload not found: "${fileName}". Use glob("uploads/*") to list available uploads.`,
    }
  }
  if (row.workspaceId !== workspaceId) {
    return { success: false, error: `Upload not found: "${fileName}".` }
  }

  const head = await headObject(row.key, 'mothership')
  if (!head && hasCloudStorage()) {
    return { success: false, error: `Upload object not found: "${fileName}".` }
  }
  const verifiedSize = head?.size ?? row.size
  const billingContext = await resolveStorageBillingContext(workspaceId)
  const quotaCheck = await checkStorageQuotaForBillingContext(billingContext, verifiedSize)
  if (!quotaCheck.allowed) {
    throw new Error(quotaCheck.error || 'Storage limit exceeded')
  }

  /**
   * The conditional transition makes concurrent replays no-ops. If it wins,
   * lock order is workspace -> file row -> payer: the explicit workspace lock
   * precedes the conditional file update, then the storage helper reuses that
   * workspace lock before locking its payer. Any quota/stale-payer failure
   * rolls back the row transition.
   */
  const transition = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM workspace WHERE id = ${workspaceId} FOR UPDATE`)

    const [updated] = await tx
      .update(workspaceFiles)
      .set({
        context: 'workspace',
        chatId: null,
        originalName: row.displayName ?? row.originalName,
        size: verifiedSize,
      })
      .where(
        and(
          eq(workspaceFiles.id, row.id),
          eq(workspaceFiles.workspaceId, workspaceId),
          eq(workspaceFiles.chatId, chatId),
          eq(workspaceFiles.context, 'mothership'),
          isNull(workspaceFiles.deletedAt)
        )
      )
      .returning({ id: workspaceFiles.id, originalName: workspaceFiles.originalName })

    if (!updated) {
      return null
    }

    const updatedUsage = await incrementStorageUsageForBillingContextInTx(
      tx,
      billingContext,
      verifiedSize
    )
    return { updated, updatedUsage }
  })

  const updated = transition?.updated ?? {
    id: row.id,
    originalName: row.displayName ?? row.originalName,
  }
  if (transition?.updatedUsage !== undefined) {
    void maybeNotifyStorageLimitForBillingContext(billingContext, transition.updatedUsage)
  }

  logger.info(transition ? 'Materialized file' : 'Materialize replay was a no-op', {
    fileName,
    fileId: updated.id,
    chatId,
  })

  // Canonical, per-segment-encoded path — matches how the workspace VFS serves
  // the file (files/<encoded>), rather than echoing the raw display name.
  const canonicalPath = canonicalWorkspaceFilePath({
    folderPath: null,
    name: updated.originalName,
  })

  return {
    success: true,
    output: {
      message: `File "${updated.originalName}" materialized. It is now available at ${canonicalPath} and will persist independently of this chat.`,
      fileId: updated.id,
      path: canonicalPath,
    },
    resources: [{ type: 'file', id: updated.id, title: updated.originalName }],
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

  const { name: rawName, description: workflowDescription } = extractWorkflowMetadata(parsed)

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
  // Only save/import are implemented. Reject anything else with guidance instead of
  // silently falling back to save (table/knowledge_base are handled by their subagents).
  if (operation !== 'save' && operation !== 'import') {
    return {
      success: false,
      error: `Unsupported materialize_file operation "${operation}". Use "save" or "import". For CSV/TSV/JSON → use the table subagent; for documents → use the knowledge subagent.`,
    }
  }
  const succeeded: string[] = []
  const failed: Array<{ fileName: string; error: string }> = []
  const resources: NonNullable<ToolCallResult['resources']> = []

  for (const fileName of fileNames) {
    try {
      let result: ToolCallResult
      if (operation === 'import') {
        result = await executeImport(fileName, context.chatId, context.workspaceId, context.userId)
      } else {
        result = await executeSave(fileName, context.chatId, context.workspaceId)
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
