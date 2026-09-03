import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { omit } from '@sim/utils/object'
import { hasWorkspaceSandboxAccess } from '@/lib/billing/core/subscription'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import type { PrivateSecretProvenanceBundleV1 } from '@/lib/execution/model-input-provenance'
import {
  MOUNTED_WORKSPACE_FILES_PROVENANCE_KEY,
  PRIVATE_SECRET_PROVENANCE_FIELD,
} from '@/lib/execution/private-tool-metadata'
import type { SandboxFile } from '@/lib/execution/remote-sandbox/types'
import { MAX_PLAN_REQUIRED } from '@/lib/execution/remote-sandbox/workspace-sandboxes'
import {
  createSandboxMountBudget,
  MAX_INLINE_MOUNT_FILE_BYTES,
  MAX_INLINE_MOUNT_TOTAL_BYTES,
  MAX_TOTAL_URL_BYTES,
  MOUNT_URL_TTL_SECONDS,
  pushSandboxFileMount,
  type SandboxMountBudget,
} from '@/lib/function-execution/sandbox-mounts'
import { resolveCopilotFilePrincipal } from '@/lib/mothership/auth/file-delegation'
import { applySecretMountPolicy } from '@/lib/mothership/secret-mount-policy'
import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from '@/lib/mothership/tool-executor/types'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session'
import {
  CopilotCodeSecretAccessError,
  type MaterializedCopilotCodeSecrets,
  materializeCopilotCodeSecrets,
} from '@/lib/mothership/tools/secret-mount-materializer.server'
import { decodeVfsPathSegments, encodeVfsPathSegments } from '@/lib/mothership/vfs/path-utils'
import { recordSecretUsage } from '@/lib/secrets/usage/record'
import { getTableSnapshotModelMountSafety } from '@/lib/table/rows/secret-provenance'
import { getTableById, listTables } from '@/lib/table/service'
import { getOrCreateTableSnapshot, SNAPSHOT_MAX_BYTES } from '@/lib/table/snapshot-cache'
import {
  findWorkspaceFileRecord,
  getSandboxWorkspaceFilePath,
  parseChatUploadReference,
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
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
import { downloadWorkspaceFileRecord } from '@/lib/workspace-files/application/read-workspace-file-record'
import { resolveWorkspaceFileReference } from '@/lib/workspace-files/application/resolve-workspace-file-reference'
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
    return 'uploads/ holds chat uploads addressed as "uploads/<name>" with no folders beneath it. Copy the exact "uploads/<name>" path from the upload notice.'
  }
  if (path.startsWith('internal/tool-results/')) {
    return 'tool-result artifacts are stored by the copilot backend, not in workspace storage, so `outputs get` reaches them but the sandbox cannot. This path is correct — searching for a different one will not find anything. Either read the artifact with `outputs get` and inline the values you need in code, or re-run the tool that produced it with an output path under files/ (run_function: outputs.files[].path, user_table: outputPath) and mount that files/... path.'
  }
  if (path.startsWith('internal/')) {
    return 'internal/ paths are served by the copilot backend, not from workspace storage, so the sandbox cannot mount them. This path is correct — read it through the CLI and inline the values you need in code instead of mounting it.'
  }
  if (path.startsWith('recently-deleted/')) {
    return 'deleted resources are not mountable into the sandbox. Restore it first (`files restore <fileId>`), then mount the restored files/... path.'
  }
  if (path.startsWith('tables/')) {
    return 'tables are not mounted as files. Pass the table in inputs.tables instead and it is mounted as CSV.'
  }
  const namespace = /^(workflows|knowledgebases|components|environment|agent)\//.exec(path)?.[1]
  if (namespace) {
    return `${namespace}/ paths are VFS metadata views, not stored file bytes, so the sandbox cannot mount them. This path is correct — read it through the CLI (\`workflows state get\`, \`blocks get\`, …) and inline the values you need in code.`
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

/**
 * Model-authored refs arrive as a bare string or a canonical-input record; every read is
 * typeof-guarded here once instead of per-site casts (three sites had drifted copies).
 */
function refField(ref: unknown, key: 'path' | 'tableId' | 'sandboxPath'): string | undefined {
  if (typeof ref === 'string') return key === 'sandboxPath' ? undefined : ref
  if (ref && typeof ref === 'object') {
    const value = (ref as Record<string, unknown>)[key]
    return typeof value === 'string' && value.length > 0 ? value : undefined
  }
  return undefined
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

/**
 * Locates one `inputs.files[].path`. Chat uploads are absent from the workspace listing
 * by design, so an `uploads/<name>` reference resolves through the read-content
 * reference use case — the only path that may reach a chat upload — and a miss there
 * is the honest not-found rather than a hint to go looking elsewhere.
 */
async function resolveMountableWorkspaceFile(
  allFiles: WorkspaceFileRecord[],
  filePath: string,
  workspaceId: string,
  principal: Principal
): Promise<WorkspaceFileRecord> {
  const listed = findWorkspaceFileRecord(allFiles, filePath)
  if (listed) return listed

  if (parseChatUploadReference(filePath) !== null) {
    try {
      return await resolveWorkspaceFileReference({
        principal,
        operation: fileOperations.readContent,
        workspaceId,
        reference: filePath,
      })
    } catch (error) {
      if (!(error instanceof OrchestrationError && error.code === 'not_found')) throw error
      throw new Error(
        `Input file not found: "${filePath}". Copy the exact "uploads/<name>" path from the upload notice.`
      )
    }
  }

  const unmountable = unmountableNamespaceReason(filePath)
  if (unmountable) {
    throw new Error(`Cannot mount "${filePath}": ${unmountable}`)
  }
  throw new Error(
    `Input file not found: "${filePath}". Pass the exact path as \`files ls\` / \`files list\` prints it (e.g. "files/Reports/data.csv").`
  )
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
      const filePath = refField(fileRef, 'path')
      if (!filePath) continue
      const record = await resolveMountableWorkspaceFile(
        allFiles,
        filePath,
        workspaceId,
        filePrincipal
      )
      const mountPath = refField(fileRef, 'sandboxPath') ?? getSandboxWorkspaceFilePath(record)
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
      const dirPath = refField(dirRef, 'path')
      if (!dirPath) continue
      const folderSegments = decodeVfsPathSegments(dirPath.replace(/^\/?files\/?/, ''))
      const folderDisplayPath = buildWorkspaceFileFolderDisplayPath(folderSegments)
      const folder = folders.find((candidate) => candidate.path === folderDisplayPath)
      if (!folder) {
        const unmountable = unmountableNamespaceReason(dirPath)
        throw new Error(
          unmountable
            ? `Cannot mount "${dirPath}": ${unmountable}`
            : `Input directory not found: "${dirPath}". Pass a workspace folder path as \`files ls\` prints it (e.g. "files/Reports").`
        )
      }
      const mountRoot =
        refField(dirRef, 'sandboxPath') ??
        `/home/user/files/${encodeVfsPathSegments(parseWorkspaceFileFolderDisplayPath(folder.path))}`
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
    const tableRefId = (tableRef: unknown): string | undefined =>
      refField(tableRef, 'tableId') ?? refField(tableRef, 'path')
    const hasTablePathRefs = inputTables.some((tableRef) =>
      tableRefId(tableRef)?.startsWith('tables/')
    )
    const tablePathLookup = hasTablePathRefs
      ? new Map((await listTables(workspaceId)).map((table) => [table.name, table]))
      : undefined
    for (const tableRef of inputTables) {
      const tableId = tableRefId(tableRef)
      if (!tableId) continue
      const table = await resolveTableRef(tableId, tablePathLookup)
      if (!table || table.workspaceId !== workspaceId) {
        throw new Error(
          `Input table not found: "${tableId}". Pass the table id (tbl_...) from \`tables list\`, or its tables/<name> path.`
        )
      }
      const mountPath = refField(tableRef, 'sandboxPath') ?? `/home/user/tables/${table.id}.csv`

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
  const enrichedParams = omit(params, [
    'sandboxProfile',
    'internalSandboxProfile',
    // Server-derived below — a model-supplied value must never select a session.
    'sandboxSessionKey',
    PRIVATE_SECRET_PROVENANCE_FIELD,
  ])
  // One persistent session sandbox per chat: files and installed packages
  // survive across run_code calls for iterative work, and the sim CLI is
  // bootstrapped into it. Chat-less executions (one-shot, headless) stay
  // ephemeral.
  if (context.chatId) {
    enrichedParams.sandboxSessionKey = chatSandboxSessionKey(context.chatId)
  }
  // The copilot tool doc promises `timeout` in SECONDS ("Sim converts to
  // milliseconds", default 10, cap 300); the underlying function tool takes
  // MILLISECONDS. Nothing converted, so `timeout: 120` armed a 120ms abort.
  // Values ≤ 600 are read as seconds; larger values are assumed to already be
  // milliseconds (a model habit worth tolerating). Both clamp to the 300s cap.
  // Models also send the value as a STRING ("90") — without the tolerant parse
  // here, the body schema's z.coerce turned that into a 90ms budget.
  if (typeof enrichedParams.timeout === 'string' && enrichedParams.timeout.trim() !== '') {
    const parsed = Number(enrichedParams.timeout)
    if (Number.isFinite(parsed)) enrichedParams.timeout = parsed
  }
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
    context.secretActorUserId === undefined ? context.userId : context.secretActorUserId

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
