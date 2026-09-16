import { trace } from '@opentelemetry/api'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  chat as chatTable,
  customTools as customToolsTable,
  folder as folderTable,
  mcpServers as mcpServersTable,
  skill as skillTable,
  workflowDeploymentVersion,
  workflowExecutionLogs,
  workflowMcpServer,
  workflowMcpTool,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, desc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { listApiKeys } from '@/lib/api-key/service'
import { getAccountBillingSnapshot } from '@/lib/billing/core/account-billing-snapshot'
import { hasWorkspaceSandboxAccess } from '@/lib/billing/core/subscription'
import {
  buildWorkspaceContextMd,
  buildWorkspaceMd,
  type WorkspaceMdData,
} from '@/lib/copilot/chat/workspace-context'
import { computeWorkspaceEntitlements } from '@/lib/copilot/entitlements'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import {
  type DeniedBlockOperations,
  projectIntegrationToolsForViewer,
  resolveDeniedBlockOperations,
} from '@/lib/copilot/integration-tool-projection'
import {
  type ExposedIntegrationTool,
  getExposedIntegrationTools,
} from '@/lib/copilot/integration-tools'
import { recordVfsMaterialize } from '@/lib/copilot/request/metrics'
import { markSpanForError } from '@/lib/copilot/request/otel'
import {
  filterSecretNamesByMountPolicy,
  type SecretMountPolicy,
} from '@/lib/copilot/secret-mount-policy'
import { RESTRICTED_SIM_SANDBOX_INPUTS } from '@/lib/copilot/sim-sandbox-projection'
import { compileDoc, getE2BDocFormat } from '@/lib/copilot/tools/server/files/doc-compile'
import { extractDocText, isExtractableDocExt } from '@/lib/copilot/tools/server/files/doc-extract'
import { runE2BCompiledCheck } from '@/lib/copilot/tools/server/files/doc-recalc'
import { isRenderableDocExt, renderDocToGrid } from '@/lib/copilot/tools/server/files/doc-render'
import { extractDocumentStyle } from '@/lib/copilot/vfs/document-style'
import {
  type FileReadResult,
  isReadableFileType,
  MAX_IMAGE_SOURCE_BYTES,
  MAX_TEXT_READ_BYTES,
  readFileRecord,
} from '@/lib/copilot/vfs/file-reader'
import { normalizeVfsSegment } from '@/lib/copilot/vfs/normalize-segment'
import type { GrepMatch, GrepOptions, ReadResult } from '@/lib/copilot/vfs/operations'
import * as ops from '@/lib/copilot/vfs/operations'
import {
  buildVfsFolderPathMap,
  canonicalWorkflowVfsDir,
  canonicalWorkspaceFilePath,
  decodeVfsSegmentSafe,
  encodeVfsPathSegments,
} from '@/lib/copilot/vfs/path-utils'
import { readPlaceholder } from '@/lib/copilot/vfs/read-placeholders'
import type { DeploymentData, VfsServiceAccountAuth } from '@/lib/copilot/vfs/serializers'
import {
  buildOrganizationReadme,
  describeServiceAccountForOAuthProvider,
  serializeAccessControl,
  serializeAccountBilling,
  serializeAccountMembers,
  serializeAccountWorkspace,
  serializeAccountWorkspaces,
  serializeApiKeyIntegrations,
  serializeApiKeys,
  serializeBlockSchema,
  serializeBuiltinTriggerSchema,
  serializeConnectedAccounts,
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
  serializeKBMeta,
  serializeMcpServer,
  serializeOrganization,
  serializeOrganizationCustomBlocks,
  serializeOrganizationWorkspaces,
  serializeOrgCustomBlockDetail,
  serializePermissionGroupRoster,
  serializeRecentExecutions,
  serializeSandbox,
  serializeSandboxCatalog,
  serializeSkill,
  serializeTableMeta,
  serializeTableViews,
  serializeTriggerOverview,
  serializeTriggerSchema,
  serializeVersions,
  serializeWorkflowMeta,
  serializeWorkspaceForks,
} from '@/lib/copilot/vfs/serializers'
import type { BlockVisibilityState } from '@/lib/core/config/block-visibility'
import {
  getAllowedIntegrationsFromEnv,
  isDocSandboxEnabled,
  isHosted,
} from '@/lib/core/config/env-flags'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import type { CredentialGroupRecord } from '@/lib/credential-groups/types'
import {
  getAccessibleEnvCredentials,
  getAccessibleOAuthCredentials,
  getEnrolledManagedOAuthCredentials,
} from '@/lib/credentials/environment'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { BINARY_DOC_TASKS, MAX_DOCUMENT_PREVIEW_CODE_BYTES } from '@/lib/execution/constants'
import {
  currentSandboxStrategy,
  listWorkspaceSandboxes,
} from '@/lib/execution/remote-sandbox/workspace-sandboxes'
import { runSandboxTask, SandboxUserCodeError } from '@/lib/execution/sandbox/run-task'
import { listFoldersForWorkspace } from '@/lib/folders/queries'
import {
  isIntegrationDeploymentAvailableForVisibility,
  isOAuthServiceDeploymentAvailable,
} from '@/lib/integrations/availability.server'
import { createIntegrationCredentialVisibility } from '@/lib/integrations/credential-visibility.server'
import { listKnowledgeConnectors } from '@/lib/knowledge/application/connectors'
import { listKnowledgeDocuments } from '@/lib/knowledge/application/documents'
import {
  listKnowledgeBaseCatalog,
  listKnowledgeBases,
} from '@/lib/knowledge/application/knowledge-bases'
import { validateMermaidSource } from '@/lib/mermaid/validate'
import { isBlockTypeAccessControlExempt } from '@/lib/permission-groups/block-access'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'
import { getActivePermissionGroupRestrictions } from '@/lib/permission-groups/features'
import {
  intersectIntegrationAllowlists,
  toAccessControlAllowlist,
} from '@/lib/permission-groups/integration-allowlist'
import type { IsToolAllowed } from '@/lib/permission-groups/operation-access'
import {
  listOrganizationWorkspaceRefs,
  listPermissionGroupRoster,
} from '@/lib/permission-groups/queries'
import { listTables } from '@/lib/table/service'
import {
  listTableViewsByWorkspace,
  normalizeStoredViewConfig,
  pruneViewConfig,
  viewConfigIdsToNames,
} from '@/lib/table/views/service'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { findWorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import type {
  WorkspaceFileSecretProvenanceEnvelope,
  WorkspaceFileSecretProvenanceIdentity,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { isImageFileType, resolveEffectiveMimeType } from '@/lib/uploads/utils/file-utils'
import {
  type CustomBlockWithInputs,
  listCustomBlocksWithInputsForWorkspace,
} from '@/lib/workflows/custom-blocks/operations'
import { getCustomToolById } from '@/lib/workflows/custom-tools/operations'
import { checkNeedsRedeployment } from '@/lib/workflows/deployment-status'
import { collectWorkflowFieldIssues, lintEditedWorkflowState } from '@/lib/workflows/editing/lint'
import { UNRESOLVABLE_AT_LINT_NOTE } from '@/lib/workflows/editing/validation'
import {
  loadDeployedWorkflowState,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'
import { getSkillById } from '@/lib/workflows/skills/operations'
import { listFolders, listWorkflows } from '@/lib/workflows/utils'
import { listAllWorkspaceFiles } from '@/lib/workspace-files/application/list-workspace-files'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
import { listWorkspaceFileFoldersOperation } from '@/lib/workspace-files/application/workspace-file-folders'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'
import {
  collectSimPageDiagnostics,
  isSimPageSource,
  SIM_PAGE_CONTENT_TYPE,
} from '@/lib/workspace-files/page-compile'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import {
  assertActiveWorkspaceAccess,
  getUsersWithPermissions,
  getWorkspaceWithOwner,
  hasWorkspaceAdminAccess,
} from '@/lib/workspaces/permissions/utils'
import { listAccessibleWorkspaceRowsForUser } from '@/lib/workspaces/utils'
import { buildCustomBlockConfig, isCustomBlockType } from '@/blocks/custom/build-config'
import { BLOCK_REGISTRY } from '@/blocks/registry-maps'
import type { BlockConfig, BlockIcon } from '@/blocks/types'
import { isHiddenUnder, overlayVisibility } from '@/blocks/visibility/context'
import { CONNECTOR_REGISTRY } from '@/connectors/registry.server'
import { resolveVerifiedUserAccessControlContext } from '@/ee/access-control/utils/permission-check'
import { isForkingAvailableForWorkspace } from '@/ee/workspace-forking/lib/lineage/authz'
import { getForkChildren, getForkParent } from '@/ee/workspace-forking/lib/lineage/lineage'
import { loadForkBlockMap } from '@/ee/workspace-forking/lib/mapping/block-map-store'
import { getEdgeMappingRows } from '@/ee/workspace-forking/lib/mapping/mapping-store'
import type { ExecutableToolConfig } from '@/tools/types'
import { TRIGGER_REGISTRY } from '@/triggers/registry'

const logger = createLogger('WorkspaceVFS')

/** Placeholder icon for custom-block configs — `serializeBlockSchema` never reads it. */
// double-cast-allowed: a no-op stands in for the unused SVG-typed BlockIcon slot
const PLACEHOLDER_BLOCK_ICON = (() => null) as unknown as BlockIcon
const MAX_COMPILED_ATTACHMENT_BYTES = 5 * 1024 * 1024
const KNOWLEDGE_DOCUMENT_PAGE_SIZE = 100
const MAX_VFS_KNOWLEDGE_DOCUMENTS = 10_000

function bindWorkspaceFileResult<T>(
  record: WorkspaceFileRecord,
  value: T,
  view: 'complete' | 'derived' = 'derived',
  contributingFiles: readonly WorkspaceFileSecretProvenanceIdentity[] = []
): WorkspaceFileSecretProvenanceEnvelope<T> {
  return {
    value,
    view,
    file: {
      fileId: record.id,
      key: record.key,
      context: record.storageContext ?? 'workspace',
    },
    ...(contributingFiles.length > 0 ? { contributingFiles } : {}),
  }
}

function renderErrorResult(error: string): FileReadResult {
  return {
    content: JSON.stringify({ ok: false, error }),
    totalLines: 1,
    error,
  }
}

function recordContributingFile(
  files: Map<string, WorkspaceFileSecretProvenanceIdentity>,
  identity: WorkspaceFileSecretProvenanceIdentity
): void {
  files.set(`${identity.context}:${identity.fileId}:${identity.key}`, identity)
}

/**
 * Static component files, computed once and shared across all VFS instances.
 * Built from the UNGATED registry universe (preview blocks included) so this
 * process-global cache can never be poisoned by one viewer's gated projection;
 * per-viewer gating is applied when the map is stamped into each fresh VFS
 * (see {@link isStaticFileHidden}).
 */
let staticComponentFiles: Map<string, string> | null = null
let staticFunctionSchemaWithRestrictedSimSandboxes: string | null = null

/**
 * Owning block for each `components/integrations/**` file, recorded at build
 * time. Block/trigger schema files carry their owning type as the path
 * basename, but integration paths use the version-stripped service name — so
 * their owners need this lookup for the stamp-time visibility filter.
 */
const integrationPathOwners = new Map<string, Array<Pick<BlockConfig, 'type' | 'preview'>>>()

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
function isBlockOwnerHidden(
  owner: Pick<BlockConfig, 'type' | 'preview'>,
  vis: BlockVisibilityState | null,
  gate: StaticFileGate
): boolean {
  const config = BLOCK_REGISTRY[owner.type]
  if (config?.hideFromToolbar) return true
  if (!isIntegrationDeploymentAvailableForVisibility(owner.type, vis)) return true
  if (
    gate.allowedIntegrationTypes !== null &&
    !isBlockTypeAccessControlExempt(owner.type) &&
    !gate.allowedIntegrationTypes.has(owner.type.toLowerCase())
  ) {
    return true
  }
  /* Every operation denied leaves nothing the viewer could configure, so the
     block is withheld outright rather than published with an empty selector. */
  if (gate.fullyDeniedBlockTypes.has(owner.type)) return true
  return isHiddenUnder(vis, owner)
}

/**
 * The per-viewer gates the static-file filter applies, carried together so a
 * caller cannot pass one and forget the other.
 */
interface StaticFileGate {
  /** Lowercased block types the viewer may use; `null` when unrestricted. */
  allowedIntegrationTypes: ReadonlySet<string> | null
  /** Block types whose every selectable operation the viewer's group denies. */
  fullyDeniedBlockTypes: ReadonlySet<string>
}

const UNGATED_STATIC_FILES: StaticFileGate = {
  allowedIntegrationTypes: null,
  fullyDeniedBlockTypes: new Set(),
}

function isStaticFileHidden(
  path: string,
  vis: BlockVisibilityState | null,
  gate: StaticFileGate = UNGATED_STATIC_FILES
): boolean {
  const blockMatch = path.match(/^components\/(?:blocks|triggers\/sim)\/([^/]+)\.json$/)
  if (blockMatch) {
    const config = BLOCK_REGISTRY[blockMatch[1]!]
    return config ? isBlockOwnerHidden(config, vis, gate) : false
  }
  const triggerOwners = triggerPathOwners.get(path)
  if (triggerOwners) {
    return (
      triggerOwners.length > 0 &&
      triggerOwners.every((owner) => isBlockOwnerHidden(owner, vis, gate))
    )
  }
  const owners = integrationPathOwners.get(path)
  return owners
    ? owners.length > 0 && owners.every((owner) => isBlockOwnerHidden(owner, vis, gate))
    : false
}

function buildIntegrationAggregateFiles(
  exposedTools: readonly ExposedIntegrationTool[]
): Map<string, string> {
  const oauthServices = new Map<
    string,
    {
      provider: string
      operations: string[]
      oauthAvailable: boolean
      serviceAccount?: VfsServiceAccountAuth
    }
  >()
  for (const { config: tool, service, operation, blockType } of exposedTools) {
    if (!tool.oauth?.required) continue
    const oauthAvailable = isOAuthServiceDeploymentAvailable(tool.oauth.provider)
    const serviceAccount = describeServiceAccountForOAuthProvider(tool.oauth.provider, blockType)
    if (!oauthAvailable && !serviceAccount) continue
    const existing = oauthServices.get(service)
    if (existing) {
      existing.operations.push(operation)
      existing.oauthAvailable ||= oauthAvailable
      existing.serviceAccount ??= serviceAccount
    } else {
      oauthServices.set(service, {
        provider: tool.oauth.provider,
        operations: [operation],
        oauthAvailable,
        serviceAccount,
      })
    }
  }

  return new Map([
    [
      'environment/oauth-integrations.json',
      JSON.stringify(Object.fromEntries(oauthServices), null, 2),
    ],
    ['environment/api-key-integrations.json', serializeApiKeyIntegrations(exposedTools, isHosted)],
  ])
}

function buildTriggerOverview(vis: BlockVisibilityState | null, gate: StaticFileGate): string {
  const builtinTriggers = Object.values(BLOCK_REGISTRY)
    .filter(
      (block) =>
        block.category === 'triggers' &&
        !block.preview &&
        !isStaticFileHidden(`components/triggers/sim/${block.type}.json`, vis, gate)
    )
    .map((block) => ({
      id: block.type,
      name: block.name,
      provider: 'sim',
      description: block.description,
    }))
  const externalTriggers = Object.entries(TRIGGER_REGISTRY)
    .filter(
      ([id, trigger]) =>
        !isStaticFileHidden(`components/triggers/${trigger.provider}/${id}.json`, vis, gate)
    )
    .map(([id, trigger]) => ({
      id,
      name: trigger.name,
      provider: trigger.provider,
      description: trigger.description,
    }))
  return serializeTriggerOverview(builtinTriggers, externalTriggers)
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
 * Tool configs keyed by every id a block schema may reference, memoized for the
 * process. Shared by the one-time static build and the per-viewer re-projection
 * of a block whose operations are partly denied.
 */
let staticToolConfigs: ReadonlyMap<string, ExecutableToolConfig> | null = null

function getStaticToolConfigs(): ReadonlyMap<string, ExecutableToolConfig> {
  if (staticToolConfigs) return staticToolConfigs
  const configs = new Map<string, ExecutableToolConfig>()
  for (const { toolId, config } of getExposedIntegrationTools()) {
    configs.set(toolId, config)
    configs.set(config.id, config)
  }
  staticToolConfigs = configs
  return configs
}

const BLOCK_SCHEMA_PATH_PREFIX = 'components/blocks/'
const INTEGRATION_SCHEMA_PATH_PREFIX = 'components/integrations/'

/** The per-viewer projections applied to a shared static component file. */
interface StaticFileProjection {
  sandboxEntitled: boolean
  deniedOperations: DeniedBlockOperations
  isToolAllowed: IsToolAllowed
}

/**
 * The viewer's copy of one shared static component file.
 *
 * Returns the shared string untouched unless this viewer actually loses
 * something, so the process-global build stays the hot path and only a block
 * carrying a denied operation pays for a re-serialization.
 */
function projectStaticComponentFile(
  path: string,
  content: string,
  projection: StaticFileProjection
): string {
  if (path === 'components/blocks/function.json' && !projection.sandboxEntitled) {
    return staticFunctionSchemaWithRestrictedSimSandboxes ?? content
  }
  if (projection.deniedOperations.needsProjection.size === 0) return content
  if (!path.startsWith(BLOCK_SCHEMA_PATH_PREFIX)) return content

  const blockType = path.match(/^components\/blocks\/([^/]+)\.json$/)?.[1]
  if (!blockType) return content
  const deniedOperationIds = projection.deniedOperations.needsProjection.get(blockType)
  if (!deniedOperationIds) return content
  const block = BLOCK_REGISTRY[blockType]
  if (!block) return content

  return serializeBlockSchema(block, {
    toolConfigs: getStaticToolConfigs(),
    deniedOperationIds,
    isToolAllowed: projection.isToolAllowed,
  })
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
  // universe. Preview blocks get schema files here and are filtered per viewer
  // at stamp time. Viewer-specific aggregate files are built during materialization.
  const allBlocks = Object.values(BLOCK_REGISTRY)
  const visibleBlocks = allBlocks.filter((block) => !block.hideFromToolbar)
  const exposedTools = getExposedIntegrationTools()
  const toolConfigs = getStaticToolConfigs()

  let blocksFiltered = 0
  for (const block of visibleBlocks) {
    const path = `components/blocks/${block.type}.json`
    files.set(path, serializeBlockSchema(block, { toolConfigs }))
    if (block.type === 'function') {
      staticFunctionSchemaWithRestrictedSimSandboxes = serializeBlockSchema(block, {
        toolConfigs,
        restrictedInputs: RESTRICTED_SIM_SANDBOX_INPUTS,
      })
    }
  }
  blocksFiltered = allBlocks.length - visibleBlocks.length

  let integrationCount = 0

  // Integration tools come from the shared exposed-tool set (latest version of
  // each operation owned by a visible block), the same set used to build the
  // deferred callable tools — so discovery and execution can never drift.
  for (const exposedTool of exposedTools) {
    const { config: tool, service, operation } = exposedTool
    const path = `components/integrations/${service}/${operation}.json`
    files.set(
      path,
      serializeIntegrationSchema(tool, {
        oauthAvailable: !tool.oauth || isOAuthServiceDeploymentAvailable(tool.oauth.provider),
      })
    )
    const owners = integrationPathOwners.get(path) ?? []
    for (const owner of exposedTool.owners) {
      if (!owners.some((existing) => existing.type === owner.blockType)) {
        owners.push({ type: owner.blockType, preview: owner.preview })
      }
    }
    integrationPathOwners.set(path, owners)
    integrationCount++
  }

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

  files.set('components/triggers/triggers.md', buildTriggerOverview(null, UNGATED_STATIC_FILES))

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
 *   custom-tools/{name}.json
 *   agent/sandboxes/README.md
 *   agent/sandboxes/{name}.json
 *   account/workspace.json                           (this workspace + your role; always present)
 *   account/workspaces.json                          (every workspace you can reach)
 *   account/members.json                             (workspace members; emails admin-only)
 *   account/billing.json                             (plan/usage/credits; lazy, read fresh)
 *   organization/organization.json                   (org standing; only when org-hosted)
 *   organization/access-control.json                 (your governing group + restrictions)
 *   organization/custom-blocks.json                  (org-published block provenance)
 *   organization/forks.json                          (fork topology; workspace admins only)
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
  private readonly filePrincipal?: Principal
  private readonly knowledgePrincipal?: Principal
  private readonly loadConnectedAccounts?: () => Promise<CredentialGroupRecord | null>
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
  private customBlocksPromise: Promise<CustomBlockWithInputs[]> | undefined
  private _workspaceId = ''
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

  constructor(
    filePrincipal?: Principal,
    knowledgePrincipal?: Principal,
    loadConnectedAccounts?: () => Promise<CredentialGroupRecord | null>
  ) {
    this.filePrincipal = filePrincipal
    this.knowledgePrincipal = knowledgePrincipal
    this.loadConnectedAccounts = loadConnectedAccounts
  }

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
  private loadDeployments(workflowId: string): Promise<DeploymentData | null> {
    let cached = this.deploymentCache.get(workflowId)
    if (!cached) {
      cached = this.getWorkflowDeployments(workflowId, this._workspaceId)
      this.deploymentCache.set(workflowId, cached)
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
      this.lazy.set(path, loader)
      throw err
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
    // One unmaterializable artifact (e.g. an over-limit knowledge base's
    // documents.json) must not fail the whole sweep — that would make every
    // unscoped grep on the workspace error on content the caller never asked
    // about. Skip it: grep proceeds over everything that resolved, the loader
    // stays re-armed, and reading the failing path directly still surfaces its
    // own error (resolveLazyPath logs each failure).
    await Promise.allSettled(targets.map((path) => this.resolveLazyPath(path)))
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
  async materialize(
    workspaceId: string,
    userId: string,
    options?: { secretMountPolicy?: SecretMountPolicy }
  ): Promise<void> {
    const start = Date.now()
    this.files = new Map()
    this.lazy = new Map()
    this.normalizedCache = new Map()
    this.deploymentCache = new Map()
    this.customBlocksPromise = undefined
    this._customBlockTypes = null
    this._workspaceId = workspaceId

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
            const blockVisibility = overlayVisibility()
            const permissionConfigPromise = timed(
              'permissions',
              resolvePermissionGroupConfig(userId, workspaceId, undefined)
            )
            const sandboxEntitlementPromise = timed(
              'sandbox_entitlement',
              hasWorkspaceSandboxAccess(workspaceId)
            )
            // Shared with the account/ and organization/ namespaces so the
            // roster and host context are each read once per materialization.
            const membersPromise = timed('members', getUsersWithPermissions(workspaceId))
            const hostContextPromise = timed(
              'host_context',
              getWorkspaceHostContextForViewer(workspaceId, userId).catch(() => null)
            )
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
              sandboxesSummary,
              wsRow,
              members,
              permissionConfig,
              sandboxEntitled,
            ] = await Promise.all([
              timed('workflows', this.materializeWorkflows(workspaceId)),
              timed('knowledge_bases', this.materializeKnowledgeBases(workspaceId)),
              timed('tables', this.materializeTables(workspaceId)),
              timed('files', this.materializeFiles(workspaceId)),
              timed(
                'environment',
                this.materializeEnvironment(
                  workspaceId,
                  userId,
                  permissionConfigPromise,
                  blockVisibility,
                  options?.secretMountPolicy
                )
              ),
              timed('custom_tools', this.materializeCustomTools(workspaceId, userId)),
              timed('custom_blocks', this.materializeCustomBlocks(workspaceId)),
              timed('mcp_servers', this.materializeMcpServers(workspaceId)),
              timed('skills', this.materializeSkills(workspaceId)),
              timed(
                'sandboxes',
                sandboxEntitlementPromise.then((entitled) =>
                  entitled ? this.materializeSandboxes(workspaceId) : []
                )
              ),
              timed('workspace_row', getWorkspaceWithOwner(workspaceId)),
              membersPromise,
              permissionConfigPromise,
              sandboxEntitlementPromise,
            ])

            // account/ and organization/ describe the viewer's standing rather
            // than workspace resources, so they are materialized after the
            // resource pass and contribute nothing to WORKSPACE.md.
            const hostContext = await hostContextPromise
            await Promise.all([
              timed('account', this.materializeAccount(workspaceId, userId, hostContext, members)),
              timed('organization', this.materializeOrganization(workspaceId, userId, hostContext)),
            ])
            const workspaceMdData: WorkspaceMdData = {
              workspace: wsRow,
              members,
              workflows: wfSummary,
              knowledgeBases: kbSummary,
              tables: tblSummary,
              files: fileSummary,
              oauthIntegrations: envSummary.oauthIntegrations,
              envVariables: envSummary.envVariables,
              customTools: toolsSummary,
              customBlocks: customBlocksSummary,
              mcpServers: mcpServersSummary,
              skills: skillsSummary,
              ...(sandboxEntitled ? { sandboxes: sandboxesSummary } : {}),
            }

            this.files.set('WORKSPACE.md', buildWorkspaceMd(workspaceMdData))
            this.files.set('WORKSPACE_CONTEXT.md', buildWorkspaceContextMd(workspaceMdData))

            await timed('recently_deleted', this.materializeRecentlyDeleted(workspaceId))

            // Per-viewer gating happens HERE, not in the shared builder: files
            // owned by blocks hidden for this viewer are skipped at stamp time.
            const {
              tools: viewerIntegrationTools,
              allowedBlockTypes,
              isToolAllowed,
            } = projectIntegrationToolsForViewer(blockVisibility, permissionConfig)
            const deniedOperations = resolveDeniedBlockOperations(
              permissionConfig?.deniedTools,
              isToolAllowed
            )
            const staticFileGate: StaticFileGate = {
              allowedIntegrationTypes: allowedBlockTypes,
              fullyDeniedBlockTypes: deniedOperations.fullyDenied,
            }
            const staticFileProjection: StaticFileProjection = {
              sandboxEntitled,
              deniedOperations,
              isToolAllowed,
            }
            for (const [path, content] of getStaticComponentFiles()) {
              /* Integration schemas are authored per viewer from
                 `viewerIntegrationTools` immediately below, which is the only
                 projection that knows the group's per-tool denylist. Stamping
                 the shared copy first would publish a denied operation's schema
                 that the loop below never overwrites, because it only writes the
                 operations the viewer may use. */
              if (path.startsWith(INTEGRATION_SCHEMA_PATH_PREFIX)) continue
              if (isStaticFileHidden(path, blockVisibility, staticFileGate)) continue
              this.files.set(path, projectStaticComponentFile(path, content, staticFileProjection))
            }
            for (const exposedTool of viewerIntegrationTools) {
              const { config: tool, service, operation, blockType } = exposedTool
              this.files.set(
                `components/integrations/${service}/${operation}.json`,
                serializeIntegrationSchema(tool, {
                  oauthAvailable:
                    !tool.oauth || isOAuthServiceDeploymentAvailable(tool.oauth.provider),
                  ownerBlockType: blockType,
                })
              )
            }
            for (const [path, content] of buildIntegrationAggregateFiles(viewerIntegrationTools)) {
              this.files.set(path, content)
            }
            this.files.set(
              'components/triggers/triggers.md',
              buildTriggerOverview(blockVisibility, staticFileGate)
            )

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
    return (await this.grepFileWithProvenance(path, pattern, options)).value
  }

  async grepFileWithProvenance(
    path: string,
    pattern: string,
    options?: GrepOptions
  ): Promise<WorkspaceFileSecretProvenanceEnvelope<GrepMatch[] | string[] | ops.GrepCountEntry[]>> {
    const normalized = path.replace(/^\/+/, '')
    // Prefer the path verbatim when it is itself a file leaf (e.g. a file literally
    // named "content"); otherwise drop a trailing "/content" read suffix.
    let leaf = this.files.has(normalized) ? normalized : normalized.replace(/\/content$/, '')

    let isWorkspaceFilePath = /^(recently-deleted\/)?files(\/|$)/.test(leaf)
    if (isWorkspaceFilePath && !this.files.has(leaf)) {
      // Same encoding tolerance as vfs_read: a decoded display form that maps
      // to exactly one canonical key resolves instead of erroring.
      const decodedEquivalent = this.resolveDecodedEquivalent(leaf)
      if (decodedEquivalent) {
        leaf = decodedEquivalent
        isWorkspaceFilePath = /^(recently-deleted\/)?files(\/|$)/.test(leaf)
      }
    }
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
    const result = await this.readFileContentWithProvenance(contentPath)
    if (!result) {
      throw new ops.WorkspaceFileGrepError(`Workspace file content not found for "${path}".`)
    }
    if (result.value.placeholder === 'oversized') {
      throw new ops.WorkspaceFileGrepError(`File is too large to search: ${result.value.content}`)
    }

    return {
      value: ops.grepReadResult(leaf, result.value, pattern, contentPath, options),
      file: result.file,
    }
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

  /**
   * Resolves a missing path to an existing one when the two differ ONLY by
   * percent-encoding (the model typed the decoded display form — spaces
   * instead of %20). Returns the canonical existing path when exactly one key
   * decodes to the same segments; ambiguity or a genuine miss returns null so
   * the not-found error (with suggestions) still fires. Never fuzzy: same
   * name, different bytes only.
   */
  resolveDecodedEquivalent(missingPath: string): string | null {
    const target = decodeVfsPathSegmentsSafe(missingPath)
    let match: string | null = null
    for (const key of this.keyView(true).keys()) {
      if (decodeVfsPathSegmentsSafe(key) !== target) continue
      if (match !== null) return null
      match = key
    }
    return match
  }

  private async resolveWorkspaceFileForDynamicRead(
    path: string,
    suffix: 'style' | 'compiled-check' | 'compiled' | 'render' | 'extract'
  ): Promise<WorkspaceFileRecord | null> {
    const canonicalMatch = path.match(new RegExp(`^files/(.+)/${suffix}$`))
    if (!canonicalMatch?.[1]) return null

    if (!this.filePrincipal) {
      throw new Error('Workspace file reads require a trusted Copilot principal')
    }
    const { files } = await listAllWorkspaceFiles.execute({
      principal: this.filePrincipal,
      input: { workspaceId: this._workspaceId, scope: 'active' },
    })
    return findWorkspaceFileRecord(files, `files/${canonicalMatch[1]}`)
  }

  private requireFilePrincipal(): Principal {
    if (!this.filePrincipal) {
      throw new Error('Workspace file reads require a trusted Copilot principal')
    }
    return this.filePrincipal
  }

  private requireKnowledgePrincipal(): Principal {
    if (!this.knowledgePrincipal) {
      throw new Error('Workspace Knowledge reads require a trusted Copilot principal')
    }
    return this.knowledgePrincipal
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
    buildMessage: (pageCount: number) => string,
    contributingFiles: Map<string, WorkspaceFileSecretProvenanceIdentity>
  ): Promise<FileReadResult> {
    if (typeof record.size === 'number' && record.size > MAX_DOC_READ_INPUT_BYTES) {
      return renderErrorResult('File is too large to render')
    }
    const { content: buffer } = await readWorkspaceFileContent.execute({
      principal: this.requireFilePrincipal(),
      input: {
        fileId: record.id,
        assertedWorkspaceId: this._workspaceId,
        maxBytes: MAX_DOC_READ_INPUT_BYTES,
      },
    })
    if (buffer.length > MAX_DOC_READ_INPUT_BYTES) {
      return renderErrorResult('File is too large to render')
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
        return renderErrorResult('File source exceeds maximum size')
      }
      if (isDocSandboxEnabled && (await getE2BDocFormat(record.name))) {
        bin = (
          await compileDoc({
            source: code,
            fileName: record.name,
            workspaceId: this._workspaceId,
            filePrincipal: this.requireFilePrincipal(),
          })
        ).buffer
      } else {
        const taskId = BINARY_DOC_TASKS[ext]
        if (!taskId) {
          return renderErrorResult('Cannot render this file')
        }
        bin = await runSandboxTask(
          taskId,
          { code, workspaceId: this._workspaceId },
          {
            onWorkspaceFileAccess: (identity) =>
              recordContributingFile(contributingFiles, identity),
          }
        )
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
    return (await this.readFileContentWithProvenance(path))?.value ?? null
  }

  async readFileContentWithProvenance(
    path: string
  ): Promise<WorkspaceFileSecretProvenanceEnvelope<FileReadResult> | null> {
    const compiledMatch = /^files\/.+\/compiled$/.test(path)
    if (compiledMatch) {
      let record: WorkspaceFileRecord | null = null
      const contributingFiles = new Map<string, WorkspaceFileSecretProvenanceIdentity>()
      try {
        record = await this.resolveWorkspaceFileForDynamicRead(path, 'compiled')
        if (!record) return null
        const ext = record.name.split('.').pop()?.toLowerCase() ?? ''
        const docFmt = await getE2BDocFormat(record.name)
        const taskId = BINARY_DOC_TASKS[ext]
        if (!docFmt && !taskId) return null

        // Only PDF can be attached as a model-readable `document` block —
        // Bedrock/Anthropic document blocks accept application/pdf ONLY. Attaching
        // raw pptx/docx/xlsx binary is rejected by the provider (400). So for
        // pptx/docx, render to page images (which the model CAN read) and return
        // those directly — /compiled can never emit an invalid document block for
        // these formats. xlsx isn't renderable; direct to /extract for its content.
        if (ext !== 'pdf') {
          if (isRenderableDocExt(ext)) {
            const compiledName = record.name
            const rendered = await this.renderDocRecordResult(
              record,
              ext,
              (pageCount) =>
                `${compiledName}: the raw ${ext.toUpperCase()} binary isn't model-readable, so it was rendered to ${pageCount} page image(s) for inspection.`,
              contributingFiles
            )
            return bindWorkspaceFileResult(record, rendered, 'derived', [
              ...contributingFiles.values(),
            ])
          }
          const extractPath = `${canonicalWorkspaceFilePath({
            folderPath: record.folderPath,
            name: record.name,
          })}/extract`
          return bindWorkspaceFileResult(record, {
            content: `${record.name} is a spreadsheet — read "${extractPath}" for its contents.`,
            totalLines: 1,
          })
        }

        const { content: buffer } = await readWorkspaceFileContent.execute({
          principal: this.requireFilePrincipal(),
          input: {
            fileId: record.id,
            assertedWorkspaceId: this._workspaceId,
            maxBytes: MAX_DOC_READ_INPUT_BYTES,
          },
        })
        const code = buffer.toString('utf-8')
        if (Buffer.byteLength(code, 'utf-8') > MAX_DOCUMENT_PREVIEW_CODE_BYTES) {
          return bindWorkspaceFileResult(record, {
            content: JSON.stringify({ ok: false, error: 'File source exceeds maximum size' }),
            totalLines: 1,
          })
        }
        let compiled: Buffer
        if (isDocSandboxEnabled && docFmt) {
          const compiledResult = await compileDoc({
            source: code,
            fileName: record.name,
            workspaceId: this._workspaceId,
            filePrincipal: this.requireFilePrincipal(),
          })
          for (const identity of compiledResult.contributingFiles ?? []) {
            recordContributingFile(contributingFiles, identity)
          }
          compiled = compiledResult.buffer
        } else {
          compiled = await runSandboxTask(
            taskId,
            { code, workspaceId: this._workspaceId },
            {
              onWorkspaceFileAccess: (identity) =>
                recordContributingFile(contributingFiles, identity),
            }
          )
        }
        if (compiled.length > MAX_COMPILED_ATTACHMENT_BYTES) {
          return bindWorkspaceFileResult(
            record,
            readPlaceholder.compiledArtifactTooLarge(
              record.name,
              compiled.length,
              MAX_COMPILED_ATTACHMENT_BYTES
            )
          )
        }
        return bindWorkspaceFileResult(
          record,
          {
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
          },
          'derived',
          [...contributingFiles.values()]
        )
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
          return record
            ? bindWorkspaceFileResult(record, { content: json, totalLines: 1 })
            : { value: { content: json, totalLines: 1 } }
        }
        return null
      }
    }

    const renderMatch = /^files\/.+\/render$/.test(path)
    if (renderMatch) {
      let record: WorkspaceFileRecord | null = null
      const contributingFiles = new Map<string, WorkspaceFileSecretProvenanceIdentity>()
      try {
        record = await this.resolveWorkspaceFileForDynamicRead(path, 'render')
        if (!record) return null
        const ext = record.name.split('.').pop()?.toLowerCase() ?? ''
        if (!isRenderableDocExt(ext)) {
          return bindWorkspaceFileResult(
            record,
            renderErrorResult('Render supports .pptx, .docx, and .pdf only')
          )
        }
        const renderName = record.name
        const rendered = await this.renderDocRecordResult(
          record,
          ext,
          (pageCount) =>
            `Rendered ${pageCount} page(s) of ${renderName} as a contact-sheet grid for visual QA. Inspect each page for text overflow/cutoff, overlapping elements, low contrast, misalignment, and leftover placeholder text; fix and re-render until clean.`,
          contributingFiles
        )
        return bindWorkspaceFileResult(record, rendered, 'derived', [...contributingFiles.values()])
      } catch (err) {
        const error = toError(err).message
        logger.warn('Render read failed via VFS', {
          workspaceId: this._workspaceId,
          path,
          fileId: record?.id,
          error,
        })
        // Return an explicit error (not null) once the file resolved — a null read
        // looks like a missing path and sends the agent hunting for the "correct"
        // render path instead of surfacing the real compile/render failure.
        const errorResult = renderErrorResult(error)
        return record ? bindWorkspaceFileResult(record, errorResult) : { value: errorResult }
      }
    }

    const extractMatch = /^files\/.+\/extract$/.test(path)
    if (extractMatch && isDocSandboxEnabled) {
      let record: WorkspaceFileRecord | null = null
      try {
        record = await this.resolveWorkspaceFileForDynamicRead(path, 'extract')
        if (!record) return null
        const ext = record.name.split('.').pop()?.toLowerCase() ?? ''
        if (!isExtractableDocExt(ext)) {
          return bindWorkspaceFileResult(record, {
            content: JSON.stringify({
              ok: false,
              error: 'Extraction supports .pdf, .pptx, .docx, and .xlsx only',
            }),
            totalLines: 1,
          })
        }
        // Bound the input before downloading + base64-staging it in-process.
        if (typeof record.size === 'number' && record.size > MAX_DOC_READ_INPUT_BYTES) {
          return bindWorkspaceFileResult(record, {
            content: JSON.stringify({ ok: false, error: 'File is too large to extract' }),
            totalLines: 1,
          })
        }
        const { content: buffer } = await readWorkspaceFileContent.execute({
          principal: this.requireFilePrincipal(),
          input: {
            fileId: record.id,
            assertedWorkspaceId: this._workspaceId,
            maxBytes: MAX_DOC_READ_INPUT_BYTES,
          },
        })
        if (buffer.length > MAX_DOC_READ_INPUT_BYTES) {
          return bindWorkspaceFileResult(record, {
            content: JSON.stringify({ ok: false, error: 'File is too large to extract' }),
            totalLines: 1,
          })
        }
        // Extraction reads the binary. A source-backed generated doc (text source,
        // no binary magic) should be read directly instead — point the agent there.
        if (!isBinaryDocBuffer(buffer, ext)) {
          return bindWorkspaceFileResult(record, {
            content: JSON.stringify({
              ok: false,
              error: 'This is a source-backed generated file; read its content directly instead.',
            }),
            totalLines: 1,
          })
        }
        const { text, truncated } = await extractDocText({ binary: buffer, ext })
        const note = truncated
          ? '\n\n[... truncated — read the file directly for the full content]'
          : ''
        return bindWorkspaceFileResult(record, {
          content: `${text || '[no extractable text found]'}${note}`,
          totalLines: 1,
        })
      } catch (err) {
        logger.warn('Extract read failed via VFS', {
          workspaceId: this._workspaceId,
          path,
          fileId: record?.id,
          error: toError(err).message,
        })
        const errorResult = {
          content: JSON.stringify({ ok: false, error: toError(err).message }),
          totalLines: 1,
        }
        return record ? bindWorkspaceFileResult(record, errorResult) : { value: errorResult }
      }
    }

    const compiledCheckMatch = /^files\/.+\/compiled-check$/.test(path)
    if (compiledCheckMatch) {
      let record: WorkspaceFileRecord | null = null
      try {
        record = await this.resolveWorkspaceFileForDynamicRead(path, 'compiled-check')
        if (!record) return null
        const ext = record.name.split('.').pop()?.toLowerCase() ?? ''
        const e2bFmt = isDocSandboxEnabled ? await getE2BDocFormat(record.name) : null
        const taskId = BINARY_DOC_TASKS[ext]
        const isMermaidFile = ext === 'mmd' || ext === 'mermaid'
        // Sim pages (and legacy .html-named page source) compile-check too:
        // this is the only way an agent can retrieve the "block skipped"
        // diagnostics for an ALREADY-written page — without it, "find the
        // malformed table" degenerates into guessing.
        const maybeSimPage = record.type === SIM_PAGE_CONTENT_TYPE || ext === 'html'
        if (!e2bFmt && !taskId && !isMermaidFile && !maybeSimPage) return null
        const { content: buffer } = await readWorkspaceFileContent.execute({
          principal: this.requireFilePrincipal(),
          input: {
            fileId: record.id,
            assertedWorkspaceId: this._workspaceId,
            maxBytes: MAX_DOC_READ_INPUT_BYTES,
          },
        })
        const code = buffer.toString('utf-8')
        if (Buffer.byteLength(code, 'utf-8') > MAX_DOCUMENT_PREVIEW_CODE_BYTES) {
          return bindWorkspaceFileResult(record, {
            content: JSON.stringify({ ok: false, error: 'File source exceeds maximum size' }),
            totalLines: 1,
          })
        }
        if (maybeSimPage && isSimPageSource(code)) {
          const diagnostics = collectSimPageDiagnostics(code)
          const result =
            diagnostics.length === 0
              ? { ok: true }
              : {
                  ok: false,
                  error: `${diagnostics.length} block(s) fail to compile and are omitted from the rendered page: ${diagnostics.join('; ')}`,
                }
          return bindWorkspaceFileResult(record, {
            content: JSON.stringify(result),
            totalLines: 1,
          })
        }
        if (maybeSimPage && !e2bFmt && !taskId && !isMermaidFile) {
          if (record.type === SIM_PAGE_CONTENT_TYPE) {
            // A page-typed file whose bytes are not page source (e.g. a crash
            // between upload registration and source restore) — report it
            // rather than pretending the path does not exist.
            return bindWorkspaceFileResult(record, {
              content: JSON.stringify({
                ok: false,
                error:
                  'Stored content is not page source (no YAML frontmatter with a title) — the file renders as raw HTML',
              }),
              totalLines: 1,
            })
          }
          // Bespoke raw HTML has no compiler to check.
          return null
        }
        if (isMermaidFile) {
          const result = await validateMermaidSource(code)
          const json = JSON.stringify(result)
          return bindWorkspaceFileResult(record, { content: json, totalLines: 1 })
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
            principal: this.requireFilePrincipal(),
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
        return bindWorkspaceFileResult(record, { content: json, totalLines: 1 })
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
        if (typeof record.size === 'number' && record.size > MAX_DOC_READ_INPUT_BYTES) {
          return bindWorkspaceFileResult(record, {
            content: JSON.stringify({ ok: false, error: 'File is too large to extract style' }),
            totalLines: 1,
          })
        }
        const { content: buffer } = await readWorkspaceFileContent.execute({
          principal: this.requireFilePrincipal(),
          input: {
            fileId: record.id,
            assertedWorkspaceId: this._workspaceId,
            maxBytes: MAX_DOC_READ_INPUT_BYTES,
          },
        })
        const summary = await extractDocumentStyle(buffer, ext)
        if (!summary) return null
        const json = JSON.stringify(summary, null, 2)
        return bindWorkspaceFileResult(record, {
          content: json,
          totalLines: json.split('\n').length,
        })
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

    if (fileReference.endsWith('/meta.json') || path.endsWith('/meta.json')) return null

    const scope = deletedMatch ? 'archived' : 'active'

    let sizeCappedRecord: WorkspaceFileRecord | undefined
    let sizeCap = MAX_TEXT_READ_BYTES
    try {
      const { files } = await listAllWorkspaceFiles.execute({
        principal: this.requireFilePrincipal(),
        input: { workspaceId: this._workspaceId, scope },
      })
      const record = findWorkspaceFileRecord(files, fileReference)
      if (!record) return null
      sizeCappedRecord = record
      sizeCap = isImageFileType(resolveEffectiveMimeType(record.type, record.name))
        ? MAX_IMAGE_SOURCE_BYTES
        : MAX_TEXT_READ_BYTES
      const { file, content } = await readWorkspaceFileContent.execute({
        principal: this.requireFilePrincipal(),
        input: {
          fileId: record.id,
          assertedWorkspaceId: this._workspaceId,
          includeDeleted: scope === 'archived',
          maxBytes: sizeCap,
        },
      })
      const result = await readFileRecord(file, content)
      return result
        ? bindWorkspaceFileResult(
            file,
            result,
            isReadableFileType(file.type) ? 'complete' : 'derived'
          )
        : null
    } catch (err) {
      // A cap breach is an answer, not a lookup failure: returning null here
      // reported multi-MB files as "content not found". The oversized
      // placeholder tells the model the file exists and why it can't be read.
      if (isPayloadSizeLimitError(err) && sizeCappedRecord) {
        return bindWorkspaceFileResult(
          sizeCappedRecord,
          readPlaceholder.fileTooLarge(sizeCappedRecord.name, sizeCappedRecord.size ?? 0, sizeCap)
        )
      }
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
   * Folder paths for a non-workflow resource tree (tables, knowledge bases),
   * plus `.folder` markers so empty folders are discoverable via glob — the
   * same contract workflows/ has. Returns folderId → encoded folder path.
   */
  private async registerResourceFolders(
    workspaceId: string,
    resourceType: 'table' | 'knowledge_base',
    rootSegment: 'tables' | 'knowledgebases'
  ): Promise<Map<string, string>> {
    const folders = await listFoldersForWorkspace(workspaceId, 'active', resourceType)
    const paths = buildVfsFolderPathMap(
      folders.map((f) => ({ folderId: f.id, folderName: f.name, parentId: f.parentId }))
    )
    for (const folderPath of paths.values()) {
      this.files.set(`${rootSegment}/${folderPath}/.folder`, '')
    }
    return paths
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
    const [workflowRows, folderRows] = await Promise.all([
      listWorkflows(workspaceId),
      listFolders(workspaceId),
    ])
    const deploymentVersionRows =
      workflowRows.length === 0
        ? []
        : await db
            .select({
              workflowId: workflowDeploymentVersion.workflowId,
              isActive: workflowDeploymentVersion.isActive,
              createdAt: workflowDeploymentVersion.createdAt,
            })
            .from(workflowDeploymentVersion)
            .where(
              inArray(
                workflowDeploymentVersion.workflowId,
                workflowRows.map((workflowRow) => workflowRow.id)
              )
            )
    const versionedWorkflowIds = new Set(
      deploymentVersionRows.map((deploymentVersion) => deploymentVersion.workflowId)
    )
    const activeDeploymentDates = new Map<string, Date>()
    for (const deploymentVersion of deploymentVersionRows) {
      if (!deploymentVersion.isActive) continue
      const current = activeDeploymentDates.get(deploymentVersion.workflowId)
      if (!current || current < deploymentVersion.createdAt) {
        activeDeploymentDates.set(deploymentVersion.workflowId, deploymentVersion.createdAt)
      }
    }

    const folderPaths = this.buildFolderPaths(folderRows)
    const lockedFolderIds = this.computeLockedFolderIds(folderRows)

    // Register all folders in the VFS so empty folders are discoverable.
    for (const { folderId } of folderRows) {
      const folderPath = folderPaths.get(folderId)
      if (folderPath) {
        this.files.set(`workflows/${folderPath}/.folder`, '')
      }
    }

    await Promise.all(
      workflowRows.map(async (wf) => {
        const deployedAt = activeDeploymentDates.get(wf.id) ?? null
        const authoritativeWorkflow = {
          ...wf,
          isDeployed: deployedAt !== null,
          deployedAt,
        }
        const folderPath = wf.folderId ? folderPaths.get(wf.folderId) : null
        const prefix = `${canonicalWorkflowVfsDir({ name: wf.name, folderPath })}/`

        const inheritedFolderLock = wf.folderId ? lockedFolderIds.has(wf.folderId) : false
        this.files.set(
          `${prefix}meta.json`,
          serializeWorkflowMeta(authoritativeWorkflow, { inheritedFolderLock })
        )

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

        // deployment.json exists for EVERY workflow: "is it deployed?" is a
        // question with an answer either way, and a not-found error here was a
        // recurring red herring — agents probing an undeployed workflow read a
        // failure instead of the fact. Versions stay gated: they genuinely
        // don't exist before the first deploy.
        this.registerLazy(`${prefix}deployment.json`, async () => {
          if (!versionedWorkflowIds.has(wf.id)) {
            return JSON.stringify({
              deployed: false,
              note: 'This workflow has never been deployed.',
            })
          }
          const deploymentData = await this.loadDeployments(wf.id)
          return deploymentData
            ? serializeDeployments(deploymentData)
            : JSON.stringify({ deployed: false, note: 'This workflow has never been deployed.' })
        })
        if (versionedWorkflowIds.has(wf.id)) {
          this.registerLazy(`${prefix}versions.json`, async () => {
            const deploymentData = await this.loadDeployments(wf.id)
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
      isDeployed: activeDeploymentDates.has(wf.id),
      lastRunAt: wf.lastRunAt,
      folderPath: wf.folderId ? (folderPaths.get(wf.folderId) ?? null) : null,
    }))
  }

  /** Materializes authorized knowledge summaries for WORKSPACE.md generation. */
  private async materializeKnowledgeBases(
    workspaceId: string
  ): Promise<WorkspaceMdData['knowledgeBases']> {
    const { knowledgeBases } = await listKnowledgeBaseCatalog.execute({
      principal: this.requireKnowledgePrincipal(),
      input: { workspaceId },
    })
    const kbs = knowledgeBases.map(({ knowledgeBase }) => knowledgeBase)
    const folderPaths = await this.registerResourceFolders(
      workspaceId,
      'knowledge_base',
      'knowledgebases'
    )

    for (const { knowledgeBase: kb, tagDefinitions } of knowledgeBases) {
      const safeName = sanitizeName(kb.name)
      const folderPath = kb.folderId ? folderPaths.get(kb.folderId) : undefined
      const prefix = folderPath
        ? `knowledgebases/${folderPath}/${safeName}/`
        : `knowledgebases/${safeName}/`

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
          tagDefinitions: tagDefinitions.map((definition) => ({
            id: definition.id,
            tagName: definition.displayName,
            tagSlot: definition.tagSlot,
            fieldType: definition.fieldType,
          })),
        })
      )

      // documents.json / connectors.json are lazy, advertised only when the KB
      // summary says they exist (docCount / connectorTypes) — no per-KB query on
      // a read/glob, only when the artifact is read or grepped.
      if (kb.docCount > 0) {
        this.registerLazy(`${prefix}documents.json`, async () => {
          if (kb.docCount > MAX_VFS_KNOWLEDGE_DOCUMENTS) {
            throw new Error(
              `Knowledge base ${kb.id} has more than ${MAX_VFS_KNOWLEDGE_DOCUMENTS} documents; documents.json cannot be materialized`
            )
          }
          const documents: Awaited<ReturnType<typeof listKnowledgeDocuments.execute>>['documents'] =
            []
          let offset = 0
          while (true) {
            const page = await listKnowledgeDocuments.execute({
              principal: this.requireKnowledgePrincipal(),
              input: {
                knowledgeBaseId: kb.id,
                assertedWorkspaceId: workspaceId,
                limit: KNOWLEDGE_DOCUMENT_PAGE_SIZE,
                offset,
              },
            })
            documents.push(...page.documents)
            if (documents.length > MAX_VFS_KNOWLEDGE_DOCUMENTS) {
              throw new Error(
                `Knowledge base ${kb.id} exceeded the ${MAX_VFS_KNOWLEDGE_DOCUMENTS} document limit while materializing documents.json`
              )
            }
            if (!page.pagination.hasMore) break
            offset += page.pagination.limit
          }
          const docRows = documents.map((document) => ({
            id: document.id,
            filename: document.filename,
            fileSize: document.fileSize,
            mimeType: document.mimeType,
            chunkCount: document.chunkCount,
            tokenCount: document.tokenCount,
            processingStatus: document.processingStatus,
            enabled: document.enabled,
            uploadedAt: document.uploadedAt,
          }))
          return docRows.length > 0 ? serializeDocuments(docRows) : null
        })
      }

      if (kb.connectorTypes.length > 0) {
        this.registerLazy(`${prefix}connectors.json`, async () => {
          const { connectors: connectorRows } = await listKnowledgeConnectors.execute({
            principal: this.requireKnowledgePrincipal(),
            input: { knowledgeBaseId: kb.id, assertedWorkspaceId: workspaceId },
          })
          return connectorRows.length > 0 ? serializeConnectors(connectorRows) : null
        })
      }
    }

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
      const [tables, folderPaths, viewsByTable] = await Promise.all([
        listTables(workspaceId),
        this.registerResourceFolders(workspaceId, 'table', 'tables'),
        listTableViewsByWorkspace(workspaceId),
      ])

      for (const table of tables) {
        const safeName = sanitizeName(table.name)
        const folderPath = table.folderId ? folderPaths.get(table.folderId) : undefined
        const prefix = folderPath ? `tables/${folderPath}/${safeName}` : `tables/${safeName}`
        const viewRows = viewsByTable.get(table.id) ?? []
        if (viewRows.length > 0) {
          const columns = table.schema.columns
          this.files.set(
            `${prefix}/views.json`,
            serializeTableViews(
              viewRows.map((row) => {
                const config = viewConfigIdsToNames(
                  pruneViewConfig(
                    normalizeStoredViewConfig(row.config as Record<string, unknown>),
                    columns
                  ),
                  columns
                )
                return {
                  id: row.id,
                  name: row.name,
                  isDefault: row.isDefault,
                  filter: config.filter ?? null,
                  sort: config.sort ?? null,
                  hiddenColumns: config.hiddenColumns,
                  updatedAt: row.updatedAt,
                }
              })
            )
          )
        }
        this.files.set(
          `${prefix}/meta.json`,
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
      logger.error('Failed to materialize tables; refusing to serve an incomplete VFS', {
        workspaceId,
        error: toError(err).message,
      })
      throw err
    }
  }

  /**
   * Materialize workspace files (already uses listWorkspaceFiles).
   * Returns a summary for WORKSPACE.md generation.
   */
  private async materializeFiles(workspaceId: string): Promise<WorkspaceMdData['files']> {
    try {
      const principal = this.requireFilePrincipal()
      const [{ folders }, { files }] = await Promise.all([
        listWorkspaceFileFoldersOperation.execute({
          principal,
          input: { workspaceId, scope: 'active' },
        }),
        listAllWorkspaceFiles.execute({ principal, input: { workspaceId, scope: 'active' } }),
      ])
      for (const folder of folders) {
        this.files.set(
          `files/${encodeVfsPathSegments(parseWorkspaceFileFolderDisplayPath(folder.path))}/.folder`,
          ''
        )
      }

      for (const file of files) {
        const filePath = canonicalWorkspaceFilePath({
          folderPath: file.folderPath,
          name: file.name,
        })
        const share = file.share
        const shared = share?.isActive ?? false
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
            updatedAt: file.updatedAt,
            shared,
            shareAuthType: shared ? share?.authType : undefined,
            shareUrl: shared ? share?.url : undefined,
          })
        )
      }

      return files.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        size: f.size,
        folderPath: f.folderPath ?? null,
      }))
    } catch (err) {
      logger.error('Failed to materialize files; refusing to serve an incomplete VFS', {
        workspaceId,
        error: toError(err).message,
      })
      throw err
    }
  }

  /**
   * Query all deployment configurations for a single workflow.
   * Returns null if the workflow has no deployments of any kind.
   */
  private async getWorkflowDeployments(
    workflowId: string,
    workspaceId: string
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
          allowedEmails: chatTable.allowedEmails,
          outputConfigs: chatTable.outputConfigs,
          includeThinking: chatTable.includeThinking,
          includeToolCalls: chatTable.includeToolCalls,
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
          parameterDescriptionOverrides: workflowMcpTool.parameterDescriptionOverrides,
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
      db
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
        .orderBy(desc(workflowDeploymentVersion.createdAt))
        .limit(1),
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

    const deployedVersion = versionRows[0]
    const isDeployed = Boolean(deployedVersion)
    const deployedAt = deployedVersion?.createdAt ?? null
    const hasAnyDeployment = isDeployed || chatRows.length > 0 || mcpRows.length > 0
    if (!hasAnyDeployment && allVersionRows.length === 0) return null

    const needsRedeployment =
      isDeployed && deployedVersion?.state ? await checkNeedsRedeployment(workflowId) : undefined

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
   * Advertise custom tools in the VFS without eagerly loading their code.
   * Paths are registered as lazy so glob/WORKSPACE.md see them, but full
   * schema+code is fetched only when read (or a grep whose scope touches them).
   */
  private async materializeCustomTools(
    workspaceId: string,
    userId: string
  ): Promise<NonNullable<WorkspaceMdData['customTools']>> {
    try {
      // Metadata only — tool code can be large; keep it out of the eager map.
      // Visibility matches listCustomTools: workspace tools + legacy user-owned.
      const toolRows = await db
        .select({
          id: customToolsTable.id,
          title: customToolsTable.title,
        })
        .from(customToolsTable)
        .where(
          or(
            eq(customToolsTable.workspaceId, workspaceId),
            and(isNull(customToolsTable.workspaceId), eq(customToolsTable.userId, userId))
          )
        )
        .orderBy(desc(customToolsTable.createdAt))

      for (const tool of toolRows) {
        const safeName = sanitizeName(tool.title)
        const toolId = tool.id
        const load = async () => {
          const full = await getCustomToolById({ toolId, userId, workspaceId })
          if (!full) return null
          return serializeCustomTool({
            id: full.id,
            title: full.title,
            schema: full.schema,
            code: full.code,
          })
        }
        // Legacy alias + canonical agent/ path — each resolves independently on read.
        this.registerLazy(`custom-tools/${safeName}.json`, load)
        this.registerLazy(`agent/custom-tools/${safeName}.json`, load)
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
      const blocks = await this.loadCustomBlocks(workspaceId)
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

  /** Load the org's custom blocks once per VFS materialization. Failed loads remain retryable. */
  private async loadCustomBlocks(workspaceId: string): Promise<CustomBlockWithInputs[]> {
    const request = this.customBlocksPromise ?? listCustomBlocksWithInputsForWorkspace(workspaceId)
    this.customBlocksPromise = request
    try {
      return await request
    } catch (error) {
      if (this.customBlocksPromise === request) this.customBlocksPromise = undefined
      throw error
    }
  }

  /**
   * Materialize `account/` — the acting user's vantage: this workspace and
   * their role in it, the workspaces they can reach, who else is here, and
   * their live plan.
   *
   * Read-only and always mounted. `billing.json` is registered lazily because
   * usage ticks between requests: materializing it would freeze the numbers at
   * snapshot time and pay for a billing read on every turn that never asks.
   * Membership reuses the roster already loaded for WORKSPACE.md rather than
   * issuing a second query.
   */
  private async materializeAccount(
    workspaceId: string,
    userId: string,
    hostContext: Awaited<ReturnType<typeof getWorkspaceHostContextForViewer>>,
    members: Awaited<ReturnType<typeof getUsersWithPermissions>>
  ): Promise<void> {
    try {
      const [rows, entitlements] = await Promise.all([
        listAccessibleWorkspaceRowsForUser(userId).catch(() => []),
        computeWorkspaceEntitlements(workspaceId, userId).catch(() => [] as string[]),
      ])

      const current = rows.find((row) => row.workspace.id === workspaceId)
      const parentId = current?.workspace.forkedFromWorkspaceId ?? null
      // Name the parent only when the viewer can reach it; otherwise the id
      // stands alone rather than leaking a workspace name they cannot open.
      const parentRow = parentId ? rows.find((row) => row.workspace.id === parentId) : undefined
      const isAdmin = hostContext?.viewer.permission === 'admin'

      this.files.set(
        'account/workspace.json',
        serializeAccountWorkspace({
          workspace: {
            id: workspaceId,
            name: hostContext?.workspace.name ?? current?.workspace.name ?? '',
            workspaceMode: hostContext?.workspace.workspaceMode ?? null,
          },
          viewer: {
            permission: hostContext?.viewer.permission ?? current?.permissionType ?? null,
            organizationRole: hostContext?.viewer.organizationRole ?? null,
          },
          organization: hostContext?.hostOrganizationId
            ? { id: hostContext.hostOrganizationId }
            : null,
          forkedFrom: parentId
            ? { id: parentId, name: parentRow?.workspace.name ?? parentId }
            : null,
          entitlements,
        })
      )

      this.files.set(
        'account/workspaces.json',
        serializeAccountWorkspaces(
          rows.map((row) => ({
            id: row.workspace.id,
            name: row.workspace.name,
            role: row.permissionType,
            organizationId: row.workspace.organizationId,
            forkedFromWorkspaceId: row.workspace.forkedFromWorkspaceId,
            isCurrent: row.workspace.id === workspaceId,
          }))
        )
      )

      this.files.set(
        'account/members.json',
        serializeAccountMembers(members, { includeContactDetails: isAdmin })
      )

      this.registerLazy('account/billing.json', async () => {
        try {
          return serializeAccountBilling(await getAccountBillingSnapshot(userId))
        } catch (err) {
          logger.warn('Failed to load account billing', {
            workspaceId,
            error: toError(err).message,
          })
          return null
        }
      })
    } catch (err) {
      logger.warn('Failed to materialize account namespace', {
        workspaceId,
        error: toError(err).message,
      })
    }
  }

  private materializeConnectedAccounts(
    hostContext: Pick<
      NonNullable<Awaited<ReturnType<typeof getWorkspaceHostContextForViewer>>>,
      'features' | 'viewer'
    >
  ): boolean {
    const loadConnectedAccounts = this.loadConnectedAccounts
    if (
      hostContext.features?.credentialGroups !== true ||
      hostContext.viewer.permission !== 'admin' ||
      !loadConnectedAccounts
    ) {
      return false
    }
    this.registerLazy('organization/connected-accounts.json', async () => {
      try {
        const accounts = await loadConnectedAccounts()
        return accounts ? serializeConnectedAccounts(accounts) : null
      } catch (err) {
        logger.warn('Failed to load connected accounts', {
          workspaceId: this._workspaceId,
          error: toError(err).message,
        })
        return null
      }
    })
    return true
  }

  /**
   * Materialize `organization/` — org standing, the access-control rules that
   * actually bind this viewer, org-published block provenance, and fork
   * topology.
   *
   * The namespace exists only when the workspace belongs to an organization, so
   * its absence is itself the answer for a personal workspace. Fork detail is
   * mounted only for a workspace admin of a forking-enabled org, matching the
   * gate the fork routes apply.
   */
  private async materializeOrganization(
    workspaceId: string,
    userId: string,
    hostContext: Awaited<ReturnType<typeof getWorkspaceHostContextForViewer>>
  ): Promise<void> {
    const organizationId = hostContext?.hostOrganizationId
    if (!hostContext || !organizationId) return

    try {
      this.files.set(
        'organization/organization.json',
        serializeOrganization({
          organization: {
            id: organizationId,
            relationship: hostContext.viewer.isHostOrganizationMember ? 'internal' : 'external',
            role: hostContext.viewer.organizationRole ?? null,
          },
          capabilities: {
            canManageOrganization: hostContext.viewer.isHostOrganizationAdmin,
            canManageBilling: hostContext.viewer.isHostOrganizationAdmin,
          },
          plan: hostContext.ownerBilling.plan,
          isEnterprise: hostContext.ownerBilling.isEnterprise,
        })
      )

      this.registerLazy('organization/access-control.json', async () => {
        try {
          const accessControl = await resolveVerifiedUserAccessControlContext(
            userId,
            workspaceId,
            organizationId
          )
          return serializeAccessControl({
            entitled: accessControl.entitled,
            permissionGroup: accessControl.permissionGroup,
            restrictions: getActivePermissionGroupRestrictions(accessControl.config),
          })
        } catch (err) {
          logger.warn('Failed to load access control context', {
            workspaceId,
            error: toError(err).message,
          })
          return null
        }
      })

      // The block list is fetched at materialize time (one indexed query, the
      // same one the components pass already ran) because the README and the
      // names-only index need it, and each block's detail path must exist in
      // the key view for glob to list. Only the deployed graph stays lazy —
      // it is the expensive part and most turns never read it.
      const orgBlocks = await this.loadCustomBlocks(workspaceId).catch((err) => {
        logger.warn('Failed to list org custom blocks', {
          workspaceId,
          error: toError(err).message,
        })
        return []
      })
      if (orgBlocks.length > 0) {
        this.files.set(
          'organization/custom-blocks.json',
          serializeOrganizationCustomBlocks(orgBlocks)
        )
        // The names index matches editor visibility: anyone who can open the
        // workspace sees the block in the toolbar. The deployed GRAPH is org
        // implementation internals, so an external collaborator — workspace
        // access without org membership — gets the interface (components/
        // schema) but not the graph; for them the detail files simply do not
        // exist.
        if (hostContext.viewer.isHostOrganizationMember)
          for (const orgBlock of orgBlocks) {
            this.registerLazy(`organization/custom-blocks/${orgBlock.type}.json`, async () => {
              try {
                const deployed = await loadDeployedWorkflowState(
                  orgBlock.workflowId,
                  orgBlock.workspaceId ?? undefined
                )
                return serializeOrgCustomBlockDetail(orgBlock, deployed)
              } catch (err) {
                logger.warn('Failed to load deployed state for org custom block', {
                  workspaceId,
                  blockType: orgBlock.type,
                  error: toError(err).message,
                })
                return null
              }
            })
          }
      }

      // Everything below is registered LAZILY: the paths appear in the key
      // view (so glob lists them) but no query runs until something reads
      // one. Registration itself is the permission gate — an unpermitted
      // viewer's file simply does not exist.
      if (hostContext.viewer.isHostOrganizationMember) {
        this.registerLazy('organization/workspaces.json', async () => {
          try {
            const [refs, accessible] = await Promise.all([
              listOrganizationWorkspaceRefs(organizationId),
              listAccessibleWorkspaceRowsForUser(userId).catch(() => []),
            ])
            const accessibleIds = new Set(accessible.map((row) => row.workspace.id))
            const forkParents = new Map(
              accessible.map((row) => [row.workspace.id, row.workspace.forkedFromWorkspaceId])
            )
            return serializeOrganizationWorkspaces(
              refs.map((ref) => ({
                id: ref.id,
                name: ref.name,
                hasAccess: accessibleIds.has(ref.id),
                forkedFromWorkspaceId: forkParents.get(ref.id) ?? null,
              }))
            )
          } catch (err) {
            logger.warn('Failed to load org workspaces', {
              workspaceId,
              error: toError(err).message,
            })
            return null
          }
        })
      }

      if (hostContext.viewer.isHostOrganizationAdmin) {
        this.registerLazy('organization/permission-groups.json', async () => {
          try {
            const roster = await listPermissionGroupRoster(organizationId)
            if (roster.length === 0) return null
            return serializePermissionGroupRoster(roster)
          } catch (err) {
            logger.warn('Failed to load permission-group roster', {
              workspaceId,
              error: toError(err).message,
            })
            return null
          }
        })
      }

      const connectedAccountsAvailable = this.materializeConnectedAccounts(hostContext)

      const forksAvailable =
        hostContext.viewer.permission === 'admin' &&
        (await isForkingAvailableForWorkspace(organizationId, userId).catch(() => false))

      this.files.set(
        'organization/README.md',
        buildOrganizationReadme({
          organizationId,
          isEnterprise: hostContext.ownerBilling.isEnterprise,
          customBlocks: orgBlocks,
          forksMounted: forksAvailable,
          permissionGroupsMounted: hostContext.viewer.isHostOrganizationAdmin,
          connectedAccountsMounted: connectedAccountsAvailable,
        })
      )

      if (!forksAvailable) return

      this.registerLazy('organization/forks.json', async () => {
        try {
          const [parent, children] = await Promise.all([
            getForkParent(workspaceId),
            getForkChildren(workspaceId),
          ])
          if (!parent && children.length === 0) return null

          const resourceMappingCounts: Record<string, number> = {}
          let blockMappingCount = 0
          if (parent) {
            const [resourceRows, blockMap] = await Promise.all([
              getEdgeMappingRows(db, workspaceId),
              loadForkBlockMap(db, workspaceId),
            ])
            for (const row of resourceRows) {
              resourceMappingCounts[row.resourceType] =
                (resourceMappingCounts[row.resourceType] ?? 0) + 1
            }
            blockMappingCount = blockMap.parentToChild.size
          }

          return serializeWorkspaceForks({
            parent: parent ? { id: parent.id, name: parent.name } : null,
            children: children.map((child) => ({
              id: child.id,
              name: child.name,
              createdAt: child.createdAt,
            })),
            resourceMappingCounts,
            blockMappingCount,
          })
        } catch (err) {
          logger.warn('Failed to load fork topology', {
            workspaceId,
            error: toError(err).message,
          })
          return null
        }
      })
    } catch (err) {
      logger.warn('Failed to materialize organization namespace', {
        workspaceId,
        error: toError(err).message,
      })
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
   * Advertise the workspace skills in the VFS without eagerly loading their
   * bodies. Paths are registered as lazy so glob/WORKSPACE.md see them, but
   * full content is fetched only when read (or a grep whose scope touches the
   * path) resolves them. Skills are workspace-visible — everyone with
   * workspace access sees and uses every skill.
   */
  private async materializeSkills(
    workspaceId: string
  ): Promise<NonNullable<WorkspaceMdData['skills']>> {
    try {
      // Metadata only — skill bodies can be large; keep them out of the eager map.
      const skillRows = await db
        .select({
          id: skillTable.id,
          name: skillTable.name,
          description: skillTable.description,
        })
        .from(skillTable)
        .where(eq(skillTable.workspaceId, workspaceId))
        .orderBy(desc(skillTable.createdAt))

      for (const s of skillRows) {
        const safeName = sanitizeName(s.name)
        const skillId = s.id
        this.registerLazy(`agent/skills/${safeName}.json`, async () => {
          const full = await getSkillById({ skillId, workspaceId })
          if (!full) return null
          return serializeSkill({
            id: full.id,
            name: full.name,
            description: full.description,
            content: full.content,
            createdAt: full.createdAt,
          })
        })
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
   * Project the shared sandbox domain objects into discoverable VFS resources.
   * Entitlement is checked by the caller before this method runs.
   */
  private async materializeSandboxes(
    workspaceId: string
  ): Promise<NonNullable<WorkspaceMdData['sandboxes']>> {
    try {
      const sandboxes = await listWorkspaceSandboxes(workspaceId)
      const strategy = currentSandboxStrategy()
      this.files.set('agent/sandboxes/README.md', serializeSandboxCatalog(strategy))
      for (const sandbox of sandboxes) {
        this.files.set(
          `agent/sandboxes/${sanitizeName(sandbox.name)}.json`,
          serializeSandbox(sandbox, strategy)
        )
      }
      return sandboxes.map((sandbox) => ({
        id: sandbox.id,
        name: sandbox.name,
        language: sandbox.language,
        dependencies: sandbox.dependencies,
        systemPackages: sandbox.systemPackages,
        cliTools: sandbox.cliTools,
      }))
    } catch (err) {
      logger.warn('Failed to materialize Sim sandboxes', {
        workspaceId,
        error: toError(err).message,
      })
      return []
    }
  }
  private async materializeRecentlyDeleted(workspaceId: string): Promise<void> {
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
            id: folderTable.id,
            name: folderTable.name,
            archivedAt: folderTable.deletedAt,
          })
          .from(folderTable)
          .where(
            and(
              eq(folderTable.workspaceId, workspaceId),
              eq(folderTable.resourceType, 'workflow'),
              isNotNull(folderTable.deletedAt)
            )
          ),
        listTables(workspaceId, { scope: 'archived' }),
        listAllWorkspaceFiles
          .execute({
            principal: this.requireFilePrincipal(),
            input: { workspaceId, scope: 'archived' },
          })
          .then(({ files }) => files),
        listWorkspaceFileFoldersOperation
          .execute({
            principal: this.requireFilePrincipal(),
            input: { workspaceId, scope: 'archived' },
          })
          .then(({ folders }) => folders),
        listKnowledgeBases
          .execute({
            principal: this.requireKnowledgePrincipal(),
            input: { workspaceId, scope: 'archived' },
          })
          .then(({ knowledgeBases }) => knowledgeBases.map((entry) => entry.knowledgeBase)),
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
        const safePath = parseWorkspaceFileFolderDisplayPath(folder.path)
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
            updatedAt: file.updatedAt,
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
    userId: string,
    permissionConfigPromise: ReturnType<typeof resolvePermissionGroupConfig>,
    blockVisibility: BlockVisibilityState | null,
    secretMountPolicy?: SecretMountPolicy
  ): Promise<{
    oauthIntegrations: WorkspaceMdData['oauthIntegrations']
    envVariables: WorkspaceMdData['envVariables']
  }> {
    try {
      const isWorkspaceAdmin = await hasWorkspaceAdminAccess(userId, workspaceId)
      const [envCredentials, oauthCredentials, apiKeyRows, envData, permissionConfig] =
        await Promise.all([
          getAccessibleEnvCredentials(workspaceId, userId, { isWorkspaceAdmin }),
          getAccessibleOAuthCredentials(workspaceId, userId, { isWorkspaceAdmin }).then(
            async (accessible) => [
              ...accessible,
              ...(await getEnrolledManagedOAuthCredentials(workspaceId, userId)),
            ]
          ),
          listApiKeys(workspaceId),
          getPersonalAndWorkspaceEnv(userId, workspaceId),
          permissionConfigPromise,
        ])
      const credentialVisibility = createIntegrationCredentialVisibility({
        allowedIntegrationTypes: toAccessControlAllowlist(
          intersectIntegrationAllowlists(
            permissionConfig?.allowedIntegrations ?? null,
            getAllowedIntegrationsFromEnv()
          )
        ),
        blockVisibility,
      })
      const visibleOAuthCredentials = oauthCredentials.filter((credential) =>
        credentialVisibility.isCredentialVisible({
          providerId: credential.providerId,
          type: credential.type,
        })
      )
      const visibleEnvCredentialNames = new Set(
        filterSecretNamesByMountPolicy(
          envCredentials.map((credential) => credential.envKey),
          secretMountPolicy
        )
      )
      const visibleEnvCredentials = envCredentials.filter((credential) =>
        visibleEnvCredentialNames.has(credential.envKey)
      )

      this.files.set(
        'environment/credentials.json',
        serializeCredentials([
          ...visibleEnvCredentials.map((c) => ({
            providerId: c.envKey,
            description: c.description,
            scope: c.type === 'env_workspace' ? 'workspace' : 'personal',
            createdAt: c.updatedAt,
          })),
          ...visibleOAuthCredentials.map((c) => ({
            id: c.id,
            providerId: c.providerId,
            displayName: c.displayName,
            role: c.role,
            scope: null,
            credentialType: c.type,
            createdAt: c.updatedAt,
          })),
        ])
      )

      this.files.set('environment/api-keys.json', serializeApiKeys(apiKeyRows))

      const personalVarNames = filterSecretNamesByMountPolicy(
        Object.keys(envData.personalEncrypted),
        secretMountPolicy
      )
      const workspaceVarNames = filterSecretNamesByMountPolicy(
        Object.keys(envData.workspaceEncrypted),
        secretMountPolicy
      )
      /** Intersected with the policy-filtered names, so the mount policy applies here too. */
      const workspaceVarNameSet = new Set(workspaceVarNames)
      const unredactedWorkspaceVarNames = envData.workspaceUnredactedKeys.filter((name) =>
        workspaceVarNameSet.has(name)
      )
      this.files.set(
        'environment/variables.json',
        serializeEnvironmentVariables(
          personalVarNames,
          workspaceVarNames,
          unredactedWorkspaceVarNames
        )
      )

      const envKeys = [...visibleEnvCredentialNames]
      return {
        oauthIntegrations: visibleOAuthCredentials.map((c) => ({
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
  userId: string,
  options?: {
    secretMountPolicy?: SecretMountPolicy
    filePrincipal?: Principal
    knowledgePrincipal?: Principal
    loadConnectedAccounts?: () => Promise<CredentialGroupRecord | null>
  }
): Promise<WorkspaceVFS> {
  await assertActiveWorkspaceAccess(workspaceId, userId)
  const vfs = new WorkspaceVFS(
    options?.filePrincipal,
    options?.knowledgePrincipal,
    options?.loadConnectedAccounts
  )
  await vfs.materialize(workspaceId, userId, options)
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

function decodeVfsPathSegmentsSafe(path: string): string {
  return path
    .split('/')
    .map((segment) => decodeVfsSegmentSafe(segment))
    .join('/')
}
