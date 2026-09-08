import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { omit } from '@sim/utils/object'
import { hasWorkspaceSandboxAccess } from '@/lib/billing/core/subscription'
import { resolveCopilotFilePrincipal } from '@/lib/copilot/auth/file-delegation'
import { applySecretMountPolicy } from '@/lib/copilot/secret-mount-policy'
import type { ToolExecutionContext, ToolExecutionResult } from '@/lib/copilot/tool-executor/types'
import {
  CopilotCodeSecretAccessError,
  type MaterializedCopilotCodeSecrets,
  materializeCopilotCodeSecrets,
} from '@/lib/copilot/tools/secret-mount-materializer.server'
import { decodeVfsPathSegments, encodeVfsPathSegments } from '@/lib/copilot/vfs/path-utils'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import type { PrivateSecretProvenanceBundleV1 } from '@/lib/execution/model-input-provenance'
import {
  MOUNTED_WORKSPACE_FILES_PROVENANCE_KEY,
  PRIVATE_SECRET_PROVENANCE_FIELD,
} from '@/lib/execution/private-tool-metadata'
import { MAX_PLAN_REQUIRED } from '@/lib/execution/remote-sandbox/entitlement'
import type { SandboxFile } from '@/lib/execution/remote-sandbox/types'
import {
  createSandboxMountBudget,
  MAX_INLINE_MOUNT_FILE_BYTES,
  MAX_INLINE_MOUNT_TOTAL_BYTES,
  MAX_TOTAL_URL_BYTES,
  MOUNT_URL_TTL_SECONDS,
  pushSandboxFileMount,
  type SandboxMountBudget,
} from '@/lib/function-execution/sandbox-mounts'
import { recordSecretUsage } from '@/lib/secrets/usage/record'
import { getTableSnapshotModelMountSafety } from '@/lib/table/rows/secret-provenance'
import { getTableById, listTables } from '@/lib/table/service'
import { getOrCreateTableSnapshot, SNAPSHOT_MAX_BYTES } from '@/lib/table/snapshot-cache'
import {
  findWorkspaceFileRecord,
  getSandboxWorkspaceFilePath,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { importWorkspaceFileSecretProvenanceForRuntime } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  downloadFile,
  generatePresignedDownloadUrl,
  hasCloudStorage,
} from '@/lib/uploads/core/storage-service'
import { isGeneratedDocumentSourceType } from '@/lib/uploads/utils/file-utils'
import { fetchAuthorizedServableWorkspaceFileBuffer } from '@/lib/workspace-files/application/fetch-servable-workspace-file-buffer'
import { listAllWorkspaceFiles } from '@/lib/workspace-files/application/list-workspace-files'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
import { downloadWorkspaceFileRecord } from '@/lib/workspace-files/application/read-workspace-file-record'
import { listWorkspaceFileFoldersOperation } from '@/lib/workspace-files/application/workspace-file-folders'
import {
  buildWorkspaceFileFolderDisplayPath,
  parseWorkspaceFileFolderDisplayPath,
} from '@/lib/workspace-files/folder-display-path'
import { extractCodeSecretNames } from '@/executor/utils/code-secret-references'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { executeTool as executeAppTool } from '@/tools'

const logger = createLogger('CopilotFunctionExecute')

const MAX_FILE_SIZE = MAX_INLINE_MOUNT_FILE_BYTES
const MAX_TOTAL_SIZE = MAX_INLINE_MOUNT_TOTAL_BYTES
const MAX_MOUNTED_FILES = 500

async function importMountedWorkspaceFileProvenance(args: {
  workspaceId: string
  record: WorkspaceFileRecord
  mountPath: string
  registry?: ResolvedSecretTraceRegistry
}): Promise<void> {
  if (!args.registry) {
    throw new Error(
      `Input file "${args.mountPath}" cannot be mounted because its secret provenance is unavailable.`
    )
  }
  try {
    const imported = await importWorkspaceFileSecretProvenanceForRuntime({
      workspaceId: args.workspaceId,
      identity: {
        fileId: args.record.id,
        key: args.record.key,
        context: args.record.storageContext ?? 'workspace',
      },
      registry: args.registry,
    })
    if (!imported) args.registry.markIncomplete('mounted-file-provenance-unavailable')
  } catch {
    args.registry.markIncomplete('mounted-file-provenance-unavailable')
  }
}

/**
 * Mounts a stored workspace file into the sandbox. The transport choice, the byte
 * ceilings, and the budget accounting live in {@link pushSandboxFileMount}, which
 * the Function block shares; what stays here is workspace-specific — reloading the
 * record through its application operation, importing its secret provenance, and
 * reading generated documents through the servable reader rather than presigning
 * their generator source.
 */
async function pushWorkspaceFileMount(
  sandboxFiles: SandboxFile[],
  record: WorkspaceFileRecord,
  mountPath: string,
  mounted: SandboxMountBudget,
  workspaceId: string,
  principal: Principal,
  registry?: ResolvedSecretTraceRegistry
): Promise<void> {
  record = (
    await downloadWorkspaceFileRecord.execute({
      principal,
      input: { fileId: record.id, assertedWorkspaceId: workspaceId },
    })
  ).file
  await importMountedWorkspaceFileProvenance({ workspaceId, record, mountPath, registry })

  // A generated document stores its generator source, so a presigned URL for
  // `record.key` would hand the sandbox source text under a `.docx` name and the
  // user's script would fail on a file that looks fine. Those resolve through the
  // servable reader instead — they are bounded by the render ceiling, so routing them
  // through the web process rather than presigning is affordable.
  const rendersFromSource = isGeneratedDocumentSourceType(record.type)

  await pushSandboxFileMount(
    sandboxFiles,
    {
      mountPath,
      key: record.key,
      storageContext: record.storageContext ?? 'workspace',
      declaredSize: record.size,
      rendersFromSource,
      readInline: async (maxBytes) => {
        const { buffer, contentType } = rendersFromSource
          ? await fetchAuthorizedServableWorkspaceFileBuffer(record, principal, {
              maxBytes,
            }).catch((error) => {
              if (!isPayloadSizeLimitError(error)) throw error
              throw new Error(
                `Input file "${mountPath}" renders to more than the ${MAX_FILE_SIZE / 1024 / 1024}MB per-file mount limit, or than the mount budget left. Mount fewer or smaller files.`
              )
            })
          : {
              buffer: (
                await readWorkspaceFileContent.execute({
                  principal,
                  input: {
                    fileId: record.id,
                    assertedWorkspaceId: workspaceId,
                    maxBytes,
                  },
                })
              ).content,
              contentType: record.type,
            }
        // Keyed off the resolved type: a rendered document's source MIME is `text/x-…`, and
        // decoding the binary as UTF-8 would corrupt it just as surely as shipping the source.
        const isText = /^text\/|application\/json|application\/xml|application\/csv/.test(
          contentType || ''
        )
        return {
          content: isText ? buffer.toString('utf-8') : buffer.toString('base64'),
          ...(isText ? {} : { encoding: 'base64' as const }),
          byteLength: buffer.length,
        }
      },
    },
    mounted
  )
}

/**
 * Explains why a VFS path the agent legitimately discovered cannot be mounted, and
 * what to do instead. Only workspace `files/` are backed by storage the sandbox can
 * fetch from — `internal/` is served by the copilot backend and its bytes never reach
 * Sim, `uploads/` is chat-scoped, `recently-deleted/` is archived, and the remaining
 * namespaces are metadata views rather than stored file bytes. Returns null for
 * `files/` references, where "not found" is the honest answer.
 *
 * These paths are correct and are advertised to the model as read/grep-able, so the
 * generic not-found message ("copy the exact canonical path") is actively wrong for
 * them: it sends the agent hunting for a path that does not exist.
 */
function unmountableNamespaceReason(filePath: string): string | null {
  // Trailing slash so a bare namespace passed as a directory matches the same prefixes
  // as a file path inside it.
  const path = `${filePath.replace(/^\/+|\/+$/g, '')}/`

  if (path.startsWith('uploads/')) {
    return 'uploads/ files are not mountable into the sandbox. Use save_upload to save it to a files/... path first, then mount that canonical path.'
  }
  if (path.startsWith('internal/tool-results/')) {
    return 'tool-result artifacts are stored by the copilot backend, not in workspace storage, so read and grep reach them but the sandbox cannot. This path is correct — searching for a different one will not find anything. Either read or grep the artifact and inline the values you need in code, or re-run the tool that produced it with an output path under files/ (run_function: outputs.files[].path, user_table: outputPath) and mount that files/... path.'
  }
  if (path.startsWith('internal/')) {
    return 'internal/ paths are served by the copilot backend, not from workspace storage, so read and grep reach them but the sandbox cannot. This path is correct — read or grep it and inline the values you need in code instead of mounting it.'
  }
  if (path.startsWith('recently-deleted/')) {
    return 'deleted resources are not mountable into the sandbox. Use restore_resource to restore it first, then mount the restored files/... path.'
  }
  if (path.startsWith('tables/')) {
    return 'tables are not mounted as files. Pass the table in inputs.tables instead and it is mounted as CSV.'
  }
  const namespace = /^(workflows|knowledgebases|components|environment|agent)\//.exec(path)?.[1]
  if (namespace) {
    return `${namespace}/ paths are VFS metadata views, not stored file bytes, so the sandbox cannot mount them. This path is correct — read or grep it and inline the values you need in code.`
  }
  return null
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
  inputDirectories?: unknown[],
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry,
  filePrincipal?: Principal
): Promise<SandboxFile[]> {
  const sandboxFiles: SandboxFile[] = []
  const mounted = createSandboxMountBudget()

  if (inputFiles?.length && workspaceId) {
    if (!filePrincipal) {
      throw new Error('Workspace file mounts require a trusted Copilot principal')
    }
    if (inputFiles.length > MAX_MOUNTED_FILES) {
      throw new Error(
        `Too many input files (${inputFiles.length}). Maximum is ${MAX_MOUNTED_FILES}. Mount fewer files.`
      )
    }
    const { files: allFiles } = await listAllWorkspaceFiles.execute({
      principal: filePrincipal,
      input: { workspaceId, scope: 'active' },
    })
    for (const fileRef of inputFiles) {
      const filePath =
        typeof fileRef === 'string'
          ? fileRef
          : fileRef && typeof fileRef === 'object'
            ? (fileRef as CanonicalFileInput).path
            : undefined
      if (!filePath) continue
      const record = findWorkspaceFileRecord(allFiles, filePath)
      if (!record) {
        const unmountable = unmountableNamespaceReason(filePath)
        if (unmountable) {
          throw new Error(`Cannot mount "${filePath}": ${unmountable}`)
        }
        throw new Error(
          `Input file not found: "${filePath}". Pass the exact canonical VFS path copied from glob/read (e.g. "files/Reports/data.csv").`
        )
      }
      const explicitSandboxPath =
        typeof fileRef === 'object' && fileRef !== null
          ? (fileRef as CanonicalFileInput).sandboxPath
          : undefined
      const mountPath = explicitSandboxPath || getSandboxWorkspaceFilePath(record)
      await pushWorkspaceFileMount(
        sandboxFiles,
        record,
        mountPath,
        mounted,
        workspaceId,
        filePrincipal,
        resolvedSecretTraceRegistry
      )
    }
  }

  if (inputDirectories?.length && workspaceId) {
    if (!filePrincipal) {
      throw new Error('Workspace directory mounts require a trusted Copilot principal')
    }
    const { folders } = await listWorkspaceFileFoldersOperation.execute({
      principal: filePrincipal,
      input: { workspaceId },
    })
    const { files: allFiles } = await listAllWorkspaceFiles.execute({
      principal: filePrincipal,
      input: { workspaceId, scope: 'active' },
    })
    for (const dirRef of inputDirectories) {
      const dirPath =
        typeof dirRef === 'string'
          ? dirRef
          : dirRef && typeof dirRef === 'object'
            ? (dirRef as CanonicalDirectoryInput).path
            : undefined
      if (!dirPath) continue
      const folderSegments = decodeVfsPathSegments(dirPath.replace(/^\/?files\/?/, ''))
      const folderDisplayPath = buildWorkspaceFileFolderDisplayPath(folderSegments)
      const folder = folders.find((candidate) => candidate.path === folderDisplayPath)
      if (!folder) {
        const unmountable = unmountableNamespaceReason(dirPath)
        throw new Error(
          unmountable
            ? `Cannot mount "${dirPath}": ${unmountable}`
            : `Input directory not found: "${dirPath}". Pass a canonical workspace folder path copied from glob/read (e.g. "files/Reports").`
        )
      }
      const mountRoot =
        typeof dirRef === 'object' &&
        dirRef !== null &&
        (dirRef as CanonicalDirectoryInput).sandboxPath
          ? (dirRef as CanonicalDirectoryInput).sandboxPath!
          : `/home/user/files/${encodeVfsPathSegments(parseWorkspaceFileFolderDisplayPath(folder.path))}`
      const descendants = allFiles.filter((file) => {
        if (!file.folderPath) return false
        return file.folderPath === folder.path || file.folderPath.startsWith(`${folder.path}/`)
      })
      if (descendants.length > MAX_MOUNTED_FILES) {
        throw new Error(
          `Input directory contains too many files (${descendants.length}). Maximum is ${MAX_MOUNTED_FILES}. Mount a smaller directory or individual files.`
        )
      }
      logger.info('Mounting workspace directory for run_function', {
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
        const relativePath = [relativeFolder, record.name].filter(Boolean).join('/')
        await pushWorkspaceFileMount(
          sandboxFiles,
          record,
          `${mountRoot}/${relativePath}`,
          mounted,
          workspaceId,
          filePrincipal,
          resolvedSecretTraceRegistry
        )
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
      const sandboxPath =
        typeof tableRef === 'object' && tableRef !== null
          ? (tableRef as CanonicalTableInput).sandboxPath
          : undefined
      const mountPath = sandboxPath || `/home/user/tables/${table.id}.csv`

      const snapshot = await getOrCreateTableSnapshot(table, 'copilot-fn-exec')
      if (!resolvedSecretTraceRegistry) {
        throw new Error(
          `Input table "${tableId}" cannot be mounted because its secret provenance is unavailable.`
        )
      }
      const mountSafety = await getTableSnapshotModelMountSafety({
        tableId: table.id,
        workspaceId,
        rowsVersion: snapshot.version,
      })
      if (mountSafety === 'stale') {
        throw new Error(`Input table "${tableId}" changed while preparing its snapshot. Retry.`)
      }
      if (mountSafety === 'unsafe-provenance') {
        resolvedSecretTraceRegistry.markIncomplete('table-snapshot-unsafe-for-mount')
      }

      if (hasCloudStorage()) {
        if (snapshot.size > SNAPSHOT_MAX_BYTES) {
          throw new Error(
            `Input table "${tableId}" is ${Math.round(snapshot.size / 1024 / 1024)}MB, over the ${SNAPSHOT_MAX_BYTES / 1024 / 1024}MB table mount limit.`
          )
        }
        if (mounted.url + snapshot.size > MAX_TOTAL_URL_BYTES) {
          throw new Error(
            `Mounting "${tableId}" would exceed the ${MAX_TOTAL_URL_BYTES / 1024 / 1024 / 1024}GB total mount limit. Mount fewer or smaller files and tables.`
          )
        }
        const url = await generatePresignedDownloadUrl(
          snapshot.key,
          'execution',
          MOUNT_URL_TTL_SECONDS
        )
        sandboxFiles.push({ type: 'url', path: mountPath, url, maxBytes: SNAPSHOT_MAX_BYTES })
        mounted.url += snapshot.size
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
    }
  }

  return sandboxFiles
}

async function importMountedProvenance(
  source: ResolvedSecretTraceRegistry,
  target: ResolvedSecretTraceRegistry | undefined,
  crossingValue: unknown
): Promise<void> {
  if (!target) return

  try {
    const provenance = source.exportProvenanceForValue(crossingValue)
    const imported = await target.importCrossingProvenance(provenance, crossingValue, {
      origin: 'copilotFunctionExecute.crossing',
      trusted: true,
    })
    if (!imported)
      target.markIncomplete('value-provenance-import-failed', {
        origin: 'copilotFunctionExecute.crossing',
      })
  } catch {
    target.markIncomplete('value-provenance-import-failed', {
      origin: 'copilotFunctionExecute.crossing',
    })
  }
}

export async function executeFunctionExecute(
  params: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  if (context.requestMode === 'assistant') {
    const inputs = params.inputs
    if (
      params.secrets !== undefined ||
      params.inputTables !== undefined ||
      params.outputTable !== undefined ||
      (inputs !== null && typeof inputs === 'object' && 'tables' in inputs)
    ) {
      throw new Error(
        'Assistant code can use files, but cannot mount secrets or access workspace tables'
      )
    }
  }
  const enrichedParams = omit(params, [
    'sandboxProfile',
    'internalSandboxProfile',
    PRIVATE_SECRET_PROVENANCE_FIELD,
  ])
  // The copilot tool doc promises `timeout` in SECONDS ("Sim converts to
  // milliseconds", default 10, cap 300); the underlying function tool takes
  // MILLISECONDS. Nothing converted, so `timeout: 120` armed a 120ms abort.
  // Values ≤ 600 are read as seconds; larger values are assumed to already be
  // milliseconds (a model habit worth tolerating). Both clamp to the 300s cap.
  if (typeof enrichedParams.timeout === 'number' && Number.isFinite(enrichedParams.timeout)) {
    const raw = enrichedParams.timeout
    const ms = raw <= 600 ? raw * 1000 : raw
    enrichedParams.timeout = Math.min(Math.max(ms, 1000), 300_000)
  }
  if (params.sandboxId !== undefined) {
    if (typeof params.sandboxId !== 'string' || !params.sandboxId.trim()) {
      throw new Error('sandboxId must be a non-empty Sim sandbox id')
    }
    if (!context.workspaceId) {
      throw new Error('A workspace is required to select a Sim sandbox')
    }
    if (!(await hasWorkspaceSandboxAccess(context.workspaceId))) {
      throw new Error(MAX_PLAN_REQUIRED)
    }
    enrichedParams.sandboxId = params.sandboxId.trim()
  }
  const requestedNames = applySecretMountPolicy(
    await extractCodeSecretNames(params.code, params.language),
    context.secretMountPolicy
  )
  const completePendingActivation =
    requestedNames.length > 0
      ? context.resolvedSecretTraceRegistry?.beginPendingActivation()
      : undefined
  let mountedRegistry: ResolvedSecretTraceRegistry | undefined
  let crossingValue: unknown

  /**
   * Hoisted so the usage trail in `finally` attributes the run to the same identity the mount
   * authorized against. Deriving it a second time down there let the two disagree whenever
   * `secretActorUserId` was explicitly null.
   */
  const secretActorUserId =
    context.requestMode === 'assistant'
      ? null
      : context.secretActorUserId === undefined
        ? context.userId
        : context.secretActorUserId

  try {
    let mounted: MaterializedCopilotCodeSecrets = { envVars: {}, catalogEntries: [] }
    if (requestedNames.length > 0) {
      if (!secretActorUserId) {
        throw new CopilotCodeSecretAccessError('Secret access is unavailable for this Copilot run')
      }
      if (!context.workspaceId) {
        throw new CopilotCodeSecretAccessError(
          'A workspace is required to mount secrets into Copilot code'
        )
      }
      mounted = await materializeCopilotCodeSecrets({
        actorUserId: secretActorUserId,
        workspaceId: context.workspaceId,
        requestedNames,
      })
    }
    mountedRegistry = new ResolvedSecretTraceRegistry(mounted.catalogEntries, {
      userId: secretActorUserId ?? context.userId,
      ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
    })

    enrichedParams.envVars = mounted.envVars
    enrichedParams.secretScope = 'selected'
    enrichedParams.mountedSecrets = requestedNames
    /**
     * Certified by the mounted registry rather than read off the raw materializer entries, so
     * a mounted secret sharing its plaintext with a protected one is withheld from the route.
     */
    const unredactedSecretNames = mountedRegistry.getUnredactedSecretNames()
    if (unredactedSecretNames.length > 0) {
      enrichedParams.unredactedSecretNames = unredactedSecretNames
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
          inputDirectories,
          mountedRegistry,
          inputFiles.length > 0 || inputDirectories.length > 0
            ? resolveCopilotFilePrincipal(context)
            : undefined
        )
        if (resolved.length > 0) {
          const existing = (enrichedParams._sandboxFiles as SandboxFile[]) || []
          enrichedParams._sandboxFiles = [...existing, ...resolved]

          const provenance = mountedRegistry.exportProvenance()
          const bundle: PrivateSecretProvenanceBundleV1 = {
            version: 1,
            complete: provenance.complete,
            selections: provenance.complete
              ? [{ key: MOUNTED_WORKSPACE_FILES_PROVENANCE_KEY, provenance }]
              : [],
          }
          enrichedParams[PRIVATE_SECRET_PROVENANCE_FIELD] = bundle
        }
      }
    }

    enrichedParams._context = {
      userId: context.userId,
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      chatId: context.chatId,
      executionId: context.executionId,
      runId: context.runId,
      enforceCredentialAccess: true,
    }

    try {
      /**
       * The copilot-facing tool is named `run_function`, but the app-tool
       * registry id stays `function_execute` — the validator in tools/index.ts
       * only admits `internalSandboxProfile` for that id, and every copilot
       * call carries the internal `mothership` profile. Renaming this inner id
       * without renaming the registry breaks every copilot sandbox call with
       * "An internal sandbox profile may only be used with function_execute".
       */
      const result = await executeAppTool('function_execute', enrichedParams, {
        resolvedSecretTraceRegistry: mountedRegistry,
        operationContext: {
          userId: context.userId,
          workflowId: context.workflowId,
          workspaceId: context.workspaceId,
          executionId: context.executionId,
          executorDelegationOrigin: {
            subjectUserId: context.userId,
            workflowId: context.workflowId,
            ...(context.executionId ? { executionId: context.executionId } : {}),
          },
          copilotToolExecution: context.copilotToolExecution,
          billingAttribution: context.billingAttribution,
          resolvedSecretTraceRegistry: mountedRegistry,
        },
        ...(context.abortSignal ? { signal: context.abortSignal } : {}),
        ...(context.sandboxProfile ? { internalSandboxProfile: context.sandboxProfile } : {}),
      })
      crossingValue = result
      return result
    } catch (error) {
      crossingValue = error
      throw error
    }
  } finally {
    if (mountedRegistry && crossingValue !== undefined) {
      await importMountedProvenance(
        mountedRegistry,
        context.resolvedSecretTraceRegistry,
        crossingValue
      )
    }
    /**
     * Copilot-run code is a real read of a workspace secret and has to appear in the trail;
     * without this an admin reviewing a secret sees "never used" for one someone read through
     * Mothership. Read from the registry rather than `requestedNames` so only names the code
     * actually resolved are counted. The headless inbox runner reaches the same handler, so
     * it is covered here too.
     */
    if (mountedRegistry && context.workspaceId) {
      recordSecretUsage(mountedRegistry.getResolvedSecretUsage(), {
        workspaceId: context.workspaceId,
        source: 'copilot',
        actorUserId: secretActorUserId ?? null,
        trigger: 'copilot',
      })
    }
    completePendingActivation?.()
  }
}
