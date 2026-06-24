import { createLogger } from '@sim/logger'
import { decodeVfsPathSegments, encodeVfsPathSegments } from '@/lib/copilot/vfs/path-utils'
import { resolveWorkflowAliasForWorkspace } from '@/lib/copilot/vfs/workflow-alias-resolver'
import { isPlanAliasPath, workflowAliasSandboxPath } from '@/lib/copilot/vfs/workflow-aliases'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { getColumnId } from '@/lib/table/column-keys'
import { formatCsvValue, neutralizeCsvFormula, toCsvRow } from '@/lib/table/export-format'
import { queryRows } from '@/lib/table/rows/service'
import { getTableById, listTables } from '@/lib/table/service'
import { getOrCreateTableSnapshot, SNAPSHOT_MAX_BYTES } from '@/lib/table/snapshot-cache'
import { listWorkspaceFileFolders } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
  fetchWorkspaceFileBuffer,
  findWorkspaceFileRecord,
  getSandboxWorkspaceFilePath,
  listWorkspaceFiles,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  downloadFile,
  generatePresignedDownloadUrl,
  hasCloudStorage,
} from '@/lib/uploads/core/storage-service'
import { executeTool as executeAppTool } from '@/tools'
import type { ToolExecutionContext, ToolExecutionResult } from '../../tool-executor/types'

const logger = createLogger('CopilotFunctionExecute')

const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_TOTAL_SIZE = 50 * 1024 * 1024
const MAX_MOUNTED_FILES = 500

/**
 * Below this row count a table mounts via the direct inline CSV path — the version-keyed snapshot
 * cache (storage round-trip) only pays off for larger/hot tables. Behind the feature flag either
 * way; this just keeps tiny one-shot tables on the cheaper path.
 */
const SNAPSHOT_MIN_ROWS = 500

/**
 * Lifetime of a presigned URL handed to the sandbox to fetch a mounted object (table snapshot or
 * workspace file). Long enough to download a large file at sandbox startup; the URL grants read to
 * only that one object.
 */
const MOUNT_URL_TTL_SECONDS = 600

/**
 * Per-file ceiling for URL-mounted workspace files. The bytes never transit the web process — the
 * sandbox curls them straight from storage — so the bound is sandbox disk, not web heap (unlike the
 * inline MAX_FILE_SIZE path).
 */
const MOUNT_URL_MAX_BYTES = 500 * 1024 * 1024

/**
 * Aggregate ceiling across all URL-mounted files in one request. URL mounts bypass the web heap (so
 * they don't count against MAX_TOTAL_SIZE), but the sandbox still curls every byte onto its disk —
 * this rejects an oversized request up front instead of filling the sandbox disk one slow curl at a
 * time. Generous vs MAX_TOTAL_SIZE since the bytes never transit web memory.
 */
const MAX_TOTAL_URL_BYTES = 2 * 1024 * 1024 * 1024

type SandboxFile =
  | { type?: 'content'; path: string; content: string; encoding?: 'base64' }
  | { type: 'url'; path: string; url: string }

/**
 * Running byte totals for one resolveInputFiles call. `buffered` bytes pass through the web process
 * (capped by MAX_TOTAL_SIZE); `url` bytes are curled straight into the sandbox (capped by
 * MAX_TOTAL_URL_BYTES). Tracked separately because the two ceilings protect different resources —
 * web heap vs sandbox disk.
 */
interface MountedBytes {
  buffered: number
  url: number
}

/**
 * Mounts a stored workspace file into the sandbox and records its bytes against the running totals.
 * With cloud storage the sandbox fetches the bytes itself from a presigned URL (no web-heap transit,
 * per-file ceiling MOUNT_URL_MAX_BYTES, aggregate ceiling MAX_TOTAL_URL_BYTES); with local storage a
 * presigned URL is an app-internal serve path a remote sandbox can't reach, so we buffer the bytes
 * through the web process under the inline MAX_FILE_SIZE / MAX_TOTAL_SIZE guards.
 */
async function pushWorkspaceFileMount(
  sandboxFiles: SandboxFile[],
  record: WorkspaceFileRecord,
  mountPath: string,
  mounted: MountedBytes
): Promise<void> {
  if (hasCloudStorage()) {
    if (record.size > MOUNT_URL_MAX_BYTES) {
      throw new Error(
        `Input file "${mountPath}" is ${Math.round(record.size / 1024 / 1024)}MB, over the ${MOUNT_URL_MAX_BYTES / 1024 / 1024}MB per-file mount limit.`
      )
    }
    if (mounted.url + record.size > MAX_TOTAL_URL_BYTES) {
      throw new Error(
        `Mounting "${mountPath}" would exceed the ${MAX_TOTAL_URL_BYTES / 1024 / 1024 / 1024}GB total mount limit. Mount fewer or smaller files.`
      )
    }
    const url = await generatePresignedDownloadUrl(
      record.key,
      record.storageContext ?? 'workspace',
      MOUNT_URL_TTL_SECONDS
    )
    sandboxFiles.push({ type: 'url', path: mountPath, url })
    mounted.url += record.size
    return
  }

  if (record.size > MAX_FILE_SIZE) {
    throw new Error(
      `Input file "${mountPath}" is ${Math.round(record.size / 1024 / 1024)}MB, over the ${MAX_FILE_SIZE / 1024 / 1024}MB per-file mount limit.`
    )
  }
  if (mounted.buffered + record.size > MAX_TOTAL_SIZE) {
    throw new Error(
      `Mounting "${mountPath}" would exceed the ${MAX_TOTAL_SIZE / 1024 / 1024}MB total mount limit. Mount fewer or smaller files.`
    )
  }
  const buffer = await fetchWorkspaceFileBuffer(record)
  const isText = /^text\/|application\/json|application\/xml|application\/csv/.test(
    record.type || ''
  )
  sandboxFiles.push({
    path: mountPath,
    content: isText ? buffer.toString('utf-8') : buffer.toString('base64'),
    encoding: isText ? undefined : 'base64',
  })
  mounted.buffered += buffer.length
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

export async function resolveInputFiles(
  workspaceId: string,
  inputFiles?: unknown[],
  inputTables?: unknown[],
  inputDirectories?: unknown[]
): Promise<SandboxFile[]> {
  const sandboxFiles: SandboxFile[] = []
  const mounted: MountedBytes = { buffered: 0, url: 0 }
  const betaEnabled = await isFeatureEnabled('mothership-beta')

  if (inputFiles?.length && workspaceId) {
    if (inputFiles.length > MAX_MOUNTED_FILES) {
      throw new Error(
        `Too many input files (${inputFiles.length}). Maximum is ${MAX_MOUNTED_FILES}. Mount fewer files.`
      )
    }
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
      const explicitSandboxPath =
        typeof fileRef === 'object' && fileRef !== null
          ? (fileRef as CanonicalFileInput).sandboxPath
          : undefined
      const mountPath =
        explicitSandboxPath ||
        (alias ? workflowAliasSandboxPath(alias.aliasPath) : getSandboxWorkspaceFilePath(record))
      await pushWorkspaceFileMount(sandboxFiles, record, mountPath, mounted)
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
        const relativeFolder =
          record.folderPath?.slice(folder.path.length).replace(/^\/+/, '') ?? ''
        const relativePath = alias
          ? encodeVfsPathSegments(
              [relativeFolder, record.name].filter(Boolean).join('/').split('/')
            )
          : [relativeFolder, record.name].filter(Boolean).join('/')
        await pushWorkspaceFileMount(sandboxFiles, record, `${mountRoot}/${relativePath}`, mounted)
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
    const snapshotCacheEnabled = await isFeatureEnabled('table-snapshot-cache')
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
      const sandboxPath =
        typeof tableRef === 'object' && tableRef !== null
          ? (tableRef as CanonicalTableInput).sandboxPath
          : undefined
      const mountPath = sandboxPath || `/home/user/tables/${table.id}.csv`

      // Large/hot tables mount by reference from a version-keyed CSV snapshot in object storage.
      if (snapshotCacheEnabled && table.rowCount >= SNAPSHOT_MIN_ROWS) {
        const snapshot = await getOrCreateTableSnapshot(table, 'copilot-fn-exec')

        if (hasCloudStorage()) {
          // Mount by reference: the sandbox fetches the snapshot straight from storage via a
          // presigned URL, so the bytes never pass through the web process — the only ceiling is
          // sandbox disk (enforced at materialization by SNAPSHOT_MAX_BYTES).
          if (snapshot.size > SNAPSHOT_MAX_BYTES) {
            throw new Error(
              `Input table "${tableId}" is ${Math.round(snapshot.size / 1024 / 1024)}MB, over the ${SNAPSHOT_MAX_BYTES / 1024 / 1024}MB table mount limit.`
            )
          }
          const url = await generatePresignedDownloadUrl(
            snapshot.key,
            'execution',
            MOUNT_URL_TTL_SECONDS
          )
          sandboxFiles.push({ type: 'url', path: mountPath, url })
          continue
        }

        // Local storage: a presigned URL is an app-internal serve path a remote sandbox can't
        // reach, so fall back to buffering the bytes through the web process (file-mount guards).
        if (snapshot.size > MAX_FILE_SIZE) {
          throw new Error(
            `Input table "${tableId}" is ${Math.round(snapshot.size / 1024 / 1024)}MB, over the ${MAX_FILE_SIZE / 1024 / 1024}MB per-file mount limit.`
          )
        }
        if (mounted.buffered + snapshot.size > MAX_TOTAL_SIZE) {
          throw new Error(
            `Mounting "${tableId}" would exceed the ${MAX_TOTAL_SIZE / 1024 / 1024}MB total mount limit. Mount fewer or smaller tables.`
          )
        }
        const buffer = await downloadFile({
          key: snapshot.key,
          context: 'execution',
          maxBytes: MAX_FILE_SIZE,
        })
        mounted.buffered += buffer.length
        sandboxFiles.push({ path: mountPath, content: buffer.toString('utf-8') })
        continue
      }

      const rows = await queryRows(table, {}, 'copilot-fn-exec')

      const columns = table.schema.columns
      const csvLines = [toCsvRow(columns.map((column) => neutralizeCsvFormula(column.name)))]
      for (const row of rows.rows) {
        csvLines.push(
          toCsvRow(columns.map((column) => formatCsvValue(row.data[getColumnId(column)])))
        )
      }
      const csvContent = csvLines.join('\n')
      sandboxFiles.push({ path: mountPath, content: csvContent })
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
