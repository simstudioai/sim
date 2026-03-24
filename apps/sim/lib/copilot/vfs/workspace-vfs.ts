import { db } from '@sim/db'
import {
  a2aAgent,
  chat as chatTable,
  copilotChats,
  document,
  form,
  jobExecutionLogs,
  knowledgeConnector,
  mcpServers as mcpServersTable,
  workflowDeploymentVersion,
  workflowExecutionLogs,
  workflowMcpServer,
  workflowMcpTool,
  workflowSchedule,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull, ne } from 'drizzle-orm'
import { listApiKeys } from '@/lib/api-key/service'
import { type FileReadResult, readFileRecord } from '@/lib/copilot/vfs/file-reader'
import { normalizeVfsSegment } from '@/lib/copilot/vfs/normalize-segment'
import type { DirEntry, GrepMatch, GrepOptions, ReadResult } from '@/lib/copilot/vfs/operations'
import * as ops from '@/lib/copilot/vfs/operations'
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
import { buildWorkspaceMd, type WorkspaceMdData } from '@/lib/copilot/workspace-context'
import {
  getAccessibleEnvCredentials,
  getAccessibleOAuthCredentials,
} from '@/lib/credentials/environment'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { getKnowledgeBases } from '@/lib/knowledge/service'
import { listTables } from '@/lib/table/service'
import {
  findWorkspaceFileRecord,
  listWorkspaceFiles,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { hasWorkflowChanged } from '@/lib/workflows/comparison'
import { listCustomTools } from '@/lib/workflows/custom-tools/operations'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'
import { listSkills } from '@/lib/workflows/skills/operations'
import { listWorkflows } from '@/lib/workflows/utils'
import {
  assertActiveWorkspaceAccess,
  getUsersWithPermissions,
  getWorkspaceWithOwner,
} from '@/lib/workspaces/permissions/utils'
import { getAllBlocks } from '@/blocks/registry'
import { CONNECTOR_REGISTRY } from '@/connectors/registry'
import { tools as toolRegistry } from '@/tools/registry'
import { getLatestVersionTools, stripVersionSuffix } from '@/tools/utils'
import { TRIGGER_REGISTRY } from '@/triggers/registry'

const logger = createLogger('WorkspaceVFS')

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

  const files = new Map<string, string>()

  const allBlocks = getAllBlocks()
  const visibleBlocks = allBlocks.filter((b) => !b.hideFromToolbar)

  let blocksFiltered = 0
  for (const block of visibleBlocks) {
    const path = `components/blocks/${block.type}.json`
    files.set(path, serializeBlockSchema(block))
  }
  blocksFiltered = allBlocks.length - visibleBlocks.length

  const toolToService = new Map<string, string>()
  for (const block of visibleBlocks) {
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

    const prefix = `${service}_`
    const operation = baseName.startsWith(prefix) ? baseName.slice(prefix.length) : baseName

    const path = `components/integrations/${service}/${operation}.json`
    files.set(path, serializeIntegrationSchema(tool))
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
        sourceHandles: ['loop-start-source', 'source'],
        notes:
          'Use "loop-start-source" to connect to blocks inside the loop. Use "source" for the edge that runs after the loop completes. Blocks inside the loop must have parentId set to the loop block ID.',
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
        sourceHandles: ['parallel-start-source', 'source'],
        notes:
          'Use "parallel-start-source" to connect to blocks inside the parallel container. Use "source" for the edge after all branches complete. Blocks inside must have parentId set to the parallel block ID.',
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

  let externalTriggerCount = 0
  for (const [triggerId, trigger] of Object.entries(TRIGGER_REGISTRY)) {
    const path = `components/triggers/${trigger.provider}/${triggerId}.json`
    files.set(path, serializeTriggerSchema(trigger))
    externalTriggerCount++
  }

  files.set(
    'components/triggers/triggers.md',
    serializeTriggerOverview(
      builtinTriggerBlocks.map((b) => ({
        id: b.type,
        name: b.name,
        provider: 'sim',
        description: b.description,
      })),
      Object.entries(TRIGGER_REGISTRY).map(([id, t]) => ({
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
 *   WORKSPACE.md                         — workspace identity, members, inventory (auto-generated)
 *   workflows/{name}/meta.json
 *   workflows/{name}/state.json          (sanitized blocks with embedded connections)
 *   workflows/{name}/executions.json
 *   workflows/{name}/deployment.json
 *   knowledgebases/{name}/meta.json
 *   knowledgebases/{name}/documents.json
 *   knowledgebases/{name}/connectors.json
 *   tables/{name}/meta.json
 *   files/{name}/meta.json
 *   files/by-id/{id}/meta.json
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
  private files: Map<string, string> = new Map()
  private _workspaceId = ''

  get workspaceId(): string {
    return this._workspaceId
  }

  /**
   * Materialize workspace data into the VFS.
   * Uses shared service functions for all data access, then generates
   * WORKSPACE.md from the summaries returned by each materializer.
   */
  async materialize(workspaceId: string, userId: string): Promise<void> {
    const start = Date.now()
    this.files = new Map()
    this._workspaceId = workspaceId

    const [
      wfSummary,
      kbSummary,
      tblSummary,
      fileSummary,
      envSummary,
      toolsSummary,
      mcpServersSummary,
      skillsSummary,
      taskSummary,
      jobsSummary,
      wsRow,
      members,
    ] = await Promise.all([
      this.materializeWorkflows(workspaceId, userId),
      this.materializeKnowledgeBases(workspaceId, userId),
      this.materializeTables(workspaceId),
      this.materializeFiles(workspaceId),
      this.materializeEnvironment(workspaceId, userId),
      this.materializeCustomTools(workspaceId, userId),
      this.materializeMcpServers(workspaceId),
      this.materializeSkills(workspaceId),
      this.materializeTasks(workspaceId, userId),
      this.materializeJobs(workspaceId),
      getWorkspaceWithOwner(workspaceId),
      getUsersWithPermissions(workspaceId),
    ])

    this.files.set(
      'WORKSPACE.md',
      buildWorkspaceMd({
        workspace: wsRow,
        members,
        workflows: wfSummary,
        knowledgeBases: kbSummary,
        tables: tblSummary,
        files: fileSummary,
        credentials: envSummary,
        tasks: taskSummary,
        customTools: toolsSummary,
        mcpServers: mcpServersSummary,
        skills: skillsSummary,
        jobs: jobsSummary,
      })
    )

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

  suggestSimilar(missingPath: string, max?: number): string[] {
    return ops.suggestSimilar(this.files, missingPath, max)
  }

  /**
   * Attempt to read dynamic workspace file content from storage.
   * Handles images (base64), parseable documents (PDF, etc.), and text files.
   * Returns null if the path doesn't match `files/{name}` / `files/by-id/{id}` or the file isn't found.
   */
  async readFileContent(path: string): Promise<FileReadResult | null> {
    const match = path.match(/^files\/(.+?)(?:\/content)?$/)
    if (!match) return null
    const fileName = match[1]

    if (fileName.endsWith('/meta.json') || path.endsWith('/meta.json')) return null

    try {
      const files = await listWorkspaceFiles(this._workspaceId)
      const record = findWorkspaceFileRecord(files, fileName)
      if (!record) return null
      return readFileRecord(record)
    } catch (err) {
      logger.warn('Failed to list workspace files for readFileContent', {
        workspaceId: this._workspaceId,
        path,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  /**
   * Materialize all workflows using the shared listWorkflows function.
   * Returns a summary for WORKSPACE.md generation.
   */
  private async materializeWorkflows(
    workspaceId: string,
    _userId: string
  ): Promise<WorkspaceMdData['workflows']> {
    const workflowRows = await listWorkflows(workspaceId)

    await Promise.all(
      workflowRows.map(async (wf) => {
        const safeName = sanitizeName(wf.name)
        const prefix = `workflows/${safeName}/`

        this.files.set(`${prefix}meta.json`, serializeWorkflowMeta(wf))

        let normalized: Awaited<ReturnType<typeof loadWorkflowFromNormalizedTables>> = null
        try {
          normalized = await loadWorkflowFromNormalizedTables(wf.id)
          if (normalized) {
            const sanitized = sanitizeForCopilot({
              blocks: normalized.blocks,
              edges: normalized.edges,
              loops: normalized.loops,
              parallels: normalized.parallels,
            } as any)
            this.files.set(`${prefix}state.json`, JSON.stringify(sanitized, null, 2))
          }
        } catch (err) {
          logger.warn('Failed to load workflow state', {
            workflowId: wf.id,
            error: err instanceof Error ? err.message : String(err),
          })
        }

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

        try {
          const deploymentData = await this.getWorkflowDeployments(
            wf.id,
            workspaceId,
            wf.isDeployed,
            wf.deployedAt,
            normalized
          )
          if (deploymentData) {
            this.files.set(`${prefix}deployment.json`, serializeDeployments(deploymentData))
            if (deploymentData.versions && deploymentData.versions.length > 0) {
              this.files.set(`${prefix}versions.json`, serializeVersions(deploymentData.versions))
            }
          }
        } catch (err) {
          logger.warn('Failed to load deployment data', {
            workflowId: wf.id,
            error: err instanceof Error ? err.message : String(err),
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

        try {
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

          if (docRows.length > 0) {
            this.files.set(`${prefix}documents.json`, serializeDocuments(docRows))
          }
        } catch (err) {
          logger.warn('Failed to load KB documents', {
            knowledgeBaseId: kb.id,
            error: err instanceof Error ? err.message : String(err),
          })
        }

        try {
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

          if (connectorRows.length > 0) {
            this.files.set(`${prefix}connectors.json`, serializeConnectors(connectorRows))
          }
        } catch (err) {
          logger.warn('Failed to load KB connectors', {
            knowledgeBaseId: kb.id,
            error: err instanceof Error ? err.message : String(err),
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
        error: err instanceof Error ? err.message : String(err),
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
      const files = await listWorkspaceFiles(workspaceId)

      for (const file of files) {
        const safeName = sanitizeName(file.name)
        this.files.set(
          `files/${safeName}/meta.json`,
          serializeFileMeta({
            id: file.id,
            name: file.name,
            contentType: file.type,
            size: file.size,
            uploadedAt: file.uploadedAt,
          })
        )
        this.files.set(
          `files/by-id/${file.id}/meta.json`,
          serializeFileMeta({
            id: file.id,
            name: file.name,
            contentType: file.type,
            size: file.size,
            uploadedAt: file.uploadedAt,
          })
        )
      }

      return files.map((f) => ({ name: f.name, type: f.type, size: f.size }))
    } catch (err) {
      logger.warn('Failed to materialize files', {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
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
    deployedAt: Date | null,
    currentNormalized?: Awaited<ReturnType<typeof loadWorkflowFromNormalizedTables>>
  ): Promise<DeploymentData | null> {
    const [chatRows, formRows, mcpRows, a2aRows, versionRows, allVersionRows] = await Promise.all([
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
        .where(eq(chatTable.workflowId, workflowId)),
      db
        .select({
          id: form.id,
          identifier: form.identifier,
          title: form.title,
          description: form.description,
          authType: form.authType,
          showBranding: form.showBranding,
          customizations: form.customizations,
          isActive: form.isActive,
        })
        .from(form)
        .where(eq(form.workflowId, workflowId)),
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
        .where(eq(workflowMcpTool.workflowId, workflowId)),
      db
        .select({
          id: a2aAgent.id,
          name: a2aAgent.name,
          description: a2aAgent.description,
          version: a2aAgent.version,
          isPublished: a2aAgent.isPublished,
          capabilities: a2aAgent.capabilities,
        })
        .from(a2aAgent)
        .where(and(eq(a2aAgent.workflowId, workflowId), eq(a2aAgent.workspaceId, workspaceId))),
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

    const hasAnyDeployment =
      isDeployed ||
      chatRows.length > 0 ||
      formRows.length > 0 ||
      mcpRows.length > 0 ||
      a2aRows.length > 0
    if (!hasAnyDeployment && allVersionRows.length === 0) return null

    let needsRedeployment: boolean | undefined
    const deployedVersion = versionRows[0]
    if (isDeployed && deployedVersion?.state && currentNormalized) {
      try {
        const currentState = {
          blocks: currentNormalized.blocks,
          edges: currentNormalized.edges,
          loops: currentNormalized.loops,
          parallels: currentNormalized.parallels,
        }
        needsRedeployment = hasWorkflowChanged(currentState as any, deployedVersion.state as any)
      } catch (err) {
        logger.warn('Failed to compute needsRedeployment', {
          workflowId,
          error: err instanceof Error ? err.message : String(err),
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
      form: formRows[0] ?? null,
      mcp: mcpRows,
      a2a: a2aRows[0] ?? null,
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
        error: err instanceof Error ? err.message : String(err),
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
        error: err instanceof Error ? err.message : String(err),
      })
      return []
    }
  }

  /**
   * Materialize workspace skills using the shared listSkills function.
   */
  private async materializeSkills(
    workspaceId: string
  ): Promise<NonNullable<WorkspaceMdData['skills']>> {
    try {
      const skillRows = await listSkills({ workspaceId })

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
        error: err instanceof Error ? err.message : String(err),
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
          messages: copilotChats.messages,
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

        this.files.set(
          `${prefix}session.md`,
          serializeTaskSession({
            id: task.id,
            title,
            messageCount: messages.length,
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
        error: err instanceof Error ? err.message : String(err),
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

        try {
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

          if (execRows.length > 0) {
            this.files.set(`jobs/${safeName}/executions.json`, serializeRecentExecutions(execRows))
          }
        } catch (err) {
          logger.warn('Failed to load job execution logs', {
            jobId: job.id,
            error: err instanceof Error ? err.message : String(err),
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
        error: err instanceof Error ? err.message : String(err),
      })
      return []
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
  ): Promise<WorkspaceMdData['credentials']> {
    try {
      const [envCredentials, oauthCredentials, apiKeyRows, envData] = await Promise.all([
        getAccessibleEnvCredentials(workspaceId, userId),
        getAccessibleOAuthCredentials(workspaceId, userId),
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

      const envKeys = envCredentials.map((c) => c.envKey)
      const oauthProviders = oauthCredentials.map((c) => c.providerId)
      const allProviders = [...new Set([...oauthProviders, ...envKeys])]
      return allProviders.map((key) => ({ providerId: key }))
    } catch (err) {
      logger.warn('Failed to materialize environment data', {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      })
      return []
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
