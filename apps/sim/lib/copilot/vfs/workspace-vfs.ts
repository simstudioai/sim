import { db } from '@sim/db'
import {
  account,
  apiKey,
  document,
  environment,
  knowledgeBase,
  workflow,
  workspaceEnvironment,
  workflowExecutionLogs,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { getAllBlocks } from '@/blocks/registry'
import { getLatestVersionTools, stripVersionSuffix } from '@/tools/utils'
import { tools as toolRegistry } from '@/tools/registry'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'
import type { GrepMatch, GrepOptions, ReadResult, DirEntry } from '@/lib/copilot/vfs/operations'
import * as ops from '@/lib/copilot/vfs/operations'
import {
  serializeApiKeys,
  serializeBlockSchema,
  serializeCredentials,
  serializeDocuments,
  serializeEnvironmentVariables,
  serializeIntegrationSchema,
  serializeKBMeta,
  serializeRecentExecutions,
  serializeWorkflowMeta,
} from '@/lib/copilot/vfs/serializers'

const logger = createLogger('WorkspaceVFS')

/** Cache entry for a materialized VFS */
interface VFSCacheEntry {
  vfs: WorkspaceVFS
  expiresAt: number
}

/** Module-level VFS cache keyed by workspaceId */
const vfsCache = new Map<string, VFSCacheEntry>()

/** Cache TTL in milliseconds (30 seconds) */
const VFS_CACHE_TTL_MS = 30_000

/** Static component files, computed once and shared across all VFS instances */
let staticComponentFiles: Map<string, string> | null = null

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
  staticComponentFiles = new Map()

  const allBlocks = getAllBlocks()
  for (const block of allBlocks) {
    const path = `components/blocks/${block.type}.json`
    staticComponentFiles.set(path, serializeBlockSchema(block))
  }

  // Build a reverse index: tool ID → service name from block registry.
  // The block type (stripped of version suffix) is used as the service directory.
  const toolToService = new Map<string, string>()
  for (const block of allBlocks) {
    if (!block.tools?.access) continue
    const service = stripVersionSuffix(block.type)
    for (const toolId of block.tools.access) {
      toolToService.set(toolId, service)
    }
  }

  const latestTools = getLatestVersionTools(toolRegistry)
  let integrationCount = 0
  for (const [toolId, tool] of Object.entries(latestTools)) {
    const baseName = stripVersionSuffix(toolId)
    const service = toolToService.get(toolId) ?? toolToService.get(baseName)
    if (!service) {
      logger.debug('Tool not associated with any block, skipping VFS entry', { toolId })
      continue
    }

    // Derive operation name by stripping the service prefix
    const prefix = `${service}_`
    const operation = baseName.startsWith(prefix)
      ? baseName.slice(prefix.length)
      : baseName

    const path = `components/integrations/${service}/${operation}.json`
    staticComponentFiles.set(path, serializeIntegrationSchema(tool))
    integrationCount++
  }

  logger.info('Static component files built', {
    blocks: allBlocks.length,
    integrations: integrationCount,
  })

  return staticComponentFiles
}

/**
 * Virtual Filesystem that materializes workspace data into an in-memory Map.
 *
 * Structure:
 *   workflows/{name}/meta.json
 *   workflows/{name}/blocks.json
 *   workflows/{name}/edges.json
 *   workflows/{name}/executions.json
 *   knowledgebases/{name}/meta.json
 *   knowledgebases/{name}/documents.json
 *   environment/credentials.json
 *   environment/api-keys.json
 *   environment/variables.json
 *   components/blocks/{type}.json
 *   components/integrations/{service}/{operation}.json
 */
export class WorkspaceVFS {
  private files: Map<string, string> = new Map()

  /**
   * Materialize workspace data from DB into the VFS.
   * Queries workflows, knowledge bases, and merges static component schemas.
   */
  async materialize(workspaceId: string, userId: string): Promise<void> {
    const start = Date.now()
    this.files = new Map()

    await Promise.all([
      this.materializeWorkflows(workspaceId, userId),
      this.materializeKnowledgeBases(workspaceId),
      this.materializeEnvironment(workspaceId, userId),
    ])

    // Merge static component files
    for (const [path, content] of getStaticComponentFiles()) {
      this.files.set(path, content)
    }

    logger.info('VFS materialized', {
      workspaceId,
      fileCount: this.files.size,
      durationMs: Date.now() - start,
    })
  }

  grep(
    pattern: string,
    path?: string,
    options?: GrepOptions
  ): GrepMatch[] | string[] | ops.GrepCountEntry[] {
    return ops.grep(this.files, pattern, path, options)
  }

  glob(pattern: string): string[] {
    return ops.glob(this.files, pattern)
  }

  read(path: string, offset?: number, limit?: number): ReadResult | null {
    return ops.read(this.files, path, offset, limit)
  }

  list(path: string): DirEntry[] {
    return ops.list(this.files, path)
  }

  /**
   * Materialize all workflows in the workspace.
   */
  private async materializeWorkflows(workspaceId: string, userId: string): Promise<void> {
    const workflowRows = await db
      .select({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        isDeployed: workflow.isDeployed,
        deployedAt: workflow.deployedAt,
        runCount: workflow.runCount,
        lastRunAt: workflow.lastRunAt,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
      })
      .from(workflow)
      .where(eq(workflow.workspaceId, workspaceId))

    // Load normalized data + executions in parallel for all workflows
    await Promise.all(
      workflowRows.map(async (wf) => {
        const safeName = sanitizeName(wf.name)
        const prefix = `workflows/${safeName}/`

        // Meta
        this.files.set(`${prefix}meta.json`, serializeWorkflowMeta(wf))

        // Blocks + edges from normalized tables
        try {
          const normalized = await loadWorkflowFromNormalizedTables(wf.id)
          if (normalized) {
            const sanitized = sanitizeForCopilot({
              blocks: normalized.blocks,
              edges: normalized.edges,
              loops: normalized.loops,
              parallels: normalized.parallels,
            } as any)
            this.files.set(`${prefix}blocks.json`, JSON.stringify(sanitized, null, 2))

            // Edges as simple source->target list
            const edges = normalized.edges.map((e) => ({
              source: e.source,
              target: e.target,
              sourceHandle: e.sourceHandle || undefined,
              targetHandle: e.targetHandle || undefined,
            }))
            this.files.set(`${prefix}edges.json`, JSON.stringify(edges, null, 2))
          }
        } catch (err) {
          logger.warn('Failed to load workflow blocks', {
            workflowId: wf.id,
            error: err instanceof Error ? err.message : String(err),
          })
        }

        // Recent executions (last 5)
        try {
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

          if (execRows.length > 0) {
            this.files.set(`${prefix}executions.json`, serializeRecentExecutions(execRows))
          }
        } catch (err) {
          logger.warn('Failed to load execution logs', {
            workflowId: wf.id,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })
    )
  }

  /**
   * Materialize all knowledge bases in the workspace.
   */
  private async materializeKnowledgeBases(workspaceId: string): Promise<void> {
    const kbRows = await db
      .select({
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        description: knowledgeBase.description,
        embeddingModel: knowledgeBase.embeddingModel,
        embeddingDimension: knowledgeBase.embeddingDimension,
        tokenCount: knowledgeBase.tokenCount,
        createdAt: knowledgeBase.createdAt,
        updatedAt: knowledgeBase.updatedAt,
      })
      .from(knowledgeBase)
      .where(and(eq(knowledgeBase.workspaceId, workspaceId), isNull(knowledgeBase.deletedAt)))

    await Promise.all(
      kbRows.map(async (kb) => {
        const safeName = sanitizeName(kb.name)
        const prefix = `knowledgebases/${safeName}/`

        // Get document count
        const [docCountRow] = await db
          .select({ count: count() })
          .from(document)
          .where(and(eq(document.knowledgeBaseId, kb.id), isNull(document.deletedAt)))

        this.files.set(
          `${prefix}meta.json`,
          serializeKBMeta({
            ...kb,
            documentCount: docCountRow?.count ?? 0,
          })
        )

        // Documents metadata
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
          .where(and(eq(document.knowledgeBaseId, kb.id), isNull(document.deletedAt)))

        if (docRows.length > 0) {
          this.files.set(`${prefix}documents.json`, serializeDocuments(docRows))
        }
      })
    )
  }

  /**
   * Materialize environment data: credentials, API keys, env variable names.
   */
  private async materializeEnvironment(workspaceId: string, userId: string): Promise<void> {
    try {
      // OAuth credentials — which integrations are connected (no tokens)
      const oauthRows = await db
        .select({
          providerId: account.providerId,
          scope: account.scope,
          createdAt: account.createdAt,
        })
        .from(account)
        .where(eq(account.userId, userId))

      this.files.set('environment/credentials.json', serializeCredentials(oauthRows))

      // API keys — names and types (no key values)
      const apiKeyRows = await db
        .select({
          id: apiKey.id,
          name: apiKey.name,
          type: apiKey.type,
          lastUsed: apiKey.lastUsed,
          createdAt: apiKey.createdAt,
          expiresAt: apiKey.expiresAt,
        })
        .from(apiKey)
        .where(eq(apiKey.workspaceId, workspaceId))

      this.files.set('environment/api-keys.json', serializeApiKeys(apiKeyRows))

      // Environment variables — names only (no values)
      let personalVarNames: string[] = []
      let workspaceVarNames: string[] = []

      const [personalEnv] = await db
        .select({ variables: environment.variables })
        .from(environment)
        .where(eq(environment.userId, userId))

      if (personalEnv?.variables && typeof personalEnv.variables === 'object') {
        personalVarNames = Object.keys(personalEnv.variables as Record<string, unknown>)
      }

      const [workspaceEnv] = await db
        .select({ variables: workspaceEnvironment.variables })
        .from(workspaceEnvironment)
        .where(eq(workspaceEnvironment.workspaceId, workspaceId))

      if (workspaceEnv?.variables && typeof workspaceEnv.variables === 'object') {
        workspaceVarNames = Object.keys(workspaceEnv.variables as Record<string, unknown>)
      }

      this.files.set(
        'environment/variables.json',
        serializeEnvironmentVariables(personalVarNames, workspaceVarNames)
      )
    } catch (err) {
      logger.warn('Failed to materialize environment data', {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

/**
 * Get or create a cached VFS for a workspace.
 * Re-materializes if the cache is expired.
 */
export async function getOrMaterializeVFS(
  workspaceId: string,
  userId: string
): Promise<WorkspaceVFS> {
  const now = Date.now()
  const cached = vfsCache.get(workspaceId)

  if (cached && cached.expiresAt > now) {
    return cached.vfs
  }

  const vfs = new WorkspaceVFS()
  await vfs.materialize(workspaceId, userId)

  vfsCache.set(workspaceId, {
    vfs,
    expiresAt: now + VFS_CACHE_TTL_MS,
  })

  return vfs
}

/**
 * Sanitize a name for use as a VFS path segment.
 * Converts to lowercase, replaces spaces/special chars with hyphens.
 */
function sanitizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}
