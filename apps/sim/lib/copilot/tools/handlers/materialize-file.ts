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
import { canonicalWorkspaceFilePath, encodeVfsPathSegments } from '@/lib/copilot/vfs/path-utils'
import { isReservedWorkflowAliasBackingDisplayPath } from '@/lib/copilot/vfs/workflow-aliases'
import { getServePathPrefix } from '@/lib/uploads'
import {
  ArchiveError,
  type DecompressResult,
  decompressArchiveBufferToWorkspaceFiles,
  MAX_ARCHIVE_BYTES,
} from '@/lib/uploads/archive'
import { findWorkspaceFileFolderIdByPath } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { fetchWorkspaceFileBuffer } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { hasCloudStorage, headObject } from '@/lib/uploads/core/storage-service'
import { isArchiveFileName } from '@/lib/uploads/utils/file-utils'
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

/**
 * Cross-workspace ownership guard shared by every operation. The resolver is
 * chat-scoped and current write paths always stamp matching workspaceIds, so
 * this is defense in depth — but it must hold uniformly: without it, save would
 * flip a foreign-workspace row into this workspace and import would read its
 * bytes, the exact leak extract blocks.
 */
function uploadBelongsToWorkspace(
  row: { workspaceId: string | null },
  workspaceId: string
): boolean {
  return row.workspaceId === workspaceId
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
  if (!uploadBelongsToWorkspace(row, workspaceId)) {
    return { success: false, error: `Upload not found: "${fileName}".` }
  }

  const displayName = row.displayName ?? row.originalName
  if (isArchiveFileName(displayName)) {
    return {
      success: false,
      error: `"${fileName}" is a .zip archive — save it by extracting instead: materialize_file(fileNames: ["${fileName}"], operation: "extract") unpacks it into files/ where the contents stay readable. The raw .zip remains in uploads/ for this chat.`,
    }
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
        // A workspace file has no birth chat or message — clear both provenance
        // fields so the row reads as workspace-owned, not stale chat-owned.
        chatId: null,
        messageId: null,
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
  if (!uploadBelongsToWorkspace(row, workspaceId)) {
    return {
      success: false,
      error: `Upload "${fileName}" does not belong to this workspace.`,
    }
  }
  if (isArchiveFileName(row.displayName ?? row.originalName)) {
    return {
      success: false,
      error: `"${fileName}" is a .zip archive, not a workflow JSON. Extract it first: materialize_file(fileNames: ["${fileName}"], operation: "extract").`,
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

  const { name: rawName } = extractWorkflowMetadata(parsed)

  const workflowId = generateId()
  const now = new Date()
  const dedupedName = await deduplicateWorkflowName(rawName, workspaceId, null)

  await db.insert(workflow).values({
    id: workflowId,
    userId,
    workspaceId,
    folderId: null,
    name: dedupedName,
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

/**
 * Fold a zip display name into a safe extraction folder name. Mirrors the VFS
 * segment normalization (NFC, control-char strip) and rejects the degenerate
 * names the folder layer throws plain Errors for (dot segments, separators,
 * empty), so a hostile upload name like `..zip` or `\x01.zip` lands in the
 * `archive` fallback instead of surfacing a raw internal error — and so the
 * VFS-encoded destination path can be computed before anything is extracted.
 * Reserved system backing folders (`.changelogs`, `.plans`) also fall back:
 * extraction must never write into — or hide behind — those namespaces (the
 * already-extracted lookup skips them, so they'd also duplicate silently).
 */
function archiveFolderBaseName(displayName: string): string {
  const stripped = displayName
    .replace(/\.zip$/i, '')
    .normalize('NFC')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally stripping control chars
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[/\\]/g, '-')
    .trim()
  if (
    !stripped ||
    stripped === '.' ||
    stripped === '..' ||
    isReservedWorkflowAliasBackingDisplayPath(stripped)
  ) {
    return 'archive'
  }
  return stripped
}

/**
 * Decompress an uploaded `.zip` into the workspace `files/<archive>/` folder tree
 * (reusing the shared, capped, zip-slip/bomb-safe extractor). The raw archive
 * stays in uploads/; the extracted files persist in the workspace so the agent
 * can read them with the normal files/ tooling. This is the explicit "extract
 * before reading a zip" step.
 */
async function executeExtract(
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

  if (!uploadBelongsToWorkspace(row, workspaceId)) {
    return {
      success: false,
      error: `Upload "${fileName}" does not belong to this workspace.`,
    }
  }

  const displayName = row.displayName ?? row.originalName
  if (!isArchiveFileName(displayName)) {
    return {
      success: false,
      error: `"${fileName}" is not a .zip archive — only .zip uploads can be extracted. Read it directly with read("uploads/${fileName}").`,
    }
  }

  const record = toFileRecord(row)
  if (record.size > MAX_ARCHIVE_BYTES) {
    return {
      success: false,
      error: `Archive too large to extract: "${fileName}" (${Math.round(
        record.size / 1024 / 1024
      )}MB, limit ${MAX_ARCHIVE_BYTES / 1024 / 1024}MB).`,
    }
  }

  // Resolve the destination up front (the encoded path is a pure function of the
  // hardened base name), so nothing can throw after files have been written.
  const baseName = archiveFolderBaseName(displayName)
  const folderPath = `files/${encodeVfsPathSegments([baseName])}`

  // Re-running extract must not silently duplicate the tree with " (1)"-suffixed
  // copies: when the destination folder already holds files, report it as
  // already extracted instead of extracting beside the previous run.
  const existingFolderId = await findWorkspaceFileFolderIdByPath(workspaceId, [baseName])
  if (existingFolderId) {
    const [existingFile] = await db
      .select({ id: workspaceFiles.id })
      .from(workspaceFiles)
      .where(
        and(
          eq(workspaceFiles.folderId, existingFolderId),
          eq(workspaceFiles.context, 'workspace'),
          isNull(workspaceFiles.deletedAt)
        )
      )
      .limit(1)
    if (existingFile) {
      return {
        success: false,
        error: `"${fileName}" appears to be already extracted — ${folderPath}/ exists and contains files. List them with glob("${folderPath}/**"). To re-extract, delete that folder first.`,
      }
    }
  }

  let result: DecompressResult
  try {
    const buffer = await fetchWorkspaceFileBuffer(record, { maxBytes: MAX_ARCHIVE_BYTES })
    result = await decompressArchiveBufferToWorkspaceFiles(buffer, {
      workspaceId,
      userId,
      rootFolderSegments: [baseName],
      // The agent-facing extract drops macOS/Windows filesystem cruft so the
      // unpacked files/ tree only contains meaningful entries.
      skipNoiseEntries: true,
    })
  } catch (err) {
    if (err instanceof ArchiveError) {
      // Reads sniff small uploads' magic bytes, so a mislabeled ".zip" that
      // fails to parse here is genuinely readable via read() — say so instead
      // of bouncing the model between extract and read forever.
      const mislabeledHint =
        err.reason === 'invalid'
          ? ` If the file is not actually a zip archive, read it directly with read("uploads/${fileName}").`
          : ''
      return {
        success: false,
        error: `Cannot extract "${fileName}": ${err.message}${mislabeledHint}`,
      }
    }
    throw err
  }

  if (result.extracted.length === 0) {
    return { success: false, error: `No files could be extracted from "${fileName}".` }
  }

  const count = result.extracted.length

  if (result.skippedUnsafePaths.length > 0) {
    logger.warn('Skipped unsafe archive entries during extract', {
      fileName,
      chatId,
      entryNames: result.skippedUnsafePaths,
    })
  }

  logger.info('Extracted archive into workspace files', {
    fileName,
    chatId,
    folder: baseName,
    extractedCount: count,
    skipped: result.skipped,
  })

  return {
    success: true,
    output: {
      message: `Extracted ${count} file${count === 1 ? '' : 's'} from "${fileName}" into ${folderPath}/. They now persist in the workspace — list them with glob("${folderPath}/**") and read one with read("${folderPath}/<path>/content").`,
      fileCount: count,
      path: folderPath,
    },
    resources: result.extracted.map((f) => ({ type: 'file' as const, id: f.id, title: f.name })),
  }
}

export async function executeMaterializeFile(
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  // Dedupe: a repeated name in one call would re-run the operation against the
  // same upload (for extract, duplicating the unpacked tree with " (1)" copies).
  const fileNames: string[] = Array.from(
    new Set(
      (params.fileNames as string[] | undefined) ??
        ([params.fileName as string | undefined].filter(Boolean) as string[])
    )
  )

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
  // save (promote upload → workspace file), import (JSON → workflow), and extract
  // (decompress a .zip upload → workspace files/) are implemented. Reject anything
  // else with guidance instead of silently falling back to save.
  if (operation !== 'save' && operation !== 'import' && operation !== 'extract') {
    return {
      success: false,
      error: `Unsupported materialize_file operation "${operation}". Use "save", "import", or "extract". For CSV/TSV/JSON → use the table subagent; for documents → use the knowledge subagent.`,
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
      } else if (operation === 'extract') {
        result = await executeExtract(fileName, context.chatId, context.workspaceId, context.userId)
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
