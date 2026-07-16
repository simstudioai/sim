import { trace } from '@opentelemetry/api'
import { db } from '@sim/db'
import {
  chat as chatTable,
  copilotChats,
  document,
  jobExecutionLogs,
  knowledgeConnector,
  mcpServers as mcpServersTable,
  workflowDeploymentVersion,
  workflowExecutionLogs,
  workflowFolder,
  workflowMcpServer,
  workflowMcpTool,
  workflowSchedule,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import { listApiKeys } from '@/lib/api-key/service'
import {
  buildWorkspaceContextMd,
  buildWorkspaceMd,
  type WorkspaceMdData,
} from '@/lib/copilot/chat/workspace-context'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { getExposedIntegrationTools } from '@/lib/copilot/integration-tools'
import { recordVfsMaterialize } from '@/lib/copilot/request/metrics'
import { markSpanForError } from '@/lib/copilot/request/otel'
import { compileDoc, getE2BDocFormat } from '@/lib/copilot/tools/server/files/doc-compile'
import { extractDocText, isExtractableDocExt } from '@/lib/copilot/tools/server/files/doc-extract'
import { runE2BCompiledCheck } from '@/lib/copilot/tools/server/files/doc-recalc'
import { isRenderableDocExt, renderDocToGrid } from '@/lib/copilot/tools/server/files/doc-render'
import {
  collectWorkflowFieldIssues,
  lintEditedWorkflowState,
} from '@/lib/copilot/tools/server/workflow/edit-workflow/lint'
import { UNRESOLVABLE_AT_LINT_NOTE } from '@/lib/copilot/tools/server/workflow/edit-workflow/validation'
import { extractDocumentStyle } from '@/lib/copilot/vfs/document-style'
import { type FileReadResult, readFileRecord } from '@/lib/copilot/vfs/file-reader'
import { normalizeVfsSegment } from '@/lib/copilot/vfs/normalize-segment'
import type { GrepMatch, GrepOptions, ReadResult } from '@/lib/copilot/vfs/operations'
import * as ops from '@/lib/copilot/vfs/operations'
import {
  buildVfsFolderPathMap,
  canonicalWorkflowVfsDir,
  canonicalWorkspaceFilePath,
  encodeVfsPathSegments,
} from '@/lib/copilot/vfs/path-utils'
import type { DeploymentData } from '@/lib/copilot/vfs/serializers'
import {
  serializeApiKeys,
  serializeBlockSchema,
  serializeBuiltinTriggerSchema,
  serializeConnectorOverview,
  serializeConnectorSchema,
  serializeConnectors,
  serializeCredentials,
  serializeCustomTool,
  serializeDeployments,
  serializeDocuments,
  serializeEnvironmentVariables,
  serializeFileMeta,
  serializeIntegrationSchema,
  serializeJobMeta,
  serializeKBMeta,
  serializeMcpServer,
  serializeRecentExecutions,
  serializeSkill,
  serializeTableMeta,
  serializeTaskChat,
  serializeTaskSession,
  serializeTriggerOverview,
  serializeTriggerSchema,
  serializeVersions,
  serializeWorkflowMeta,
} from '@/lib/copilot/vfs/serializers'
import {
  buildWorkflowAliasLinks,
  isWorkflowAliasBackingPath,
  WORKFLOW_ALIAS_LINKS_NAME,
  WORKFLOW_CHANGELOG_ALIAS_NAME,
  WORKFLOW_PLANS_ALIAS_DIR,
  WORKFLOW_PLANS_BACKING_FOLDER,
  WORKSPACE_PLANS_BACKING_FOLDER,
  workflowChangelogBackingPath,
  workspacePlanBackingPath,
  workspacePlansBackingFolderPath,
} from '@/lib/copilot/vfs/workflow-aliases'
import type { BlockVisibilityState } from '@/lib/core/config/block-visibility'
import { isE2BDocEnabled } from '@/lib/core/config/env-flags'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import {
  getAccessibleEnvCredentials,
  getAccessibleOAuthCredentials,
} from '@/lib/credentials/environment'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { BINARY_DOC_TASKS, MAX_DOCUMENT_PREVIEW_CODE_BYTES } from '@/lib/execution/constants'
import { runSandboxTask, SandboxUserCodeError } from '@/lib/execution/sandbox/run-task'
import { getKnowledgeBases } from '@/lib/knowledge/service'
import { validateMermaidSource } from '@/lib/mermaid/validate'
import { listTables } from '@/lib/table/service'
import { listWorkspaceFileFolders } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
  fetchWorkspaceFileBuffer,
  findWorkspaceFileRecord,
  listWorkspaceFiles,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { listCustomBlocksWithInputsForWorkspace } from '@/lib/workflows/custom-blocks/operations'
import { listCustomTools } from '@/lib/workflows/custom-tools/operations'
import {
  loadWorkflowDeploymentSnapshot,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'
import { listSkillsForUser } from '@/lib/workflows/skills/operations'
import { listFolders, listWorkflows } from '@/lib/workflows/utils'
import {
  assertActiveWorkspaceAccess,
  getUsersWithPermissions,
  getWorkspaceWithOwner,
  hasWorkspaceAdminAccess,
} from '@/lib/workspaces/permissions/utils'
import { computeNeedsRedeployment } from '@/app/api/workflows/utils'
import { buildCustomBlockConfig, isCustomBlockType } from '@/blocks/custom/build-config'
import { BLOCK_REGISTRY } from '@/blocks/registry-maps'
import type { BlockConfig, BlockIcon } from '@/blocks/types'
import { isHiddenUnder, overlayVisibility } from '@/blocks/visibility/context'
import { CONNECTOR_REGISTRY } from '@/connectors/registry.server'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { TRIGGER_REGISTRY } from '@/triggers/registry'

const logger = createLogger('WorkspaceVFS')

/** Placeholder icon for custom-block configs — `serializeBlockSchema` never reads it. */
// double-cast-allowed: a no-op stands in for the unused SVG-typed BlockIcon slot
const PLACEHOLDER_BLOCK_ICON = (() => null) as unknown as BlockIcon
const MAX_COMPILED_ATTACHMENT_BYTES = 5 * 1024 * 1024

/**
 * Static component files, computed once and shared across all VFS instances.
 * Built from the UNGATED registry universe (preview blocks included) so this
 * process-global cache can never be poisoned by one viewer's gated projection;
 * per-viewer gating is applied when the map is stamped into each fresh VFS
 * (see {@link isStaticFileHidden}).
 */
let staticComponentFiles: Map<string, string> | null = null

/**
 * Owning block for each `components/integrations/**` file, recorded at build
 * time. Block/trigger schema files carry their owning type as the path
 * basename, but integration paths use the version-stripped service name — so
 * their owners need this lookup for the stamp-time visibility filter.
 */
const integrationPathOwners = new Map<string, Pick<BlockConfig, 'type' | 'preview'>>()

/**
 * Owning block(s) for each `components/triggers/{provider}/{id}.json` file,
 * recorded at build time by inverting each block's `triggers.available`.
 * External-trigger paths are keyed on the trigger id + provider (not a block
 * type), so — like integration paths — they need this lookup for the stamp-time
 * visibility filter. A trigger can be reachable from more than one block (e.g. a
 * GA block and its preview successor), so this holds an array and the trigger is
 * hidden only when EVERY owning block is hidden.
 */
const triggerPathOwners = new Map<string, Array<Pick<BlockConfig, 'type' | 'preview'>>>()

/**
 * Per-request visibility filter for the shared static files: hides files whose
 * owning block is gated for this viewer (unrevealed preview blocks — the
 * default with no context — and kill-switched types). Non-registry paths
 * (loop/parallel, connectors, overviews) are always visible.
 */
function isStaticFileHidden(path: string, vis: BlockVisibilityState | null): boolean {
  const blockMatch = path.match(/^components\/(?:blocks|triggers\/sim)\/([^/]+)\.json$/)
  if (blockMatch) {
    const config = BLOCK_REGISTRY[blockMatch[1]!]
    return config ? isHiddenUnder(vis, config) : false
  }
  const triggerOwners = triggerPathOwners.get(path)
  if (triggerOwners) {
    return triggerOwners.length > 0 && triggerOwners.every((owner) => isHiddenUnder(vis, owner))
  }
  const owner = integrationPathOwners.get(path)
  return owner ? isHiddenUnder(vis, owner) : false
}

// On-the-fly doc reads (render/extract) download the binary into the Sim process
// and base64-stage it to E2B, so bound the input like the compile path's staging
// caps — otherwise an authenticated member could OOM the worker with a multi-GB
// upload (uploads are capped at 5GB).
const MAX_DOC_READ_INPUT_BYTES = 50 * 1024 * 1024

/**
 * True when the buffer is an actual compiled/uploaded binary (vs a source-backed
 * generated doc). OOXML (pptx/docx/xlsx) is a ZIP (starts `PK`); PDFs may carry a
 * BOM or leading whitespace before `%PDF`, so scan the head rather than offset 0.
 */
function isBinaryDocBuffer(buffer: Buffer, ext: string): boolean {
  if (ext === 'pdf') return buffer.subarray(0, 1024).toString('latin1').includes('%PDF')
  return buffer.subarray(0, 2).toString('latin1') === 'PK'
}

/**
 * Build the static component files from block and tool registries.
 * This only needs to happen once per process.
 *
 * Integration paths are derived deterministically from the block registry's
 * `tools.access` arrays rather than splitting tool IDs on underscores.
 * Each block declares which tools it owns, and the block type (minus version
 * suffix) becomes the service directory name.
 */
function getStaticComponentFiles(): Map<string, string> {
  if (staticComponentFiles) return staticComponentFiles

  const files = new Map<string, string>()

  // Raw registry, never the visibility-projected getAllBlocks: this map is a
  // process-global shared cache, so it must hold the deterministic ungated
  // universe. Preview blocks get schema files here (path-filterable at stamp
  // time for revealed viewers) but are EXCLUDED from the shared aggregate
  // files (overviews, oauth/api-key summaries) that all viewers receive.
  const allBlocks = Object.values(BLOCK_REGISTRY)
  const visibleBlocks = allBlocks.filter((b) => !b.hideFromToolbar)

  let blocksFiltered = 0
  for (const block of visibleBlocks) {
    const path = `components/blocks/${block.type}.json`
    files.set(path, serializeBlockSchema(block))
  }
  blocksFiltered = allBlocks.length - visibleBlocks.length

  let integrationCount = 0

  const oauthServices = new Map<string, { provider: string; operations: string[] }>()
  const apiKeyServices = new Map<string, { params: string[]; operations: string[] }>()

  // Integration tools come from the shared exposed-tool set (latest version of
  // each operation owned by a visible block), the same set used to build the
  // deferred callable tools — so discovery and execution can never drift.
  for (const exposedTool of getExposedIntegrationTools()) {
    const { config: tool, service, operation, blockType, preview } = exposedTool
    const path = `components/integrations/${service}/${operation}.json`
    files.set(path, serializeIntegrationSchema(tool))
    integrationPathOwners.set(path, { type: blockType, preview })
    integrationCount++

    // Preview-owned tools stay out of the shared oauth/api-key aggregates —
    // those files are identical for every viewer.
    if (preview) continue

    if (tool.oauth?.required) {
      const existing = oauthServices.get(service)
      if (existing) {
        existing.operations.push(operation)
      } else {
        oauthServices.set(service, { provider: tool.oauth.provider, operations: [operation] })
      }
    } else if (tool.hosting?.apiKeyParam) {
      const existing = apiKeyServices.get(service)
      if (existing) {
        if (!existing.params.includes(tool.hosting.apiKeyParam)) {
          existing.params.push(tool.hosting.apiKeyParam)
        }
        existing.operations.push(operation)
      } else {
        apiKeyServices.set(service, {
          params: [tool.hosting.apiKeyParam],
          operations: [operation],
        })
      }
    }
  }

  files.set(
    'environment/oauth-integrations.json',
    JSON.stringify(Object.fromEntries(oauthServices), null, 2)
  )
  files.set(
    'environment/api-key-integrations.json',
    JSON.stringify(Object.fromEntries(apiKeyServices), null, 2)
  )

  files.set(
    'components/blocks/loop.json',
    JSON.stringify(
      {
        type: 'loop',
        name: 'Loop',
        description:
          'Iterate over a collection or repeat a fixed number of times. Blocks inside the loop run once per iteration.',
        inputs: {
          loopType: {
            type: 'string',
            enum: ['for', 'forEach', 'while', 'doWhile'],
            description: 'Loop strategy',
          },
          iterations: { type: 'number', description: 'Number of iterations (for loopType "for")' },
          collection: {
            type: 'string',
            description: 'Collection expression to iterate (for loopType "forEach")',
          },
          condition: {
            type: 'string',
            description: 'Condition expression (for loopType "while" or "doWhile")',
          },
        },
        sourceHandles: ['loop-start-source', 'loop-end-source'],
        notes:
          'Use "loop-start-source" to connect to blocks INSIDE the loop. Use "loop-end-source" for the edge that runs AFTER the loop completes. Do NOT use "source" for a loop block — it is rejected; the only valid source handles are "loop-start-source", "loop-end-source", and "error". Blocks inside the loop must have parentId set to the loop block ID.',
      },
      null,
      2
    )
  )

  files.set(
    'components/blocks/parallel.json',
    JSON.stringify(
      {
        type: 'parallel',
        name: 'Parallel',
        description: 'Run blocks in parallel branches. All branches execute concurrently.',
        inputs: {
          parallelType: {
            type: 'string',
            enum: ['count', 'collection'],
            description: 'Parallel strategy',
          },
          count: {
            type: 'number',
            description: 'Number of parallel branches (for parallelType "count")',
          },
          collection: {
            type: 'string',
            description: 'Collection to distribute (for parallelType "collection")',
          },
        },
        sourceHandles: ['parallel-start-source', 'parallel-end-source'],
        notes:
          'Use "parallel-start-source" to connect to blocks INSIDE the parallel container. Use "parallel-end-source" for the edge AFTER all branches complete. Do NOT use "source" for a parallel block — it is rejected; the only valid source handles are "parallel-start-source", "parallel-end-source", and "error". Blocks inside must have parentId set to the parallel block ID.',
      },
      null,
      2
    )
  )

  const connectorConfigs = Object.values(CONNECTOR_REGISTRY).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    version: c.version,
    auth: c.auth,
    configFields: c.configFields,
    tagDefinitions: c.tagDefinitions,
    supportsIncrementalSync: c.supportsIncrementalSync,
  }))

  files.set('knowledgebases/connectors/connectors.md', serializeConnectorOverview(connectorConfigs))
  for (const cc of connectorConfigs) {
    files.set(`knowledgebases/connectors/${cc.id}.json`, serializeConnectorSchema(cc))
  }

  const builtinTriggerBlocks = allBlocks.filter((b) => b.category === 'triggers')
  for (const block of builtinTriggerBlocks) {
    files.set(`components/triggers/sim/${block.type}.json`, serializeBuiltinTriggerSchema(block))
  }

  // Attribute each external trigger to its owning block(s) by inverting
  // `triggers.available` — the same block-visibility rules that gate a block's
  // schema file then gate its triggers' schema files at stamp time.
  for (const block of allBlocks) {
    for (const triggerId of block.triggers?.available ?? []) {
      const trigger = TRIGGER_REGISTRY[triggerId]
      if (!trigger) continue
      const path = `components/triggers/${trigger.provider}/${triggerId}.json`
      const owners = triggerPathOwners.get(path)
      const owner = { type: block.type, preview: block.preview }
      if (owners) owners.push(owner)
      else triggerPathOwners.set(path, [owner])
    }
  }

  let externalTriggerCount = 0
  for (const [triggerId, trigger] of Object.entries(TRIGGER_REGISTRY)) {
    const path = `components/triggers/${trigger.provider}/${triggerId}.json`
    files.set(path, serializeTriggerSchema(trigger))
    externalTriggerCount++
  }

  files.set(
    'components/triggers/triggers.md',
    serializeTriggerOverview(
      // The overview is a shared file — preview trigger blocks stay out of it
      // (their per-type schema file remains discoverable for revealed viewers).
      builtinTriggerBlocks
        .filter((b) => !b.preview)
        .map((b) => ({
          id: b.type,
          name: b.name,
          provider: 'sim',
          description: b.description,
        })),
      // Same for external triggers: a trigger owned solely by preview blocks is
      // hidden under the null (no-viewer) state this shared file is built with.
      Object.entries(TRIGGER_REGISTRY)
        .filter(
          ([id, t]) => !isStaticFileHidden(`components/triggers/${t.provider}/${id}.json`, null)
        )
        .map(([id, t]) => ({
          id,
          name: t.name,
          provider: t.provider,
          description: t.description,
        }))
    )
  )

  logger.info('Static component files built', {
    blocks: visibleBlocks.length,
    blocksFiltered,
    integrations: integrationCount,
    connectors: connectorConfigs.length,
    builtinTriggers: builtinTriggerBlocks.length,
    externalTriggers: externalTriggerCount,
  })

  staticComponentFiles = files
  return staticComponentFiles
}

/**
 * Virtual Filesystem that materializes workspace data into an in-memory Map.
 *
 * Structure:
 *   WORKSPACE_CONTEXT.md                 — full dynamic workspace/user context (auto-generated)
 *   WORKSPACE.md                         — workspace inventory summary (auto-generated)
 *   workflows/{name}/meta.json            (root-level workflows)
 *   workflows/{name}/state.json          (sanitized blocks with embedded connections)
 *   workflows/{name}/lint.json           (sources/sinks, required-field, credential/resource issues)
 *   workflows/{name}/executions.json
 *   workflows/{name}/deployment.json
 *   workflows/{folder}/{name}/...        (workflows inside folders, nested folders supported)
 *   knowledgebases/{name}/meta.json
 *   knowledgebases/{name}/documents.json
 *   knowledgebases/{name}/connectors.json
 *   tables/{name}/meta.json
 *   files/{name}                         (workspace file leaf; dynamic content on read)
 *   files/{path}/{name}/style            (dynamic — style extraction for .docx/.pptx/.pdf)
 *   files/{path}/{name}/compiled-check   (dynamic — compile generated source / validate diagrams, returns {ok,error?})
 *   jobs/{title}/meta.json
 *   jobs/{title}/history.json
 *   jobs/{title}/executions.json
 *   tasks/{title}/session.md
 *   tasks/{title}/chat.json
 *   custom-tools/{name}.json
 *   environment/credentials.json
 *   environment/api-keys.json
 *   environment/variables.json
 *   knowledgebases/connectors/connectors.md  (available connector types overview)
 *   knowledgebases/connectors/{type}.json    (per-connector config schema)
 *   components/blocks/{type}.json
 *   components/integrations/{service}/{operation}.json
 *   components/triggers/triggers.md                  (overview of all built-in and external triggers)
 *   components/triggers/sim/{type}.json               (built-in trigger blocks: start, schedule, webhook)
 *   components/triggers/{provider}/{id}.json           (external triggers: github, slack, etc.)
 */
export class WorkspaceVFS {
  // Eagerly-materialized, cheap content (structure + metadata): folder markers,
  // per-resource meta.json, WORKSPACE.md/WORKSPACE_CONTEXT.md, static components.
  private files: Map<string, string> = new Map()
  // Lazily-materialized, expensive content keyed by VFS path. The loader runs on
  // demand: a `read` resolves exactly one entry; a scoped `grep` resolves only
  // the entries within its scope; an unscoped `grep` resolves all; a `glob` never
  // resolves any (it matches keys only). This is why a read/glob no longer pays
  // for every workflow's graph-load + lint + stringify — only grep over contents
  // does, and only for what it actually scans.
  private lazy: Map<string, () => Promise<string | null>> = new Map()
  // Per-instance (per-tool-call) memo so state.json + lint.json for the same
  // workflow share one normalized-table load, and deployment.json + versions.json
  // share one deployment query.
  private normalizedCache = new Map<
    string,
    Promise<Awaited<ReturnType<typeof loadWorkflowFromNormalizedTables>>>
  >()
  private deploymentCache = new Map<string, Promise<DeploymentData | null>>()
  private _workspaceId = ''
  private _betaEnabled = false
  /**
   * Types of the org's CURRENT custom blocks (enabled + disabled — a disabled block
   * still resolves/renders). Populated by {@link materializeCustomBlocks}; used to
   * drop a placed custom block from a workflow's state when its definition has been
   * deleted, so the copilot never sees a block it can't render.
   *
   * `null` means "not loaded" — either not materialized yet or the load FAILED. In
   * that case {@link dropDeletedCustomBlocks} strips nothing, so a transient failure
   * can't wrongly nuke every placed custom block. An empty `Set` is distinct: it
   * means the org genuinely has no custom blocks, so any placed one IS deleted.
   */
  private _customBlockTypes: Set<string> | null = null

  get workspaceId(): string {
    return this._workspaceId
  }

  /** Register a VFS path whose (expensive) content is produced on demand. */
  private registerLazy(path: string, loader: () => Promise<string | null>): void {
    this.lazy.set(path, loader)
  }

  /**
   * Load a workflow's normalized state once per instance. state.json and lint.json
   * both need it, and a grep over a workflow's dir touches both — without this they
   * would each re-load the full block graph.
   */
  private loadNormalized(
    workflowId: string
  ): Promise<Awaited<ReturnType<typeof loadWorkflowFromNormalizedTables>>> {
    let cached = this.normalizedCache.get(workflowId)
    if (!cached) {
      cached = loadWorkflowFromNormalizedTables(workflowId).then((n) =>
        this.dropDeletedCustomBlocks(n)
      )
      this.normalizedCache.set(workflowId, cached)
    }
    return cached
  }

  /**
   * Strip placed custom blocks whose definition no longer exists from a loaded
   * workflow (and any edges touching them), so the copilot never sees a block it
   * can't render — mirroring how the serializer drops an unresolvable custom block.
   * A live definition (enabled or disabled) is kept; only a DELETED one is removed.
   * Runs lazily (after materialize), so `_customBlockTypes` is populated by then.
   */
  private dropDeletedCustomBlocks(
    normalized: Awaited<ReturnType<typeof loadWorkflowFromNormalizedTables>>
  ): Awaited<ReturnType<typeof loadWorkflowFromNormalizedTables>> {
    // `null` = definitions never loaded (or the load failed) — strip nothing rather
    // than treat every placed custom block as deleted.
    if (!normalized || this._customBlockTypes === null) return normalized
    const validTypes = this._customBlockTypes
    const dropped = new Set<string>()
    const blocks: Record<string, unknown> = {}
    for (const [id, block] of Object.entries(normalized.blocks)) {
      const type = (block as { type?: string }).type
      if (isCustomBlockType(type) && !validTypes.has(type)) {
        dropped.add(id)
        continue
      }
      blocks[id] = block
    }
    if (dropped.size === 0) return normalized
    const edges = (normalized.edges ?? []).filter(
      (e) => !dropped.has(e.source) && !dropped.has(e.target)
    )
    return { ...normalized, blocks: blocks as typeof normalized.blocks, edges }
  }

  /** Load a workflow's deployment data once per instance (deployment.json + versions.json share it). */
  private loadDeployments(wf: {
    id: string
    isDeployed: boolean
    deployedAt: Date | null
  }): Promise<DeploymentData | null> {
    let cached = this.deploymentCache.get(wf.id)
    if (!cached) {
      cached = this.getWorkflowDeployments(wf.id, this._workspaceId, wf.isDeployed, wf.deployedAt)
      this.deploymentCache.set(wf.id, cached)
    }
    return cached
  }

  /**
   * Resolve a single lazy artifact into {@link files}. Idempotent: once resolved
   * the entry moves to `files` and the loader is dropped. A loader that returns
   * null (no data) leaves nothing behind, so the path reads as "not found".
   */
  private async resolveLazyPath(path: string): Promise<string | null> {
    const existing = this.files.get(path)
    if (existing !== undefined) return existing
    const loader = this.lazy.get(path)
    if (!loader) return null
    this.lazy.delete(path)
    let content: string | null = null
    try {
      content = await loader()
    } catch (err) {
      logger.warn('Failed to resolve lazy VFS artifact', {
        workspaceId: this._workspaceId,
        path,
        error: toError(err).message,
      })
      content = null
    }
    if (content !== null) this.files.set(path, content)
    return content
  }

  /**
   * Resolve every lazy artifact a grep over `scope` will scan, in parallel. An
   * undefined scope (unscoped grep) resolves all — the worst case, equivalent to
   * the old eager full materialize, but now only paid by an unscoped grep.
   * Uses the same scope matcher as {@link ops.grep} so the materialized set is
   * exactly the set grep filters in.
   */
  private async resolveLazyWithinScope(scope?: string): Promise<void> {
    const targets: string[] = []
    for (const path of this.lazy.keys()) {
      if (!scope || ops.pathWithinGrepScope(path, scope)) targets.push(path)
    }
    if (targets.length === 0) return
    await Promise.all(targets.map((path) => this.resolveLazyPath(path)))
  }

  /**
   * `recently-deleted/` artifacts are opt-in: excluded from the active view
   * unless a path/pattern explicitly scopes into them.
   */
  private isRecentlyDeleted(key: string): boolean {
    return key.startsWith('recently-deleted/')
  }

  /**
   * A keys-only view (eager values plus empty placeholders for unresolved lazy
   * paths) for glob/suggestSimilar, which match on keys and never read content.
   */
  private keyView(includeDeleted: boolean): Map<string, string> {
    const view = new Map<string, string>()
    for (const [key, value] of this.files) {
      if (includeDeleted || !this.isRecentlyDeleted(key)) view.set(key, value)
    }
    for (const key of this.lazy.keys()) {
      if ((includeDeleted || !this.isRecentlyDeleted(key)) && !view.has(key)) {
        view.set(key, '')
      }
    }
    return view
  }

  /**
   * Materialize workspace data into the VFS.
   * Uses shared service functions for all data access, then generates
   * WORKSPACE.md from the summaries returned by each materializer.
   */
  async materialize(workspaceId: string, userId: string): Promise<void> {
    const start = Date.now()
    this.files = new Map()
    this.lazy = new Map()
    this.normalizedCache = new Map()
    this.deploymentCache = new Map()
    this._customBlockTypes = null
    this._workspaceId = workspaceId
    this._betaEnabled = await isFeatureEnabled('mothership-beta', { userId })

    // Per-phase wall-clock, stamped on the span so a slow materialize in a
    // trace names its bottleneck instead of showing up as unattributed dead
    // time inside read/glob/grep (how the v0.7 lint.json regression hid).
    const phaseMs: Record<string, number> = {}
    const timed = <T>(phase: string, promise: Promise<T>): Promise<T> => {
      const t0 = Date.now()
      return promise.finally(() => {
        phaseMs[phase] = Date.now() - t0
      })
    }

    await trace
      .getTracer('sim-copilot-vfs', '1.0.0')
      .startActiveSpan(
        TraceSpan.CopilotVfsMaterialize,
        { attributes: { [TraceAttr.WorkspaceId]: workspaceId } },
        async (span) => {
          try {
            const [
              wfSummary,
              kbSummary,
              tblSummary,
              fileSummary,
              envSummary,
              toolsSummary,
              customBlocksSummary,
              mcpServersSummary,
              skillsSummary,
              taskSummary,
              jobsSummary,
              wsRow,
              members,
            ] = await Promise.all([
              timed('workflows', this.materializeWorkflows(workspaceId)),
              timed('knowledge_bases', this.materializeKnowledgeBases(workspaceId, userId)),
              timed('tables', this.materializeTables(workspaceId)),
              timed('files', this.materializeFiles(workspaceId)),
              timed('environment', this.materializeEnvironment(workspaceId, userId)),
              timed('custom_tools', this.materializeCustomTools(workspaceId, userId)),
              timed('custom_blocks', this.materializeCustomBlocks(workspaceId)),
              timed('mcp_servers', this.materializeMcpServers(workspaceId)),
              timed('skills', this.materializeSkills(workspaceId, userId)),
              timed('tasks', this.materializeTasks(workspaceId, userId)),
              timed('jobs', this.materializeJobs(workspaceId)),
              timed('workspace_row', getWorkspaceWithOwner(workspaceId)),
              timed('members', getUsersWithPermissions(workspaceId)),
            ])

            const workspaceMdData = {
              workspace: wsRow,
              members,
              workflows: wfSummary,
              knowledgeBases: kbSummary,
              tables: tblSummary,
              files: fileSummary,
              oauthIntegrations: envSummary.oauthIntegrations,
              envVariables: envSummary.envVariables,
              tasks: taskSummary,
              customTools: toolsSummary,
              customBlocks: customBlocksSummary,
              mcpServers: mcpServersSummary,
              skills: skillsSummary,
              jobs: jobsSummary,
            }

            this.files.set('WORKSPACE.md', buildWorkspaceMd(workspaceMdData))
            this.files.set('WORKSPACE_CONTEXT.md', buildWorkspaceContextMd(workspaceMdData))

            await timed('recently_deleted', this.materializeRecentlyDeleted(workspaceId, userId))

            // Per-viewer gating happens HERE, not in the shared builder: files
            // owned by blocks hidden for this viewer are skipped at stamp time.
            const blockVisibility = overlayVisibility()
            for (const [path, content] of getStaticComponentFiles()) {
              if (isStaticFileHidden(path, blockVisibility)) continue
              this.files.set(path, content)
            }

            span.setAttributes({
              [TraceAttr.CopilotVfsMaterializeFileCount]: this.files.size,
              [TraceAttr.CopilotVfsMaterializePhaseMs]: JSON.stringify(phaseMs),
            })
          } catch (err) {
            markSpanForError(span, err)
            throw err
          } finally {
            // Record on success AND failure: a mid-phase failure (e.g. a DB
            // timeout) still belongs in copilot.vfs.materialize.duration, else
            // p50/p99 skew toward successes only. phaseMs holds whatever phases
            // completed before the failure.
            for (const [phase, ms] of Object.entries(phaseMs)) {
              recordVfsMaterialize(phase, ms)
            }
            recordVfsMaterialize('total', Date.now() - start)
            span.end()
          }
        }
      )

    // Durable Grafana signal for "how long does VFS materialize" — total plus
    // per-phase (bounded phase set). getOrMaterializeVFS runs per VFS tool call
    // with no cross-request cache, so this reveals whether materialize is the
    // bottleneck (observability only; not a fix). Recorded inside the span's
    // finally above so a failed materialize is captured too, not just successes.
    const totalMs = Date.now() - start

    logger.info('VFS materialized', {
      workspaceId,
      fileCount: this.files.size,
      durationMs: totalMs,
      phaseMs,
    })
  }

  private activeFiles(): Map<string, string> {
    const filtered = new Map<string, string>()
    for (const [key, value] of this.files) {
      if (!this.isRecentlyDeleted(key)) {
        filtered.set(key, value)
      }
    }
    return filtered
  }

  private filesForPath(path?: string): Map<string, string> {
    if (path?.startsWith('recently-deleted')) return this.files
    return this.activeFiles()
  }

  async grep(
    pattern: string,
    path?: string,
    options?: GrepOptions
  ): Promise<GrepMatch[] | string[] | ops.GrepCountEntry[]> {
    // grep is the only op that scans contents, so it is the only op that pays to
    // materialize lazy artifacts — and only those within its scope.
    await this.resolveLazyWithinScope(path)
    return ops.grep(this.filesForPath(path), pattern, path, options)
  }

  /**
   * Grep the *content* of a single workspace file (under `files/`), as opposed to
   * {@link grep} which searches the in-memory VFS map (workflow JSON, metadata,
   * plans, memories — workspace files appear there only as metadata).
   *
   * Content search applies to workspace files only and must target exactly one
   * file (`files/<name>` or `files/<name>/content`, plus the `recently-deleted/`
   * variants). A folder, the whole `files/` tree, or any path that does not
   * resolve to a single file leaf throws — grepping multiple workspace files at
   * once is intentionally unsupported.
   *
   * Per file type the file's text is resolved via {@link readFileContent} (the
   * same extraction `read` uses): text-like files are read as UTF-8, parseable
   * documents (pdf/docx/xlsx/pptx/…) are parsed to text, and the regex runs over
   * that text. Images and binary files have no searchable text and throw, as do
   * files too large for the inline read cap. Reading exactly one file (bounded by
   * the existing per-type read caps) keeps this from loading the workspace into
   * memory.
   */
  async grepFile(
    path: string,
    pattern: string,
    options?: GrepOptions
  ): Promise<GrepMatch[] | string[] | ops.GrepCountEntry[]> {
    const normalized = path.replace(/^\/+/, '')
    // Prefer the path verbatim when it is itself a file leaf (e.g. a file literally
    // named "content"); otherwise drop a trailing "/content" read suffix.
    const leaf = this.files.has(normalized) ? normalized : normalized.replace(/\/content$/, '')

    const isWorkspaceFilePath = /^(recently-deleted\/)?files(\/|$)/.test(leaf)
    if (!isWorkspaceFilePath || !this.files.has(leaf)) {
      const suggestions = this.suggestSimilar(leaf)
      const hint =
        suggestions.length > 0
          ? ` Did you mean: ${suggestions.join(', ')}?`
          : ' Use glob to find the exact file path, then grep that single file.'
      throw new ops.WorkspaceFileGrepError(
        `Grep over workspace file content must target a single workspace file (e.g. path: "files/report.csv"). "${path}" is not a single workspace file.${hint}`
      )
    }

    const contentPath = `${leaf}/content`
    const result = await this.readFileContent(contentPath)
    if (!result) {
      throw new ops.WorkspaceFileGrepError(`Workspace file content not found for "${path}".`)
    }

    return ops.grepReadResult(leaf, result, pattern, contentPath, options)
  }

  glob(pattern: string): string[] {
    // glob matches keys only, so it resolves no lazy content — it sees the full
    // path structure (eager keys + lazy placeholders) for free.
    const includeDeleted = pattern.startsWith('recently-deleted')
    return ops.glob(this.keyView(includeDeleted), pattern)
  }

  async read(path: string, offset?: number, limit?: number): Promise<ReadResult | null> {
    // Resolve the one lazy artifact being read into `files`; a no-op for eager
    // paths (already present) and unknown paths (no loader). Lazy keys are always
    // ASCII (built via encodeURIComponent), so no Unicode-normalized lookup is
    // needed here; ops.read still does its own NFC/NFD fallback over `files`.
    await this.resolveLazyPath(path)
    return ops.read(this.files, path, offset, limit)
  }

  suggestSimilar(missingPath: string, max?: number): string[] {
    return ops.suggestSimilar(this.keyView(true), missingPath, max)
  }

  private async resolveWorkspaceFileForDynamicRead(
    path: string,
    suffix: 'style' | 'compiled-check' | 'compiled' | 'render' | 'extract'
  ): Promise<WorkspaceFileRecord | null> {
    if (!this._betaEnabled && isWorkflowAliasBackingPath(path)) {
      return null
    }
    const canonicalMatch = path.match(new RegExp(`^files/(.+)/${suffix}$`))
    if (!canonicalMatch?.[1]) return null

    const files = await listWorkspaceFiles(this._workspaceId, { includeReservedSystemFiles: true })
    return findWorkspaceFileRecord(files, `files/${canonicalMatch[1]}`)
  }

  /**
   * Renders a renderable doc (pptx/docx/pdf) record to a contact-sheet image and
   * returns it as a model readable JPEG attachment. Shared by the `/render` and
   * `/compiled` reads so a binary doc is NEVER attached as a raw (non-PDF)
   * `document` block — the model only reads images and application/pdf. Compiles
   * the source first when needed (E2B doc sandbox, else isolated-vm); uses the
   * binary directly for already-binary uploads. Throws on compile/render failure
   * (the caller's try/catch reports it).
   */
  private async renderDocRecordResult(
    record: WorkspaceFileRecord,
    ext: string,
    buildMessage: (pageCount: number) => string
  ): Promise<FileReadResult> {
    if (typeof record.size === 'number' && record.size > MAX_DOC_READ_INPUT_BYTES) {
      return {
        content: JSON.stringify({ ok: false, error: 'File is too large to render' }),
        totalLines: 1,
      }
    }
    const buffer = await fetchWorkspaceFileBuffer(record)
    if (buffer.length > MAX_DOC_READ_INPUT_BYTES) {
      return {
        content: JSON.stringify({ ok: false, error: 'File is too large to render' }),
        totalLines: 1,
      }
    }
    // Already-binary uploads render directly; source files are compiled first
    // (E2B regime -> doc sandbox: Node pptx/docx, Python pdf; otherwise
    // isolated-vm pptxgenjs/docx-js/pdf-lib).
    let bin: Buffer
    if (isBinaryDocBuffer(buffer, ext)) {
      bin = buffer
    } else {
      const code = buffer.toString('utf-8')
      if (Buffer.byteLength(code, 'utf-8') > MAX_DOCUMENT_PREVIEW_CODE_BYTES) {
        return {
          content: JSON.stringify({ ok: false, error: 'File source exceeds maximum size' }),
          totalLines: 1,
        }
      }
      if (isE2BDocEnabled && (await getE2BDocFormat(record.name))) {
        bin = (
          await compileDoc({ source: code, fileName: record.name, workspaceId: this._workspaceId })
        ).buffer
      } else {
        const taskId = BINARY_DOC_TASKS[ext]
        if (!taskId) {
          return {
            content: JSON.stringify({ ok: false, error: 'Cannot render this file' }),
            totalLines: 1,
          }
        }
        bin = await runSandboxTask(taskId, { code, workspaceId: this._workspaceId })
      }
    }
    const { grid, pageCount } = await renderDocToGrid({
      binary: bin,
      ext,
      workspaceId: this._workspaceId,
    })
    return {
      content: buildMessage(pageCount),
      totalLines: 1,
      attachment: {
        // The rendered contact sheet is a JPEG, so it must be an image block.
        // Tagging it 'file' routes it to a provider document block, which only
        // accepts application/pdf — Anthropic rejects image/jpeg there with a
        // 400 that surfaces to the client as a "Stream error".
        type: 'image',
        name: `${record.name}.render.jpg`,
        source: { type: 'base64', media_type: 'image/jpeg', data: grid.toString('base64') },
      },
    }
  }

  /**
   * Attempt to read dynamic workspace file content from storage.
   * Handles explicit /content reads for images, PDFs, documents, and text files.
   * Also handles:
   *   `files/{path}/{name}/style`           — style extraction (.docx / .pptx / .pdf)
   *   `files/{path}/{name}/compiled-check`  — compile JS-source binary files or validate Mermaid diagrams
   *   `files/{path}/{name}/compiled`        — compile JS-source binary files and return the compiled artifact as an attachment
   * Files are resolved by their sanitized canonical path only.
   * Returns null if the path doesn't match a dynamic file path or the file isn't found.
   */
  async readFileContent(path: string): Promise<FileReadResult | null> {
    const compiledMatch = /^files\/.+\/compiled$/.test(path)
    if (compiledMatch) {
      let record: WorkspaceFileRecord | null = null
      try {
        record = await this.resolveWorkspaceFileForDynamicRead(path, 'compiled')
        if (!record) return null
        const ext = record.name.split('.').pop()?.toLowerCase() ?? ''
        const e2bFmt = isE2BDocEnabled ? await getE2BDocFormat(record.name) : null
        const taskId = BINARY_DOC_TASKS[ext]
        if (!e2bFmt && !taskId) return null

        // Only PDF can be attached as a model-readable `document` block —
        // Bedrock/Anthropic document blocks accept application/pdf ONLY. Attaching
        // raw pptx/docx/xlsx binary is rejected by the provider (400). So for
        // pptx/docx, render to page images (which the model CAN read) and return
        // those directly — /compiled can never emit an invalid document block for
        // these formats. xlsx isn't renderable; direct to /extract for its content.
        if (ext !== 'pdf') {
          if (isRenderableDocExt(ext)) {
            const compiledName = record.name
            return await this.renderDocRecordResult(
              record,
              ext,
              (pageCount) =>
                `${compiledName}: the raw ${ext.toUpperCase()} binary isn't model-readable, so it was rendered to ${pageCount} page image(s) for inspection.`
            )
          }
          const extractPath = `${canonicalWorkspaceFilePath({
            folderPath: record.folderPath,
            name: record.name,
          })}/extract`
          return {
            content: `${record.name} is a spreadsheet — read "${extractPath}" for its contents.`,
            totalLines: 1,
          }
        }

        const buffer = await fetchWorkspaceFileBuffer(record)
        const code = buffer.toString('utf-8')
        if (Buffer.byteLength(code, 'utf-8') > MAX_DOCUMENT_PREVIEW_CODE_BYTES) {
          return {
            content: JSON.stringify({ ok: false, error: 'File source exceeds maximum size' }),
            totalLines: 1,
          }
        }
        const compiled = e2bFmt
          ? (
              await compileDoc({
                source: code,
                fileName: record.name,
                workspaceId: this._workspaceId,
              })
            ).buffer
          : await runSandboxTask(taskId, { code, workspaceId: this._workspaceId })
        if (compiled.length > MAX_COMPILED_ATTACHMENT_BYTES) {
          return {
            content: `[Compiled artifact too large: ${record.name} (${compiled.length} bytes, limit ${MAX_COMPILED_ATTACHMENT_BYTES})]`,
            totalLines: 1,
          }
        }
        return {
          content: `Compiled file: ${record.name} (${compiled.length} bytes, application/pdf)`,
          totalLines: 1,
          attachment: {
            type: 'file',
            name: record.name,
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: compiled.toString('base64'),
            },
          },
        }
      } catch (err) {
        logger.warn('Compiled artifact read failed via VFS', {
          workspaceId: this._workspaceId,
          path,
          fileId: record?.id,
          error: toError(err).message,
        })
        if (err instanceof SandboxUserCodeError) {
          const json = JSON.stringify({
            ok: false,
            error: toError(err).message,
            errorName: err.name,
          })
          return { content: json, totalLines: 1 }
        }
        return null
      }
    }

    const renderMatch = /^files\/.+\/render$/.test(path)
    if (renderMatch) {
      let record: WorkspaceFileRecord | null = null
      try {
        record = await this.resolveWorkspaceFileForDynamicRead(path, 'render')
        if (!record) return null
        const ext = record.name.split('.').pop()?.toLowerCase() ?? ''
        if (!isRenderableDocExt(ext)) {
          return {
            content: JSON.stringify({
              ok: false,
              error: 'Render supports .pptx, .docx, and .pdf only',
            }),
            totalLines: 1,
          }
        }
        const renderName = record.name
        return await this.renderDocRecordResult(
          record,
          ext,
          (pageCount) =>
            `Rendered ${pageCount} page(s) of ${renderName} as a contact-sheet grid for visual QA. Inspect each page for text overflow/cutoff, overlapping elements, low contrast, misalignment, and leftover placeholder text; fix and re-render until clean.`
        )
      } catch (err) {
        logger.warn('Render read failed via VFS', {
          workspaceId: this._workspaceId,
          path,
          fileId: record?.id,
          error: toError(err).message,
        })
        // Return an explicit error (not null) once the file resolved — a null read
        // looks like a missing path and sends the agent hunting for the "correct"
        // render path instead of surfacing the real compile/render failure.
        return {
          content: JSON.stringify({ ok: false, error: toError(err).message }),
          totalLines: 1,
        }
      }
    }

    const extractMatch = /^files\/.+\/extract$/.test(path)
    if (extractMatch && isE2BDocEnabled) {
      let record: WorkspaceFileRecord | null = null
      try {
        record = await this.resolveWorkspaceFileForDynamicRead(path, 'extract')
        if (!record) return null
        const ext = record.name.split('.').pop()?.toLowerCase() ?? ''
        if (!isExtractableDocExt(ext)) {
          return {
            content: JSON.stringify({
              ok: false,
              error: 'Extraction supports .pdf, .pptx, .docx, and .xlsx only',
            }),
            totalLines: 1,
          }
        }
        // Bound the input before downloading + base64-staging it in-process.
        if (typeof record.size === 'number' && record.size > MAX_DOC_READ_INPUT_BYTES) {
          return {
            content: JSON.stringify({ ok: false, error: 'File is too large to extract' }),
            totalLines: 1,
          }
        }
        const buffer = await fetchWorkspaceFileBuffer(record)
        if (buffer.length > MAX_DOC_READ_INPUT_BYTES) {
          return {
            content: JSON.stringify({ ok: false, error: 'File is too large to extract' }),
            totalLines: 1,
          }
        }
        // Extraction reads the binary. A source-backed generated doc (text source,
        // no binary magic) should be read directly instead — point the agent there.
        if (!isBinaryDocBuffer(buffer, ext)) {
          return {
            content: JSON.stringify({
              ok: false,
              error: 'This is a source-backed generated file; read its content directly instead.',
            }),
            totalLines: 1,
          }
        }
        const { text, truncated } = await extractDocText({ binary: buffer, ext })
        const note = truncated
          ? '\n\n[... truncated — read the file directly for the full content]'
          : ''
        return {
          content: `${text || '[no extractable text found]'}${note}`,
          totalLines: 1,
        }
      } catch (err) {
        logger.warn('Extract read failed via VFS', {
          workspaceId: this._workspaceId,
          path,
          fileId: record?.id,
          error: toError(err).message,
        })
        return {
          content: JSON.stringify({ ok: false, error: toError(err).message }),
          totalLines: 1,
        }
      }
    }

    const compiledCheckMatch = /^files\/.+\/compiled-check$/.test(path)
    if (compiledCheckMatch) {
      let record: WorkspaceFileRecord | null = null
      try {
        record = await this.resolveWorkspaceFileForDynamicRead(path, 'compiled-check')
        if (!record) return null
        const ext = record.name.split('.').pop()?.toLowerCase() ?? ''
        const e2bFmt = isE2BDocEnabled ? await getE2BDocFormat(record.name) : null
        const taskId = BINARY_DOC_TASKS[ext]
        const isMermaidFile = ext === 'mmd' || ext === 'mermaid'
        if (!e2bFmt && !taskId && !isMermaidFile) return null
        const buffer = await fetchWorkspaceFileBuffer(record)
        const code = buffer.toString('utf-8')
        if (Buffer.byteLength(code, 'utf-8') > MAX_DOCUMENT_PREVIEW_CODE_BYTES) {
          return {
            content: JSON.stringify({ ok: false, error: 'File source exceeds maximum size' }),
            totalLines: 1,
          }
        }
        if (isMermaidFile) {
          const result = await validateMermaidSource(code)
          const json = JSON.stringify(result)
          return { content: json, totalLines: 1 }
        }
        let result: { ok: boolean; error?: string; errorName?: string }
        if (e2bFmt) {
          // Loads the artifact if present, else compiles once (and recalc-scans
          // xlsx). Only a script error is { ok: false }; infra failures rethrow to
          // the outer catch so an E2B/S3 outage isn't reported as a bad script.
          result = await runE2BCompiledCheck({
            source: code,
            fileName: record.name,
            workspaceId: this._workspaceId,
            ext,
          })
        } else {
          try {
            if (!taskId) return null
            await runSandboxTask(taskId, { code, workspaceId: this._workspaceId })
            result = { ok: true }
          } catch (err) {
            if (err instanceof SandboxUserCodeError) {
              result = { ok: false, error: toError(err).message, errorName: err.name }
            } else {
              throw err
            }
          }
        }
        const json = JSON.stringify(result)
        return { content: json, totalLines: 1 }
      } catch (err) {
        logger.warn('Compiled check failed via VFS', {
          workspaceId: this._workspaceId,
          path,
          fileId: record?.id,
          error: toError(err).message,
        })
        return null
      }
    }

    const styleMatch = /^files\/.+\/style$/.test(path)
    if (styleMatch) {
      let record: WorkspaceFileRecord | null = null
      try {
        record = await this.resolveWorkspaceFileForDynamicRead(path, 'style')
        if (!record) return null
        const rawExt = record.name.split('.').pop()?.toLowerCase()
        if (rawExt !== 'docx' && rawExt !== 'pptx' && rawExt !== 'pdf') return null
        const ext: 'docx' | 'pptx' | 'pdf' = rawExt
        const buffer = await fetchWorkspaceFileBuffer(record)
        const summary = await extractDocumentStyle(buffer, ext)
        if (!summary) return null
        const json = JSON.stringify(summary, null, 2)
        return { content: json, totalLines: json.split('\n').length }
      } catch (err) {
        logger.warn('Failed to extract document style via VFS', {
          workspaceId: this._workspaceId,
          path,
          fileId: record?.id,
          error: toError(err).message,
        })
        return null
      }
    }

    const deletedMatch = path.match(/^recently-deleted\/files\/(.+)\/content$/)
    const activeMatch = path.match(/^files\/(.+)\/content$/)
    const match = deletedMatch || activeMatch
    if (!match) return null
    const fileReference = path
      .replace(/^recently-deleted\//, '')
      .replace(/\/content$/, '')
      .replace(/^\/+/, '')

    if (!this._betaEnabled && isWorkflowAliasBackingPath(fileReference)) {
      return null
    }
    if (fileReference.endsWith('/meta.json') || path.endsWith('/meta.json')) return null

    const scope = deletedMatch ? 'archived' : 'active'

    try {
      const files = await listWorkspaceFiles(this._workspaceId, {
        scope,
        includeReservedSystemFiles: this._betaEnabled,
      })
      const record = findWorkspaceFileRecord(files, fileReference)
      if (!record) return null
      return readFileRecord(record)
    } catch (err) {
      logger.warn('Failed to list workspace files for readFileContent', {
        workspaceId: this._workspaceId,
        path,
        error: toError(err).message,
      })
      return null
    }
  }

  /**
   * Build a map from folderId to its full VFS path segment (e.g. "My Folder/Sub Folder").
   * Handles nested folders via parentId traversal.
   */
  private buildFolderPaths(
    folders: Array<{ folderId: string; folderName: string; parentId: string | null }>
  ): Map<string, string> {
    return buildVfsFolderPathMap(folders)
  }

  /**
   * Resolve the set of folder IDs that are effectively locked — locked directly
   * or via a locked ancestor folder. A workflow inside any of these folders is
   * itself immutable, so its meta.json must report `locked: true`. Mirrors the
   * folder-chain walk in `@sim/platform-authz/workflow` getFolderLockStatus, but resolves
   * the whole workspace in memory to avoid a per-workflow DB round trip.
   */
  private computeLockedFolderIds(
    folders: Array<{ folderId: string; parentId: string | null; locked: boolean }>
  ): Set<string> {
    const byId = new Map(folders.map((f) => [f.folderId, f]))
    const lockedFolderIds = new Set<string>()

    for (const folder of folders) {
      let current: string | null = folder.folderId
      const visited = new Set<string>()
      while (current && !visited.has(current)) {
        visited.add(current)
        const node = byId.get(current)
        if (!node) break
        if (node.locked) {
          lockedFolderIds.add(folder.folderId)
          break
        }
        current = node.parentId
      }
    }

    return lockedFolderIds
  }

  /**
   * Materialize all workflows using the shared listWorkflows function.
   * Workflows are nested under their folder paths in the VFS:
   *   workflows/{folder}/{name}/  (if in a folder)
   *   workflows/{name}/           (if at workspace root)
   * Returns a summary for WORKSPACE.md generation.
   */
  private async materializeWorkflows(workspaceId: string): Promise<WorkspaceMdData['workflows']> {
    const workflowArtifactsEnabled = this._betaEnabled
    const [workflowRows, folderRows] = await Promise.all([
      listWorkflows(workspaceId),
      listFolders(workspaceId),
    ])

    const folderPaths = this.buildFolderPaths(folderRows)
    const lockedFolderIds = this.computeLockedFolderIds(folderRows)

    // NOTE: materialization is a pure READ. Alias backing (changelog/plan
    // folders + files) is ensured at write time — workflow create/rename
    // (lib/workflows/utils) and alias writes (vfs/resource-writer,
    // tools/server/files/workspace-file) — never here. Ensuring per workflow
    // on every materialize meant N storage/DB writes per read tool call, and
    // concurrent materializations contending on the same rows.
    const workspaceFiles = workflowArtifactsEnabled
      ? await listWorkspaceFiles(workspaceId, { includeReservedSystemFiles: true })
      : []

    // Register all folders in the VFS so empty folders are discoverable.
    for (const { folderId } of folderRows) {
      const folderPath = folderPaths.get(folderId)
      if (folderPath) {
        this.files.set(`workflows/${folderPath}/.folder`, '')
      }
    }

    await Promise.all(
      workflowRows.map(async (wf) => {
        const folderPath = wf.folderId ? folderPaths.get(wf.folderId) : null
        const prefix = `${canonicalWorkflowVfsDir({ name: wf.name, folderPath })}/`
        const workflowPath = prefix.replace(/\/$/, '')

        const inheritedFolderLock = wf.folderId ? lockedFolderIds.has(wf.folderId) : false
        this.files.set(`${prefix}meta.json`, serializeWorkflowMeta(wf, { inheritedFolderLock }))

        if (workflowArtifactsEnabled) {
          const changelog = findWorkspaceFileRecord(
            workspaceFiles,
            workflowChangelogBackingPath(wf.id)
          )
          let changelogContent = ''
          if (changelog) {
            try {
              changelogContent = (await readFileRecord(changelog))?.content ?? ''
            } catch (err) {
              logger.warn('Failed to read workflow changelog alias backing file', {
                workspaceId,
                workflowId: wf.id,
                fileId: changelog.id,
                error: toError(err).message,
              })
            }
          }
          if (changelog) {
            this.files.set(`${prefix}${WORKFLOW_CHANGELOG_ALIAS_NAME}`, changelogContent)
          }
          this.files.set(`${prefix}${WORKFLOW_PLANS_ALIAS_DIR}/.folder`, '')

          const planFiles = workspaceFiles.filter((file) => {
            if (!file.folderPath) return false
            return (
              file.folderPath === `${WORKFLOW_PLANS_BACKING_FOLDER}/${wf.id}` ||
              file.folderPath.startsWith(`${WORKFLOW_PLANS_BACKING_FOLDER}/${wf.id}/`)
            )
          })
          for (const planFile of planFiles) {
            const relativeFolder = planFile.folderPath
              ?.replace(`${WORKFLOW_PLANS_BACKING_FOLDER}/${wf.id}`, '')
              .replace(/^\/+/, '')
            const aliasPlanPath = [
              prefix,
              `${WORKFLOW_PLANS_ALIAS_DIR}/`,
              relativeFolder ? `${encodeVfsPathSegments(relativeFolder.split('/'))}/` : '',
              normalizeVfsSegment(planFile.name),
            ].join('')
            try {
              this.files.set(aliasPlanPath, (await readFileRecord(planFile))?.content ?? '')
            } catch (err) {
              logger.warn('Failed to read workflow plan alias backing file', {
                workspaceId,
                workflowId: wf.id,
                fileId: planFile.id,
                error: toError(err).message,
              })
            }
          }
          this.files.set(
            `${prefix}${WORKFLOW_ALIAS_LINKS_NAME}`,
            JSON.stringify(
              {
                aliases: buildWorkflowAliasLinks({
                  workflowPath,
                  workflowId: wf.id,
                  changelog,
                  planFiles,
                }),
              },
              null,
              2
            )
          )
        }

        // Heavy per-workflow content is LAZY: a read/glob never loads the block
        // graph, runs lint, or queries executions/deployments. Only a read of the
        // specific artifact — or a grep whose scope touches it — resolves it.
        // state.json + lint.json share one memoized normalized-table load;
        // deployment.json + versions.json share one memoized deployment query.
        // This is the change that stops every read/glob from paying O(workflows)
        // graph-loads + lint + stringify (what made large-workspace reads ~40s).
        this.registerLazy(`${prefix}state.json`, async () => {
          const normalized = await this.loadNormalized(wf.id)
          // loadWorkflowFromNormalizedTables returns null for a zero-block
          // workflow; it still exists and must be readable, so emit an
          // empty-but-valid state.json rather than a 404.
          const sanitized = normalized
            ? sanitizeForCopilot({
                blocks: normalized.blocks,
                edges: normalized.edges,
                loops: normalized.loops,
                parallels: normalized.parallels,
              } as any)
            : sanitizeForCopilot({ blocks: {}, edges: [], loops: {}, parallels: {} } as any)
          return JSON.stringify(sanitized, null, 2)
        })

        this.registerLazy(`${prefix}lint.json`, async () => {
          const normalized = await this.loadNormalized(wf.id)
          // Derived from the raw normalized state (subBlock values, advancedMode,
          // canonicalModes, subflow edges). CPU-only by design: tier-2 reference
          // resolution runs at edit_workflow apply time, not here. A zero-block
          // workflow has no lint (reads as not-found, as before).
          if (!normalized) return null
          const graphLint = lintEditedWorkflowState(normalized as any)
          const fieldIssues = collectWorkflowFieldIssues(normalized.blocks as any)
          return JSON.stringify(
            {
              ...graphLint,
              fieldIssues,
              notes: [
                UNRESOLVABLE_AT_LINT_NOTE,
                'Credential/resource reference resolution is validated when editing the workflow, not in this snapshot.',
              ],
            },
            null,
            2
          )
        })

        // executions.json is advertised only when the workflow has run (cheap
        // signal: lastRunAt), matching the old "set iff execRows > 0" behavior
        // without the per-workflow query on every tool call.
        if (wf.lastRunAt) {
          this.registerLazy(`${prefix}executions.json`, async () => {
            const execRows = await db
              .select({
                id: workflowExecutionLogs.id,
                executionId: workflowExecutionLogs.executionId,
                status: workflowExecutionLogs.status,
                trigger: workflowExecutionLogs.trigger,
                startedAt: workflowExecutionLogs.startedAt,
                endedAt: workflowExecutionLogs.endedAt,
                totalDurationMs: workflowExecutionLogs.totalDurationMs,
              })
              .from(workflowExecutionLogs)
              .where(eq(workflowExecutionLogs.workflowId, wf.id))
              .orderBy(desc(workflowExecutionLogs.startedAt))
              .limit(5)
            return execRows.length > 0 ? serializeRecentExecutions(execRows) : null
          })
        }

        // deployment.json / versions.json are advertised when the workflow is
        // deployed (cheap signal: isDeployed). Both share one memoized query.
        if (wf.isDeployed) {
          this.registerLazy(`${prefix}deployment.json`, async () => {
            const deploymentData = await this.loadDeployments(wf)
            return deploymentData ? serializeDeployments(deploymentData) : null
          })
          this.registerLazy(`${prefix}versions.json`, async () => {
            const deploymentData = await this.loadDeployments(wf)
            return deploymentData?.versions && deploymentData.versions.length > 0
              ? serializeVersions(deploymentData.versions)
              : null
          })
        }
      })
    )

    return workflowRows.map((wf) => ({
      id: wf.id,
      name: wf.name,
      description: wf.description,
      isDeployed: wf.isDeployed,
      lastRunAt: wf.lastRunAt,
      folderPath: wf.folderId ? (folderPaths.get(wf.folderId) ?? null) : null,
    }))
  }

  /**
   * Materialize knowledge bases using the shared getKnowledgeBases function.
   * Returns a summary for WORKSPACE.md generation.
   */
  private async materializeKnowledgeBases(
    workspaceId: string,
    userId: string
  ): Promise<WorkspaceMdData['knowledgeBases']> {
    const kbs = await getKnowledgeBases(userId, workspaceId)

    await Promise.all(
      kbs.map(async (kb) => {
        const safeName = sanitizeName(kb.name)
        const prefix = `knowledgebases/${safeName}/`

        this.files.set(
          `${prefix}meta.json`,
          serializeKBMeta({
            id: kb.id,
            name: kb.name,
            description: kb.description,
            embeddingModel: kb.embeddingModel,
            embeddingDimension: kb.embeddingDimension,
            tokenCount: kb.tokenCount,
            createdAt: kb.createdAt,
            updatedAt: kb.updatedAt,
            documentCount: kb.docCount,
            connectorTypes: kb.connectorTypes,
          })
        )

        // documents.json / connectors.json are lazy, advertised only when the KB
        // summary says they exist (docCount / connectorTypes) — no per-KB query on
        // a read/glob, only when the artifact is read or grepped.
        if (kb.docCount > 0) {
          this.registerLazy(`${prefix}documents.json`, async () => {
            const docRows = await db
              .select({
                id: document.id,
                filename: document.filename,
                fileSize: document.fileSize,
                mimeType: document.mimeType,
                chunkCount: document.chunkCount,
                tokenCount: document.tokenCount,
                processingStatus: document.processingStatus,
                enabled: document.enabled,
                uploadedAt: document.uploadedAt,
              })
              .from(document)
              .where(
                and(
                  eq(document.knowledgeBaseId, kb.id),
                  eq(document.userExcluded, false),
                  isNull(document.archivedAt),
                  isNull(document.deletedAt)
                )
              )
            return docRows.length > 0 ? serializeDocuments(docRows) : null
          })
        }

        if (kb.connectorTypes.length > 0) {
          this.registerLazy(`${prefix}connectors.json`, async () => {
            const connectorRows = await db
              .select({
                id: knowledgeConnector.id,
                connectorType: knowledgeConnector.connectorType,
                status: knowledgeConnector.status,
                syncMode: knowledgeConnector.syncMode,
                syncIntervalMinutes: knowledgeConnector.syncIntervalMinutes,
                lastSyncAt: knowledgeConnector.lastSyncAt,
                lastSyncError: knowledgeConnector.lastSyncError,
                lastSyncDocCount: knowledgeConnector.lastSyncDocCount,
                nextSyncAt: knowledgeConnector.nextSyncAt,
                consecutiveFailures: knowledgeConnector.consecutiveFailures,
                createdAt: knowledgeConnector.createdAt,
              })
              .from(knowledgeConnector)
              .where(
                and(
                  eq(knowledgeConnector.knowledgeBaseId, kb.id),
                  isNull(knowledgeConnector.archivedAt),
                  isNull(knowledgeConnector.deletedAt)
                )
              )
            return connectorRows.length > 0 ? serializeConnectors(connectorRows) : null
          })
        }
      })
    )

    return kbs.map((kb) => ({
      id: kb.id,
      name: kb.name,
      description: kb.description,
      connectorTypes: kb.connectorTypes.length > 0 ? kb.connectorTypes : undefined,
    }))
  }

  /**
   * Materialize tables using the shared listTables function.
   * Returns a summary for WORKSPACE.md generation.
   */
  private async materializeTables(workspaceId: string): Promise<WorkspaceMdData['tables']> {
    try {
      const tables = await listTables(workspaceId)

      for (const table of tables) {
        const safeName = sanitizeName(table.name)
        this.files.set(
          `tables/${safeName}/meta.json`,
          serializeTableMeta({
            id: table.id,
            name: table.name,
            description: table.description,
            schema: table.schema,
            rowCount: table.rowCount,
            maxRows: table.maxRows,
            createdAt: table.createdAt,
            updatedAt: table.updatedAt,
          })
        )
      }

      return tables.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        rowCount: t.rowCount,
      }))
    } catch (err) {
      logger.warn('Failed to materialize tables', {
        workspaceId,
        error: toError(err).message,
      })
      return []
    }
  }

  /**
   * Materialize workspace files (already uses listWorkspaceFiles).
   * Returns a summary for WORKSPACE.md generation.
   */
  private async materializeFiles(workspaceId: string): Promise<WorkspaceMdData['files']> {
    try {
      const workflowArtifactsEnabled = this._betaEnabled
      const folders = await listWorkspaceFileFolders(workspaceId, {
        includeReservedSystemFolders: true,
      })
      const files = await listWorkspaceFiles(workspaceId, {
        folders,
        includeReservedSystemFiles: true,
      })
      for (const folder of folders) {
        if (
          !workflowArtifactsEnabled &&
          isWorkflowAliasBackingPath(`files/${encodeVfsPathSegments(folder.path.split('/'))}`)
        ) {
          continue
        }
        this.files.set(`files/${encodeVfsPathSegments(folder.path.split('/'))}/.folder`, '')
      }

      for (const file of files) {
        const filePath = canonicalWorkspaceFilePath({
          folderPath: file.folderPath,
          name: file.name,
        })
        if (!workflowArtifactsEnabled && isWorkflowAliasBackingPath(filePath)) {
          continue
        }
        this.files.set(
          filePath,
          serializeFileMeta({
            id: file.id,
            name: file.name,
            folderId: file.folderId,
            folderPath: file.folderPath,
            vfsPath: filePath,
            contentType: file.type,
            size: file.size,
            uploadedAt: file.uploadedAt,
          })
        )
      }

      if (workflowArtifactsEnabled) {
        this.files.set(`${WORKFLOW_PLANS_ALIAS_DIR}/.folder`, '')
        const workspacePlanFiles = files.filter((file) => {
          if (!file.folderPath) return false
          return (
            file.folderPath ===
              `${WORKFLOW_PLANS_BACKING_FOLDER}/${WORKSPACE_PLANS_BACKING_FOLDER}` ||
            file.folderPath.startsWith(
              `${WORKFLOW_PLANS_BACKING_FOLDER}/${WORKSPACE_PLANS_BACKING_FOLDER}/`
            )
          )
        })
        const workspacePlanLinks = []
        for (const planFile of workspacePlanFiles) {
          const relativeFolder = planFile.folderPath
            ?.replace(`${WORKFLOW_PLANS_BACKING_FOLDER}/${WORKSPACE_PLANS_BACKING_FOLDER}`, '')
            .replace(/^\/+/, '')
          const aliasRelativePath = [
            relativeFolder ? `${encodeVfsPathSegments(relativeFolder.split('/'))}/` : '',
            normalizeVfsSegment(planFile.name),
          ].join('')
          const aliasPlanPath = `${WORKFLOW_PLANS_ALIAS_DIR}/${aliasRelativePath}`
          const relativeSegments = aliasRelativePath.split('/').slice(0, -1)
          for (let index = 0; index < relativeSegments.length; index++) {
            this.files.set(
              `${WORKFLOW_PLANS_ALIAS_DIR}/${relativeSegments.slice(0, index + 1).join('/')}/.folder`,
              ''
            )
          }
          try {
            this.files.set(aliasPlanPath, (await readFileRecord(planFile))?.content ?? '')
            workspacePlanLinks.push({
              kind: 'plan_file',
              scope: 'workspace',
              aliasPath: aliasPlanPath,
              backingPath: workspacePlanBackingPath(aliasRelativePath),
              backingFileId: planFile.id,
            })
          } catch (err) {
            logger.warn('Failed to read workspace plan alias backing file', {
              workspaceId,
              fileId: planFile.id,
              error: toError(err).message,
            })
          }
        }
        this.files.set(
          `${WORKFLOW_PLANS_ALIAS_DIR}/${WORKFLOW_ALIAS_LINKS_NAME}`,
          JSON.stringify(
            {
              aliases: [
                {
                  kind: 'plans_dir',
                  scope: 'workspace',
                  aliasPath: WORKFLOW_PLANS_ALIAS_DIR,
                  backingPath: workspacePlansBackingFolderPath(),
                },
                ...workspacePlanLinks,
              ],
            },
            null,
            2
          )
        )
      }

      return files
        .filter(
          (f) =>
            !isWorkflowAliasBackingPath(
              canonicalWorkspaceFilePath({ folderPath: f.folderPath, name: f.name })
            )
        )
        .map((f) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          size: f.size,
          folderPath: f.folderPath ?? null,
        }))
    } catch (err) {
      logger.warn('Failed to materialize files', {
        workspaceId,
        error: toError(err).message,
      })
      return []
    }
  }

  /**
   * Query all deployment configurations for a single workflow.
   * Returns null if the workflow has no deployments of any kind.
   */
  private async getWorkflowDeployments(
    workflowId: string,
    workspaceId: string,
    isDeployed: boolean,
    deployedAt: Date | null
  ): Promise<DeploymentData | null> {
    const [chatRows, mcpRows, versionRows, allVersionRows] = await Promise.all([
      db
        .select({
          id: chatTable.id,
          identifier: chatTable.identifier,
          title: chatTable.title,
          description: chatTable.description,
          authType: chatTable.authType,
          customizations: chatTable.customizations,
          isActive: chatTable.isActive,
        })
        .from(chatTable)
        .where(and(eq(chatTable.workflowId, workflowId), isNull(chatTable.archivedAt))),
      db
        .select({
          serverId: workflowMcpTool.serverId,
          serverName: workflowMcpServer.name,
          toolId: workflowMcpTool.id,
          toolName: workflowMcpTool.toolName,
          toolDescription: workflowMcpTool.toolDescription,
        })
        .from(workflowMcpTool)
        .innerJoin(workflowMcpServer, eq(workflowMcpTool.serverId, workflowMcpServer.id))
        .where(
          and(
            eq(workflowMcpTool.workflowId, workflowId),
            isNull(workflowMcpTool.archivedAt),
            isNull(workflowMcpServer.deletedAt)
          )
        ),
      isDeployed
        ? db
            .select({
              version: workflowDeploymentVersion.version,
              state: workflowDeploymentVersion.state,
              createdAt: workflowDeploymentVersion.createdAt,
            })
            .from(workflowDeploymentVersion)
            .where(
              and(
                eq(workflowDeploymentVersion.workflowId, workflowId),
                eq(workflowDeploymentVersion.isActive, true)
              )
            )
            .limit(1)
        : Promise.resolve([]),
      db
        .select({
          id: workflowDeploymentVersion.id,
          version: workflowDeploymentVersion.version,
          name: workflowDeploymentVersion.name,
          description: workflowDeploymentVersion.description,
          isActive: workflowDeploymentVersion.isActive,
          createdAt: workflowDeploymentVersion.createdAt,
        })
        .from(workflowDeploymentVersion)
        .where(eq(workflowDeploymentVersion.workflowId, workflowId))
        .orderBy(desc(workflowDeploymentVersion.version)),
    ])

    const hasAnyDeployment = isDeployed || chatRows.length > 0 || mcpRows.length > 0
    if (!hasAnyDeployment && allVersionRows.length === 0) return null

    let needsRedeployment: boolean | undefined
    const deployedVersion = versionRows[0]
    if (isDeployed && deployedVersion?.state) {
      try {
        // Use the canonical deployment snapshot (includes variables) so this
        // matches check_deployment_status exactly. The reshaped normalized load
        // dropped variables, which made any workflow with deployment variables
        // permanently report needsRedeployment: true.
        const currentSnapshot = await loadWorkflowDeploymentSnapshot(workflowId)
        needsRedeployment = computeNeedsRedeployment(
          currentSnapshot,
          deployedVersion.state as WorkflowState
        )
      } catch (err) {
        logger.warn('Failed to compute needsRedeployment', {
          workflowId,
          error: toError(err).message,
        })
      }
    }

    return {
      workflowId,
      isDeployed,
      deployedAt,
      needsRedeployment,
      api: deployedVersion
        ? { version: deployedVersion.version, createdAt: deployedVersion.createdAt }
        : null,
      chat: chatRows[0] ?? null,
      mcp: mcpRows,
      versions: allVersionRows,
    }
  }

  /**
   * Materialize custom tools using the shared listCustomTools function.
   */
  private async materializeCustomTools(
    workspaceId: string,
    userId: string
  ): Promise<NonNullable<WorkspaceMdData['customTools']>> {
    try {
      const toolRows = await listCustomTools({ userId, workspaceId })

      for (const tool of toolRows) {
        const safeName = sanitizeName(tool.title)
        const serialized = serializeCustomTool({
          id: tool.id,
          title: tool.title,
          schema: tool.schema,
          code: tool.code,
        })
        this.files.set(`custom-tools/${safeName}.json`, serialized)
        this.files.set(`agent/custom-tools/${safeName}.json`, serialized)
      }

      return toolRows.map((t) => ({ id: t.id, name: t.title }))
    } catch (err) {
      logger.warn('Failed to materialize custom tools', {
        workspaceId,
        error: toError(err).message,
      })
      return []
    }
  }

  /**
   * Materialize the org's published custom (deploy-as-block) blocks as VFS
   * component files — the same `components/blocks/<type>.json` path + serializer
   * first-party blocks use — so the agent can grep/read them. Returns the summary
   * for `WORKSPACE_CONTEXT.md`. Per-request/per-org, so it bypasses the frozen
   * static component cache. Only enabled blocks are exposed.
   */
  private async materializeCustomBlocks(
    workspaceId: string
  ): Promise<NonNullable<WorkspaceMdData['customBlocks']>> {
    try {
      const blocks = await listCustomBlocksWithInputsForWorkspace(workspaceId)
      // Every current definition (incl. disabled) — the authoritative set used to
      // drop deleted-definition instances from workflow state (see loadNormalized).
      this._customBlockTypes = new Set(blocks.map((cb) => cb.type))
      const summary: NonNullable<WorkspaceMdData['customBlocks']> = []

      for (const cb of blocks) {
        if (!cb.enabled) continue
        const config = buildCustomBlockConfig(
          {
            type: cb.type,
            name: cb.name,
            description: cb.description,
            workflowId: cb.workflowId,
            exposedOutputs: cb.exposedOutputs,
          },
          cb.inputFields,
          { icon: PLACEHOLDER_BLOCK_ICON }
        )
        this.files.set(`components/blocks/${config.type}.json`, serializeBlockSchema(config))
        summary.push({
          type: cb.type,
          name: cb.name,
          ...(cb.description ? { description: cb.description } : {}),
        })
      }

      return summary
    } catch (err) {
      logger.warn('Failed to materialize custom blocks', {
        workspaceId,
        error: toError(err).message,
      })
      return []
    }
  }

  /**
   * Materialize external MCP server connections using the mcpServers table.
   */
  private async materializeMcpServers(
    workspaceId: string
  ): Promise<NonNullable<WorkspaceMdData['mcpServers']>> {
    try {
      const servers = await db
        .select()
        .from(mcpServersTable)
        .where(and(eq(mcpServersTable.workspaceId, workspaceId), isNull(mcpServersTable.deletedAt)))

      for (const server of servers) {
        const safeName = sanitizeName(server.name)
        this.files.set(
          `agent/mcp-servers/${safeName}.json`,
          serializeMcpServer({
            id: server.id,
            name: server.name,
            url: server.url,
            transport: server.transport,
            enabled: server.enabled,
            connectionStatus: server.connectionStatus,
          })
        )
      }

      return servers.map((s) => ({ id: s.id, name: s.name, url: s.url, enabled: s.enabled }))
    } catch (err) {
      logger.warn('Failed to materialize MCP servers', {
        workspaceId,
        error: toError(err).message,
      })
      return []
    }
  }

  /**
   * Materialize the workspace skills the acting user can access. Skill bodies
   * are exposed as readable VFS files, so per-skill access filtering applies.
   */
  private async materializeSkills(
    workspaceId: string,
    userId: string
  ): Promise<NonNullable<WorkspaceMdData['skills']>> {
    try {
      const skillRows = await listSkillsForUser({ workspaceId, userId, includeBuiltins: false })

      for (const s of skillRows) {
        const safeName = sanitizeName(s.name)
        this.files.set(
          `agent/skills/${safeName}.json`,
          serializeSkill({
            id: s.id,
            name: s.name,
            description: s.description,
            content: s.content,
            createdAt: s.createdAt,
          })
        )
      }

      return skillRows.map((s) => ({ id: s.id, name: s.name, description: s.description }))
    } catch (err) {
      logger.warn('Failed to materialize skills', {
        workspaceId,
        error: toError(err).message,
      })
      return []
    }
  }

  /**
   * Materialize mothership task chats as browsable conversation files.
   * Returns a summary for WORKSPACE.md generation.
   */
  private async materializeTasks(
    workspaceId: string,
    userId: string
  ): Promise<WorkspaceMdData['tasks']> {
    try {
      const taskRows = await db
        .select({
          id: copilotChats.id,
          title: copilotChats.title,
          messageCount: sql<number>`COALESCE((
            SELECT COUNT(*) FROM copilot_messages cm
            WHERE cm.chat_id = ${copilotChats.id} AND cm.deleted_at IS NULL
          ), 0)`,
          messages: sql<unknown[]>`COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'role', cm.content->>'role',
                'content', cm.content->'content',
                'contentBlocks', COALESCE((
                  SELECT jsonb_agg(jsonb_build_object('type', 'text', 'content', b.value->'content') ORDER BY b.ord)
                  FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(cm.content->'contentBlocks') = 'array'
                         THEN cm.content->'contentBlocks'
                         ELSE '[]'::jsonb
                    END
                  ) WITH ORDINALITY AS b(value, ord)
                  WHERE b.value->>'type' = 'text'
                ), '[]'::jsonb)
              )
              ORDER BY cm.seq ASC NULLS LAST, cm.created_at ASC, cm.id ASC
            )
            FROM copilot_messages cm
            WHERE cm.chat_id = ${copilotChats.id}
              AND cm.deleted_at IS NULL
              AND cm.content->>'role' IN ('user', 'assistant')
          ), '[]'::jsonb)`,
          createdAt: copilotChats.createdAt,
          updatedAt: copilotChats.updatedAt,
        })
        .from(copilotChats)
        .where(
          and(
            eq(copilotChats.workspaceId, workspaceId),
            eq(copilotChats.userId, userId),
            eq(copilotChats.type, 'mothership')
          )
        )
        .orderBy(desc(copilotChats.updatedAt))
        .limit(5)

      for (const task of taskRows) {
        const title = task.title || 'Untitled task'
        const safeName = sanitizeName(title)
        const prefix = `tasks/${safeName}/`
        const messages = Array.isArray(task.messages) ? task.messages : []
        const messageCount = Number(task.messageCount) || 0

        this.files.set(
          `${prefix}session.md`,
          serializeTaskSession({
            id: task.id,
            title,
            messageCount,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          })
        )

        if (messages.length > 0) {
          this.files.set(`${prefix}chat.json`, serializeTaskChat(messages))
        }
      }

      return taskRows.map((t) => ({
        id: t.id,
        title: t.title || 'Untitled task',
        updatedAt: t.updatedAt,
      }))
    } catch (err) {
      logger.warn('Failed to materialize tasks', {
        workspaceId,
        error: toError(err).message,
      })
      return []
    }
  }

  /**
   * Materialize scheduled jobs using the workflowSchedule table.
   * Returns a summary for WORKSPACE.md generation.
   */
  private async materializeJobs(
    workspaceId: string
  ): Promise<NonNullable<WorkspaceMdData['jobs']>> {
    try {
      const jobRows = await db
        .select({
          id: workflowSchedule.id,
          jobTitle: workflowSchedule.jobTitle,
          prompt: workflowSchedule.prompt,
          cronExpression: workflowSchedule.cronExpression,
          timezone: workflowSchedule.timezone,
          status: workflowSchedule.status,
          lifecycle: workflowSchedule.lifecycle,
          successCondition: workflowSchedule.successCondition,
          maxRuns: workflowSchedule.maxRuns,
          runCount: workflowSchedule.runCount,
          nextRunAt: workflowSchedule.nextRunAt,
          lastRanAt: workflowSchedule.lastRanAt,
          sourceTaskName: workflowSchedule.sourceTaskName,
          sourceChatId: workflowSchedule.sourceChatId,
          jobHistory: workflowSchedule.jobHistory,
          createdAt: workflowSchedule.createdAt,
        })
        .from(workflowSchedule)
        .where(
          and(
            eq(workflowSchedule.sourceWorkspaceId, workspaceId),
            eq(workflowSchedule.sourceType, 'job'),
            isNull(workflowSchedule.archivedAt),
            ne(workflowSchedule.status, 'completed')
          )
        )

      for (const job of jobRows) {
        const safeName = sanitizeName(job.jobTitle || job.id)
        this.files.set(
          `jobs/${safeName}/meta.json`,
          serializeJobMeta({
            id: job.id,
            title: job.jobTitle,
            prompt: job.prompt || '',
            cronExpression: job.cronExpression,
            timezone: job.timezone,
            status: job.status,
            lifecycle: job.lifecycle,
            successCondition: job.successCondition,
            maxRuns: job.maxRuns,
            runCount: job.runCount,
            nextRunAt: job.nextRunAt,
            lastRanAt: job.lastRanAt,
            sourceTaskName: job.sourceTaskName,
            sourceChatId: job.sourceChatId,
            createdAt: job.createdAt,
          })
        )

        const history = job.jobHistory as Array<{ timestamp: string; summary: string }> | null
        if (history && history.length > 0) {
          this.files.set(`jobs/${safeName}/history.json`, JSON.stringify(history, null, 2))
        }

        // executions.json is lazy, advertised only when the job has run (cheap
        // signal: lastRanAt) — no per-job query on a read/glob.
        if (job.lastRanAt) {
          this.registerLazy(`jobs/${safeName}/executions.json`, async () => {
            const execRows = await db
              .select({
                id: jobExecutionLogs.id,
                executionId: jobExecutionLogs.executionId,
                status: jobExecutionLogs.status,
                trigger: jobExecutionLogs.trigger,
                startedAt: jobExecutionLogs.startedAt,
                endedAt: jobExecutionLogs.endedAt,
                totalDurationMs: jobExecutionLogs.totalDurationMs,
              })
              .from(jobExecutionLogs)
              .where(eq(jobExecutionLogs.scheduleId, job.id))
              .orderBy(desc(jobExecutionLogs.startedAt))
              .limit(5)
            return execRows.length > 0 ? serializeRecentExecutions(execRows) : null
          })
        }
      }

      return jobRows
        .filter((j) => j.status !== 'completed')
        .map((j) => ({
          id: j.id,
          title: j.jobTitle,
          prompt: j.prompt || '',
          cronExpression: j.cronExpression,
          status: j.status,
          lifecycle: j.lifecycle,
          sourceTaskName: j.sourceTaskName,
        }))
    } catch (err) {
      logger.warn('Failed to materialize jobs', {
        workspaceId,
        error: toError(err).message,
      })
      return []
    }
  }

  private async materializeRecentlyDeleted(workspaceId: string, userId: string): Promise<void> {
    try {
      const [
        archivedWorkflows,
        archivedFolders,
        archivedTables,
        archivedFiles,
        archivedFileFolders,
        archivedKBs,
      ] = await Promise.all([
        listWorkflows(workspaceId, { scope: 'archived' }),
        db
          .select({
            id: workflowFolder.id,
            name: workflowFolder.name,
            archivedAt: workflowFolder.archivedAt,
          })
          .from(workflowFolder)
          .where(
            and(eq(workflowFolder.workspaceId, workspaceId), isNotNull(workflowFolder.archivedAt))
          ),
        listTables(workspaceId, { scope: 'archived' }),
        listWorkspaceFiles(workspaceId, { scope: 'archived' }),
        listWorkspaceFileFolders(workspaceId, { scope: 'archived' }),
        getKnowledgeBases(userId, workspaceId, 'archived'),
      ])

      for (const wf of archivedWorkflows) {
        const safeName = sanitizeName(wf.name)
        this.files.set(
          `recently-deleted/workflows/${safeName}/meta.json`,
          serializeWorkflowMeta(wf)
        )
      }

      for (const folder of archivedFolders) {
        const safeName = sanitizeName(folder.name)
        this.files.set(
          `recently-deleted/folders/${safeName}/meta.json`,
          JSON.stringify(
            { id: folder.id, name: folder.name, archivedAt: folder.archivedAt },
            null,
            2
          )
        )
      }

      for (const table of archivedTables) {
        const safeName = sanitizeName(table.name)
        this.files.set(
          `recently-deleted/tables/${safeName}/meta.json`,
          serializeTableMeta({
            id: table.id,
            name: table.name,
            description: table.description,
            schema: table.schema,
            rowCount: table.rowCount,
            maxRows: table.maxRows,
            createdAt: table.createdAt,
            updatedAt: table.updatedAt,
          })
        )
      }

      for (const folder of archivedFileFolders) {
        const safePath = folder.path
          .split('/')
          .map((segment) => sanitizeName(segment))
          .join('/')
        this.files.set(
          `recently-deleted/file-folders/${safePath}/meta.json`,
          JSON.stringify(
            {
              id: folder.id,
              name: folder.name,
              parentId: folder.parentId,
              path: folder.path,
              deletedAt: folder.deletedAt,
              type: 'file_folder',
            },
            null,
            2
          )
        )
      }

      for (const file of archivedFiles) {
        const filePath = canonicalWorkspaceFilePath({
          folderPath: file.folderPath,
          name: file.name,
          prefix: 'recently-deleted/files',
        })
        this.files.set(
          filePath,
          serializeFileMeta({
            id: file.id,
            name: file.name,
            folderId: file.folderId,
            folderPath: file.folderPath,
            vfsPath: filePath,
            contentType: file.type,
            size: file.size,
            uploadedAt: file.uploadedAt,
          })
        )
      }

      for (const kb of archivedKBs) {
        const safeName = sanitizeName(kb.name)
        this.files.set(
          `recently-deleted/knowledgebases/${safeName}/meta.json`,
          serializeKBMeta({
            id: kb.id,
            name: kb.name,
            description: kb.description,
            embeddingModel: kb.embeddingModel,
            embeddingDimension: kb.embeddingDimension,
            tokenCount: kb.tokenCount,
            createdAt: kb.createdAt,
            updatedAt: kb.updatedAt,
            documentCount: kb.docCount,
            connectorTypes: kb.connectorTypes,
          })
        )
      }
    } catch (err) {
      logger.warn('Failed to materialize recently deleted resources', {
        workspaceId,
        error: toError(err).message,
      })
    }
  }

  /**
   * Materialize environment data using shared service functions:
   * - getAccessibleEnvCredentials for workspace-scoped credentials
   * - listApiKeys for workspace API keys
   * - getPersonalAndWorkspaceEnv for env variable names
   *
   * Returns a credential summary for WORKSPACE.md generation.
   */
  private async materializeEnvironment(
    workspaceId: string,
    userId: string
  ): Promise<{
    oauthIntegrations: WorkspaceMdData['oauthIntegrations']
    envVariables: WorkspaceMdData['envVariables']
  }> {
    try {
      const isWorkspaceAdmin = await hasWorkspaceAdminAccess(userId, workspaceId)
      const [envCredentials, oauthCredentials, apiKeyRows, envData] = await Promise.all([
        getAccessibleEnvCredentials(workspaceId, userId, { isWorkspaceAdmin }),
        getAccessibleOAuthCredentials(workspaceId, userId, { isWorkspaceAdmin }),
        listApiKeys(workspaceId),
        getPersonalAndWorkspaceEnv(userId, workspaceId),
      ])

      this.files.set(
        'environment/credentials.json',
        serializeCredentials([
          ...envCredentials.map((c) => ({
            providerId: c.envKey,
            scope: c.type === 'env_workspace' ? 'workspace' : 'personal',
            createdAt: c.updatedAt,
          })),
          ...oauthCredentials.map((c) => ({
            id: c.id,
            providerId: c.providerId,
            displayName: c.displayName,
            role: c.role,
            scope: null,
            createdAt: c.updatedAt,
          })),
        ])
      )

      this.files.set('environment/api-keys.json', serializeApiKeys(apiKeyRows))

      const personalVarNames = Object.keys(envData.personalEncrypted)
      const workspaceVarNames = Object.keys(envData.workspaceEncrypted)
      this.files.set(
        'environment/variables.json',
        serializeEnvironmentVariables(personalVarNames, workspaceVarNames)
      )

      const envKeys = [...new Set(envCredentials.map((c) => c.envKey))]
      return {
        oauthIntegrations: oauthCredentials.map((c) => ({
          id: c.id,
          providerId: c.providerId,
          displayName: c.displayName,
          role: c.role,
        })),
        envVariables: envKeys,
      }
    } catch (err) {
      logger.warn('Failed to materialize environment data', {
        workspaceId,
        error: toError(err).message,
      })
      return { oauthIntegrations: [], envVariables: [] }
    }
  }
}

/**
 * Create a fresh VFS for a workspace.
 * Dynamic data (workflows, KBs, env) is always fetched fresh.
 * Static component files (blocks, integrations) are cached per-process.
 */
export async function getOrMaterializeVFS(
  workspaceId: string,
  userId: string
): Promise<WorkspaceVFS> {
  await assertActiveWorkspaceAccess(workspaceId, userId)
  const vfs = new WorkspaceVFS()
  await vfs.materialize(workspaceId, userId)
  return vfs
}

export type { FileReadResult } from '@/lib/copilot/vfs/file-reader'

/**
 * Sanitize a name for use as a VFS path segment.
 * Delegates to {@link normalizeVfsSegment} so workspace file paths match DB lookups.
 */
export function sanitizeName(name: string): string {
  return normalizeVfsSegment(name)
}
