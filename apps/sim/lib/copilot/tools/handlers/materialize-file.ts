import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workflow, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import {
  findChatOutputRowByChatAndName,
  findMothershipUploadRowByChatAndName,
  resolveChatOutputRecord,
  resolveChatUploadRecord,
} from '@/lib/copilot/tools/handlers/chat-file-reader'
import {
  canonicalWorkspaceFilePath,
  chatScopedLeafSegment,
  isOutputsPath,
  isUploadsPath,
} from '@/lib/copilot/vfs/path-utils'
import {
  allocateUniqueWorkspaceFileName,
  fetchWorkspaceFileBuffer,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { parseWorkflowJson } from '@/lib/workflows/operations/import-export'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { deduplicateWorkflowName } from '@/lib/workflows/utils'
import { extractWorkflowMetadata } from '@/app/api/v1/admin/types'

const logger = createLogger('MaterializeFile')

async function executeSave(fileName: string, chatId: string): Promise<ToolCallResult> {
  // `save` promotes a chat-scoped file into the permanent workspace. The source is
  // either a user upload (`uploads/`, context 'mothership') or an agent-generated
  // one-off output (`outputs/`, context 'output') — both live in workspace_files and
  // promote identically (flip context to 'workspace', detach from the chat).
  //
  // The two are independent per-chat namespaces (separate unique indexes), so
  // one chat can hold BOTH uploads/report.png and outputs/report.png. A
  // namespaced spelling targets one explicitly; a bare name that exists in
  // both is ambiguous and errors rather than silently promoting one.
  let row: typeof workspaceFiles.$inferSelect | null
  if (isUploadsPath(fileName)) {
    row = await findMothershipUploadRowByChatAndName(
      chatId,
      chatScopedLeafSegment(fileName, 'uploads')
    )
  } else if (isOutputsPath(fileName)) {
    row = await findChatOutputRowByChatAndName(chatId, chatScopedLeafSegment(fileName, 'outputs'))
  } else {
    const [uploadRow, outputRow] = await Promise.all([
      findMothershipUploadRowByChatAndName(chatId, fileName),
      findChatOutputRowByChatAndName(chatId, fileName),
    ])
    if (uploadRow && outputRow) {
      return {
        success: false,
        error: `"${fileName}" exists as both a chat upload and a generated output. Specify which to save: "uploads/${fileName}" or "outputs/${fileName}".`,
      }
    }
    row = uploadRow ?? outputRow
  }
  if (!row) {
    return {
      success: false,
      error: `File not found: "${fileName}". Use glob("uploads/*") or glob("outputs/*") to list available chat files.`,
    }
  }

  // Chat-scoped names are unique only within their chat, so two chats can each hold a
  // "generated-image.jpg". Promoting both to the workspace root would collide on the
  // `workspace_files_workspace_folder_name_active_unique` index (context='workspace'),
  // so disambiguate against existing workspace files first (e.g. "generated-image (1).jpg").
  const desiredName = row.displayName ?? row.originalName
  const uniqueName = row.workspaceId
    ? await allocateUniqueWorkspaceFileName(row.workspaceId, desiredName, row.folderId ?? null)
    : desiredName

  const [updated] = await db
    .update(workspaceFiles)
    .set({
      context: 'workspace',
      // A workspace file has no birth chat or message — clear both provenance
      // fields so the row reads as workspace-owned, not stale chat-owned.
      chatId: null,
      messageId: null,
      originalName: uniqueName,
      displayName: uniqueName,
    })
    .where(and(eq(workspaceFiles.id, row.id), isNull(workspaceFiles.deletedAt)))
    .returning({ id: workspaceFiles.id, originalName: workspaceFiles.originalName })

  if (!updated) {
    // The row resolved above but the guarded update matched nothing — it was
    // deleted (or already promoted) in between. Namespace-agnostic message:
    // the source may have been an upload OR an output.
    return {
      success: false,
      error: `File no longer available: "${fileName}". Use glob("uploads/*") or glob("outputs/*") to list available chat files.`,
    }
  }

  logger.info('Materialized file', { fileName, fileId: updated.id, chatId })

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
      // `name` is the ACTUAL saved name, which may be disambiguated from the requested
      // name (e.g. "generated-image (1).jpg") when a workspace file already uses it. The
      // batch wrapper surfaces this so the agent reports the real name, not the input.
      name: updated.originalName,
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
  // Same namespace routing as save: agent-generated workflow JSON lives in
  // outputs/ just as legitimately as user uploads live in uploads/, and a
  // bare name colliding across both is ambiguous rather than uploads-wins.
  let record: Awaited<ReturnType<typeof resolveChatUploadRecord>>
  if (isUploadsPath(fileName)) {
    record = await resolveChatUploadRecord(chatId, chatScopedLeafSegment(fileName, 'uploads'))
  } else if (isOutputsPath(fileName)) {
    record = await resolveChatOutputRecord(chatId, chatScopedLeafSegment(fileName, 'outputs'))
  } else {
    const [uploadRecord, outputRecord] = await Promise.all([
      resolveChatUploadRecord(chatId, fileName),
      resolveChatOutputRecord(chatId, fileName),
    ])
    if (uploadRecord && outputRecord) {
      return {
        success: false,
        error: `"${fileName}" exists as both a chat upload and a generated output. Specify which to import: "uploads/${fileName}" or "outputs/${fileName}".`,
      }
    }
    record = uploadRecord ?? outputRecord
  }
  if (!record) {
    return {
      success: false,
      error: `File not found: "${fileName}". Use glob("uploads/*") or glob("outputs/*") to list available chat files.`,
    }
  }

  const buffer = await fetchWorkspaceFileBuffer(record)
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

  logger.info('Imported workflow from chat file', {
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
  // Report the ACTUAL saved name/path (which `save` may disambiguate from the requested
  // name), so the agent tells the user the real filename instead of what it passed in.
  const succeeded: Array<{ requested: string; name: string; path?: string }> = []
  const failed: Array<{ fileName: string; error: string }> = []
  const resources: NonNullable<ToolCallResult['resources']> = []

  for (const fileName of fileNames) {
    try {
      let result: ToolCallResult
      if (operation === 'import') {
        result = await executeImport(fileName, context.chatId, context.workspaceId, context.userId)
      } else {
        result = await executeSave(fileName, context.chatId)
      }

      if (result.success) {
        const out = (result.output ?? {}) as {
          name?: string
          path?: string
          workflowName?: string
        }
        succeeded.push({
          requested: fileName,
          name: out.name ?? out.workflowName ?? fileName,
          ...(out.path ? { path: out.path } : {}),
        })
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
