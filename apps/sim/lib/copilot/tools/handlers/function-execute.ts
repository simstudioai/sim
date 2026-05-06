import { createLogger } from '@sim/logger'
import { getTableById, queryRows } from '@/lib/table/service'
import {
  fetchWorkspaceFileBuffer,
  findWorkspaceFileRecord,
  getSandboxWorkspaceFilePath,
  listWorkspaceFiles,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { executeTool as executeAppTool } from '@/tools'
import type { ToolExecutionContext, ToolExecutionResult } from '../../tool-executor/types'

const logger = createLogger('CopilotFunctionExecute')

const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_TOTAL_SIZE = 50 * 1024 * 1024

interface SandboxFile {
  path: string
  content: string
}

async function resolveInputFiles(
  workspaceId: string,
  inputFiles?: unknown[],
  inputTables?: unknown[]
): Promise<SandboxFile[]> {
  const sandboxFiles: SandboxFile[] = []
  let totalSize = 0

  if (inputFiles?.length && workspaceId) {
    const allFiles = await listWorkspaceFiles(workspaceId)
    for (const fileRef of inputFiles) {
      if (typeof fileRef !== 'string') continue
      const record = findWorkspaceFileRecord(allFiles, fileRef)
      if (!record) {
        logger.warn('Input file not found', { fileRef })
        continue
      }
      if (record.size > MAX_FILE_SIZE) {
        logger.warn('Input file exceeds size limit', { fileId: record.id, size: record.size })
        continue
      }
      if (totalSize + record.size > MAX_TOTAL_SIZE) {
        logger.warn('Total input size limit reached')
        break
      }
      const buffer = await fetchWorkspaceFileBuffer(record)
      totalSize += buffer.length
      const isText = /^text\/|application\/json|application\/xml|application\/csv/.test(
        record.type || ''
      )
      const content = isText ? buffer.toString('utf-8') : buffer.toString('base64')
      sandboxFiles.push({
        path: getSandboxWorkspaceFilePath(record),
        content,
        encoding: isText ? undefined : 'base64',
      } as SandboxFile)
    }
  }

  if (inputTables?.length) {
    for (const tableId of inputTables) {
      if (typeof tableId !== 'string') continue
      const table = await getTableById(tableId)
      if (!table) {
        logger.warn('Input table not found', { tableId })
        continue
      }
      const rows = await queryRows(tableId, workspaceId, {}, 'copilot-fn-exec')
      if (!rows.rows?.length) continue

      const allKeys = new Set<string>()
      for (const row of rows.rows) {
        if (row.data && typeof row.data === 'object') {
          for (const key of Object.keys(row.data as Record<string, unknown>)) {
            allKeys.add(key)
          }
        }
      }
      const headers = Array.from(allKeys)
      const csvLines = [headers.join(',')]
      for (const row of rows.rows) {
        const data = (row.data || {}) as Record<string, unknown>
        csvLines.push(
          headers
            .map((h) => {
              const val = data[h]
              const str = val === null || val === undefined ? '' : String(val)
              return str.includes(',') || str.includes('"') || str.includes('\n')
                ? `"${str.replace(/"/g, '""')}"`
                : str
            })
            .join(',')
        )
      }
      const csvContent = csvLines.join('\n')
      sandboxFiles.push({
        path: `/home/user/tables/${tableId}.csv`,
        content: csvContent,
      })
    }
  }

  return sandboxFiles
}

export async function executeFunctionExecute(
  params: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const enrichedParams = { ...params }

  if (context.decryptedEnvVars && Object.keys(context.decryptedEnvVars).length > 0) {
    enrichedParams.envVars = {
      ...context.decryptedEnvVars,
      ...((enrichedParams.envVars as Record<string, string>) || {}),
    }
  }

  if (context.workspaceId) {
    const inputFiles = enrichedParams.inputFiles as unknown[] | undefined
    const inputTables = enrichedParams.inputTables as unknown[] | undefined

    if (inputFiles?.length || inputTables?.length) {
      const resolved = await resolveInputFiles(context.workspaceId, inputFiles, inputTables)
      if (resolved.length > 0) {
        const existing = (enrichedParams._sandboxFiles as SandboxFile[]) || []
        enrichedParams._sandboxFiles = [...existing, ...resolved]
      }
    }
  }

  enrichedParams._context = {
    ...(typeof enrichedParams._context === 'object' && enrichedParams._context !== null
      ? (enrichedParams._context as object)
      : {}),
    userId: context.userId,
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
    chatId: context.chatId,
    executionId: context.executionId,
    runId: context.runId,
    enforceCredentialAccess: true,
  }

  return executeAppTool('function_execute', enrichedParams, false)
}
