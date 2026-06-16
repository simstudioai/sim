import { createLogger } from '@sim/logger'
import { decodeVfsPathSegments, encodeVfsPathSegments } from '@/lib/copilot/vfs/path-utils'
import { resolveWorkflowAliasForWorkspace } from '@/lib/copilot/vfs/workflow-alias-resolver'
import { isPlanAliasPath, workflowAliasSandboxPath } from '@/lib/copilot/vfs/workflow-aliases'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { queryRows } from '@/lib/table/rows/service'
import { getTableById, listTables } from '@/lib/table/service'
import { listWorkspaceFileFolders } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
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
const MAX_MOUNTED_FILES = 500

interface SandboxFile {
  path: string
  content: string
  encoding?: 'base64'
}

interface CanonicalFileInput {
  path: string
  sandboxPath?: string
}

interface CanonicalDirectoryInput {
  path: string
  sandboxPath?: string
}

interface CanonicalTableInput {
  tableId?: string
  path?: string
  sandboxPath?: string
}

function tableNameFromVfsPath(tableRef: string): string | null {
  if (!tableRef.startsWith('tables/')) return null
  const segments = decodeVfsPathSegments(tableRef)
  const metaIndex = segments.lastIndexOf('meta.json')
  return segments[metaIndex > 0 ? metaIndex - 1 : segments.length - 1] ?? null
}

async function resolveTableRef(
  tableRef: string,
  tablePathLookup?: Map<string, Awaited<ReturnType<typeof listTables>>[number]>
) {
  if (!tableRef.startsWith('tables/')) {
    return getTableById(tableRef)
  }

  const tableName = tableNameFromVfsPath(tableRef)
  if (!tableName) return null
  return tablePathLookup?.get(tableName) ?? null
}

async function resolveInputFiles(
  workspaceId: string,
  inputFiles?: unknown[],
  inputTables?: unknown[],
  inputDirectories?: unknown[]
): Promise<SandboxFile[]> {
  const sandboxFiles: SandboxFile[] = []
  let totalSize = 0
  const betaEnabled = await isFeatureEnabled('mothership-beta')

  if (inputFiles?.length && workspaceId) {
    const allFiles = await listWorkspaceFiles(workspaceId, {
      includeReservedSystemFiles: betaEnabled,
    })
    for (const fileRef of inputFiles) {
      const filePath =
        typeof fileRef === 'string'
          ? fileRef
          : fileRef && typeof fileRef === 'object'
            ? (fileRef as CanonicalFileInput).path
            : undefined
      if (!filePath) continue
      const alias = await resolveWorkflowAliasForWorkspace({ workspaceId, path: filePath })
      if (!alias && isPlanAliasPath(filePath)) {
        logger.warn('Unsupported plan alias input file path', { filePath })
        continue
      }
      if (alias?.kind === 'plans_dir') {
        logger.warn('Input file is a plan alias directory', { filePath })
        continue
      }
      const record = findWorkspaceFileRecord(allFiles, alias?.backingPath ?? filePath)
      if (!record) {
        if (filePath.startsWith('uploads/')) {
          throw new Error(
            `Cannot mount "${filePath}": uploads/ files are not mountable into the sandbox. Use materialize_file to save it to a files/... path first, then mount that canonical path.`
          )
        }
        throw new Error(
          `Input file not found: "${filePath}". Pass the exact canonical VFS path copied from glob/read (e.g. "files/Reports/data.csv").`
        )
      }
      if (record.size > MAX_FILE_SIZE) {
        throw new Error(
          `Input file "${filePath}" is ${Math.round(record.size / 1024 / 1024)}MB, over the ${MAX_FILE_SIZE / 1024 / 1024}MB per-file mount limit.`
        )
      }
      if (totalSize + record.size > MAX_TOTAL_SIZE) {
        throw new Error(
          `Mounting "${filePath}" would exceed the ${MAX_TOTAL_SIZE / 1024 / 1024}MB total mount limit. Mount fewer or smaller files.`
        )
      }
      const buffer = await fetchWorkspaceFileBuffer(record)
      totalSize += buffer.length
      const isText = /^text\/|application\/json|application\/xml|application\/csv/.test(
        record.type || ''
      )
      const content = isText ? buffer.toString('utf-8') : buffer.toString('base64')
      const explicitSandboxPath =
        typeof fileRef === 'object' && fileRef !== null
          ? (fileRef as CanonicalFileInput).sandboxPath
          : undefined
      sandboxFiles.push({
        path:
          explicitSandboxPath ||
          (alias ? workflowAliasSandboxPath(alias.aliasPath) : getSandboxWorkspaceFilePath(record)),
        content,
        encoding: isText ? undefined : 'base64',
      })
    }
  }

  if (inputDirectories?.length && workspaceId) {
    const folders = await listWorkspaceFileFolders(workspaceId, {
      includeReservedSystemFolders: betaEnabled,
    })
    const allFiles = await listWorkspaceFiles(workspaceId, {
      folders,
      includeReservedSystemFiles: betaEnabled,
    })
    for (const dirRef of inputDirectories) {
      const dirPath =
        typeof dirRef === 'string'
          ? dirRef
          : dirRef && typeof dirRef === 'object'
            ? (dirRef as CanonicalDirectoryInput).path
            : undefined
      if (!dirPath) continue
      const alias = await resolveWorkflowAliasForWorkspace({ workspaceId, path: dirPath })
      if (alias && alias.kind !== 'plans_dir') {
        throw new Error(`Input directory is a plan alias file, not a directory: ${dirPath}`)
      }
      if (!alias && isPlanAliasPath(dirPath)) {
        throw new Error(`Unsupported plan alias directory: ${dirPath}`)
      }
      const backingDirPath = alias?.backingPath ?? dirPath
      const folderSegments = decodeVfsPathSegments(backingDirPath.replace(/^\/?files\/?/, ''))
      const folderDisplayPath = folderSegments.join('/')
      const folder = folders.find((candidate) => candidate.path === folderDisplayPath)
      if (!folder) {
        throw new Error(`Input directory not found: ${dirPath}`)
      }
      const mountRoot =
        typeof dirRef === 'object' &&
        dirRef !== null &&
        (dirRef as CanonicalDirectoryInput).sandboxPath
          ? (dirRef as CanonicalDirectoryInput).sandboxPath!
          : alias
            ? workflowAliasSandboxPath(alias.aliasPath)
            : `/home/user/files/${encodeVfsPathSegments(folder.path.split('/'))}`
      const descendants = allFiles.filter((file) => {
        if (!file.folderPath) return false
        return file.folderPath === folder.path || file.folderPath.startsWith(`${folder.path}/`)
      })
      if (descendants.length > MAX_MOUNTED_FILES) {
        throw new Error(
          `Input directory contains too many files (${descendants.length}). Maximum is ${MAX_MOUNTED_FILES}. Mount a smaller directory or individual files.`
        )
      }
      logger.info('Mounting workspace directory for function_execute', {
        vfsPath: dirPath,
        sandboxPath: mountRoot,
        fileCount: descendants.length,
      })
      const childFolders = folders.filter(
        (candidate) =>
          candidate.path !== folder.path && candidate.path.startsWith(`${folder.path}/`)
      )
      if (descendants.length === 0 && childFolders.length === 0) {
        sandboxFiles.push({ path: `${mountRoot}/.keep`, content: '' })
        continue
      }
      for (const childFolder of childFolders) {
        const hasFiles = descendants.some((file) => {
          if (!file.folderPath) return false
          return (
            file.folderPath === childFolder.path ||
            file.folderPath.startsWith(`${childFolder.path}/`)
          )
        })
        if (!hasFiles) {
          const relativeFolder = childFolder.path.slice(folder.path.length).replace(/^\/+/, '')
          sandboxFiles.push({ path: `${mountRoot}/${relativeFolder}/.keep`, content: '' })
        }
      }
      for (const record of descendants) {
        if (record.size > MAX_FILE_SIZE) {
          throw new Error(`Input file exceeds size limit: ${record.name}`)
        }
        if (totalSize + record.size > MAX_TOTAL_SIZE) {
          throw new Error('Total input size limit exceeded while mounting directory')
        }
        const buffer = await fetchWorkspaceFileBuffer(record)
        totalSize += buffer.length
        const isText = /^text\/|application\/json|application\/xml|application\/csv/.test(
          record.type || ''
        )
        const relativeFolder =
          record.folderPath?.slice(folder.path.length).replace(/^\/+/, '') ?? ''
        const relativePath = alias
          ? encodeVfsPathSegments(
              [relativeFolder, record.name].filter(Boolean).join('/').split('/')
            )
          : [relativeFolder, record.name].filter(Boolean).join('/')
        sandboxFiles.push({
          path: `${mountRoot}/${relativePath}`,
          content: isText ? buffer.toString('utf-8') : buffer.toString('base64'),
          encoding: isText ? undefined : 'base64',
        })
      }
    }
  }

  if (inputTables?.length) {
    const hasTablePathRefs = inputTables.some((tableRef) => {
      const tableId =
        typeof tableRef === 'string'
          ? tableRef
          : tableRef && typeof tableRef === 'object'
            ? (tableRef as CanonicalTableInput).tableId || (tableRef as CanonicalTableInput).path
            : undefined
      return typeof tableId === 'string' && tableId.startsWith('tables/')
    })
    const tablePathLookup = hasTablePathRefs
      ? new Map((await listTables(workspaceId)).map((table) => [table.name, table]))
      : undefined
    for (const tableRef of inputTables) {
      const tableId =
        typeof tableRef === 'string'
          ? tableRef
          : tableRef && typeof tableRef === 'object'
            ? (tableRef as CanonicalTableInput).tableId || (tableRef as CanonicalTableInput).path
            : undefined
      if (!tableId) continue
      const table = await resolveTableRef(tableId, tablePathLookup)
      if (!table || table.workspaceId !== workspaceId) {
        throw new Error(
          `Input table not found: "${tableId}". Pass the table id (tbl_...) from tables/{name}/meta.json, or a tables/{name}/meta.json path.`
        )
      }
      const rows = await queryRows(table, {}, 'copilot-fn-exec')

      const allKeys = new Set(table.schema.columns.map((column) => column.name))
      for (const row of rows.rows ?? []) {
        if (row.data && typeof row.data === 'object') {
          for (const key of Object.keys(row.data as Record<string, unknown>)) {
            allKeys.add(key)
          }
        }
      }
      const headers = Array.from(allKeys)
      const csvLines = [headers.join(',')]
      for (const row of rows.rows ?? []) {
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
      const sandboxPath =
        typeof tableRef === 'object' && tableRef !== null
          ? (tableRef as CanonicalTableInput).sandboxPath
          : undefined
      sandboxFiles.push({
        path: sandboxPath || `/home/user/tables/${table.id}.csv`,
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
    const inputs = enrichedParams.inputs as
      | {
          files?: CanonicalFileInput[]
          directories?: CanonicalDirectoryInput[]
          tables?: CanonicalTableInput[]
        }
      | undefined
    const inputFiles = [
      ...((enrichedParams.inputFiles as unknown[] | undefined) ?? []),
      ...(inputs?.files ?? []),
    ]
    const inputDirectories = inputs?.directories ?? []
    const inputTables = [
      ...((enrichedParams.inputTables as unknown[] | undefined) ?? []),
      ...(inputs?.tables ?? []),
    ]

    if (inputFiles?.length || inputTables?.length || inputDirectories.length) {
      const resolved = await resolveInputFiles(
        context.workspaceId,
        inputFiles,
        inputTables,
        inputDirectories
      )
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

  return executeAppTool('function_execute', enrichedParams)
}
