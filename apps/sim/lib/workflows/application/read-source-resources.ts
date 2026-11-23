import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  customTools,
  knowledgeBase,
  mcpServers,
  skill,
  userTableDefinitions,
  workflowBlocks,
  workflow as workflowTable,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { mapWithConcurrency } from '@sim/utils/concurrency'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import type { ResourceKind } from '@sim/workflow-code'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import {
  MAX_MANIFEST_RESOURCES_PER_KIND,
  type SourceResources,
} from '@/lib/api/contracts/v2/source-resources'
import { catalogDelegationPolicy } from '@/lib/catalog/application/authorization'
import {
  capabilityGovernedPrincipalUserId,
  defineAuthorizedWorkspaceUseCase,
  type WorkspaceAuthorizationContext,
  type WorkspaceDelegationPolicy,
} from '@/lib/core/application'
import { discoverMcpServerToolsUseCase } from '@/lib/mcp/application/use-cases'
import type { StaticPermissionGroupCapability } from '@/lib/permission-groups/capabilities'
import { isWorkspaceCapabilityWithheld } from '@/lib/permission-groups/capability-assertions'
import { isColumnType } from '@/lib/table/column-types'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { loadEnvNames, loadVisibleCredentials } from '@/lib/workflows/code/resources'
import { extractInputFieldsFromBlocks } from '@/lib/workflows/input-format'
import { INPUT_DEFINITION_TRIGGER_TYPES } from '@/lib/workflows/triggers/input-definition-triggers'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import { type ResourceIdRef, resolveKeys } from '@/lib/workspaces/resource-keys'

const logger = createLogger('ReadSourceResources')

type ManifestColumn = SourceResources['tables'][number]['columns'][number]
type ManifestWorkflowInputs = SourceResources['workflows'][number]['inputs']

interface ReadSourceResourcesInput {
  workspaceId: string
}

/**
 * Copilot reads the manifest with the source catalog's audience, but only for the workspace its
 * delegation is bound to: the manifest names that workspace's credentials and env variables.
 */
const sourceResourcesDelegationPolicy = {
  audience: catalogDelegationPolicy.audience,
  isWithinScope: (principal, context) => principal.workspaceId === context.workspaceId,
} as const satisfies WorkspaceDelegationPolicy<WorkspaceAuthorizationContext>

/** One more row than the cap, so a full page tells a capped list from an exact one. */
const PAGE = MAX_MANIFEST_RESOURCES_PER_KIND + 1

/** How long the manifest waits on MCP tool listings (mostly served from the tool cache). */
const MCP_TOOLS_TIMEOUT_MS = 5_000
/** MCP servers whose tools the manifest lists at once. */
const MCP_TOOLS_CONCURRENCY = 4

/**
 * The tool names of each MCP server, by id, through the discovery use case the editor's tool
 * picker uses (cache first, never marking a server unhealthy). Best effort: a server that cannot be
 * listed in time, or by this caller (a workspace API key may not discover), is left out, and its
 * tools type as any name.
 */
async function loadMcpToolNames(
  principal: Principal,
  workspaceId: string,
  serverIds: string[]
): Promise<Map<string, string[]>> {
  const names = new Map<string, string[]>()
  if (serverIds.length === 0 || principal.kind === 'workspace_api_key') return names
  const signal = AbortSignal.timeout(MCP_TOOLS_TIMEOUT_MS)
  await mapWithConcurrency(serverIds, MCP_TOOLS_CONCURRENCY, async (serverId) => {
    try {
      const { tools } = await discoverMcpServerToolsUseCase.execute({
        principal,
        input: { workspaceId, serverId, signal, bestEffort: true },
      })
      names.set(
        serverId,
        tools.map((tool) => tool.name)
      )
    } catch (error) {
      logger.info('Listed an MCP server without its tools', {
        serverId,
        error: getErrorMessage(error),
      })
    }
  })
  return names
}

/**
 * A table's columns as workflow source reads them. A `select` column lists its option names:
 * table blocks output a cell's option names and accept them on writes.
 */
function columnsOf(schema: unknown): ManifestColumn[] {
  if (!isRecordLike(schema) || !Array.isArray(schema.columns)) return []
  return schema.columns.flatMap((column): ManifestColumn[] => {
    if (!isRecordLike(column) || typeof column.name !== 'string') return []
    const type = isColumnType(column.type) ? column.type : 'string'
    const options = Array.isArray(column.options)
      ? column.options.flatMap((option) =>
          isRecordLike(option) && typeof option.name === 'string' ? [option.name] : []
        )
      : []
    return [
      {
        name: column.name,
        type,
        ...(options.length > 0 ? { options } : {}),
        ...(column.multiple === true ? { multiple: true } : {}),
        ...(column.required === true ? { required: true } : {}),
      },
    ]
  })
}

/** The input fields each workflow's start block declares. */
async function loadWorkflowInputs(
  workflowIds: string[]
): Promise<Map<string, ManifestWorkflowInputs>> {
  const inputs = new Map<string, ManifestWorkflowInputs>()
  if (workflowIds.length === 0) return inputs
  const rows = await db
    .select({
      workflowId: workflowBlocks.workflowId,
      id: workflowBlocks.id,
      type: workflowBlocks.type,
      subBlocks: workflowBlocks.subBlocks,
    })
    .from(workflowBlocks)
    .where(
      and(
        inArray(workflowBlocks.workflowId, workflowIds),
        inArray(workflowBlocks.type, [...INPUT_DEFINITION_TRIGGER_TYPES])
      )
    )
    .orderBy(asc(workflowBlocks.workflowId), asc(workflowBlocks.id))
  for (const row of rows) {
    if (inputs.has(row.workflowId)) continue
    const fields = extractInputFieldsFromBlocks({
      [row.id]: { type: row.type, subBlocks: row.subBlocks },
    })
    inputs.set(
      row.workflowId,
      fields.map((field) => ({ name: field.name, type: field.type }))
    )
  }
  return inputs
}

/**
 * Which manifest sections the caller may see, by the gates the editor's own pickers apply: env
 * names follow the env-var autocomplete (the workspace environment read, `secrets.manage`, and
 * like `secrets.list` never a workspace API key), credentials follow the credential selector
 * (`integrations.manage`), and skills, custom tools, MCP servers, tables and knowledge bases
 * follow their own lists (`skills.use`, `custom_tools.use`, `mcp_tools.use`, `tables.use`,
 * `knowledge.use`). A withheld section is listed empty rather than refusing the whole manifest,
 * so a member restricted from one still gets the workflows and the rest.
 */
async function visibleSections(principal: Principal, context: WorkspaceAuthorizationContext) {
  const governedUserId = capabilityGovernedPrincipalUserId(principal)
  const withheld = async (capability: StaticPermissionGroupCapability) =>
    governedUserId !== null &&
    context.workspaceOrganizationId !== null &&
    isWorkspaceCapabilityWithheld(
      governedUserId,
      context.workspaceId,
      capability,
      context.workspaceOrganizationId
    )
  // permission-group-enforced: secrets.manage — omits the env names section, as the env-var autocomplete's workspace environment read refuses
  // permission-group-enforced: integrations.manage — omits the credentials section, as the credential selector refuses
  // permission-group-enforced: skills.use — omits the skills section, as the skill list refuses
  // permission-group-enforced: custom_tools.use — omits the custom tools section, as the custom tool list refuses
  // permission-group-enforced: mcp_tools.use — omits the MCP servers section, as the MCP server list refuses
  // permission-group-enforced: tables.use — omits the tables section, as the table list refuses
  // permission-group-enforced: knowledge.use — omits the knowledge bases section, as the knowledge base list refuses
  const [
    secretsWithheld,
    integrationsWithheld,
    skillsWithheld,
    customToolsWithheld,
    mcpWithheld,
    tablesWithheld,
    knowledgeWithheld,
  ] = await Promise.all([
    withheld('secrets.manage'),
    withheld('integrations.manage'),
    withheld('skills.use'),
    withheld('custom_tools.use'),
    withheld('mcp_tools.use'),
    withheld('tables.use'),
    withheld('knowledge.use'),
  ])
  return {
    tables: !tablesWithheld,
    knowledgeBases: !knowledgeWithheld,
    env: principal.kind !== 'workspace_api_key' && !secretsWithheld,
    credentials: !integrationsWithheld,
    skills: !skillsWithheld,
    customTools: !customToolsWithheld,
    mcpServers: !mcpWithheld,
  }
}

function capped<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  return rows.length > MAX_MANIFEST_RESOURCES_PER_KIND
    ? { rows: rows.slice(0, MAX_MANIFEST_RESOURCES_PER_KIND), truncated: true }
    : { rows, truncated: false }
}

/**
 * The workspace resources a workflow file can name, by the keys source uses for them: tables
 * with their columns, knowledge bases, saved credentials with their provider, workflows with
 * the inputs their start block declares, workspace skills and custom tools, MCP servers with the
 * tool names they list (best effort, see `loadMcpToolNames`), and env variable names (never
 * values). Credentials are the ones the caller's credential listing shows, and every section is
 * omitted where the editor's own pickers or the resource's own list would withhold it (see
 * `visibleSections`). The CLI writes it as
 * `workspace.d.ts`, so `table('tickets')`, `skill('triage')` and `env.X` type-check.
 *
 * Every listed resource gets its key here (`resolveKeys` allocates one for a resource no source
 * has named yet), so a key an agent reads from the manifest resolves on apply. That allocation is
 * idempotent identity bookkeeping, not a change to any resource, which is why a read-role caller
 * (Copilot included) may cause it. Not audited, like the other catalog reads.
 */
export const readSourceResources = defineAuthorizedWorkspaceUseCase({
  operation: workflowOperations.readSourceResources,
  resolveContext: ({ input }: { input: ReadSourceResourcesInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: sourceResourcesDelegationPolicy },
  execute: async ({ principal, context }): Promise<SourceResources> => {
    const workspaceId = context.workspaceId
    const userId = resolvePrincipalSubjectUserId(principal)
    // One access read for both caller-scoped loaders; the authorization above settled the rest.
    const [visible, access] = await Promise.all([
      visibleSections(principal, context),
      userId ? checkWorkspaceAccess(workspaceId, userId) : undefined,
    ])

    const [
      tableRows,
      kbRows,
      credentialRows,
      workflowRows,
      skillRows,
      customToolRows,
      mcpServerRows,
      env,
    ] = await Promise.all([
      visible.tables
        ? db
            .select({
              id: userTableDefinitions.id,
              name: userTableDefinitions.name,
              schema: userTableDefinitions.schema,
            })
            .from(userTableDefinitions)
            .where(
              and(
                eq(userTableDefinitions.workspaceId, workspaceId),
                isNull(userTableDefinitions.archivedAt)
              )
            )
            .orderBy(asc(userTableDefinitions.createdAt), asc(userTableDefinitions.id))
            .limit(PAGE)
        : [],
      visible.knowledgeBases
        ? db
            .select({ id: knowledgeBase.id, name: knowledgeBase.name })
            .from(knowledgeBase)
            .where(and(eq(knowledgeBase.workspaceId, workspaceId), isNull(knowledgeBase.deletedAt)))
            .orderBy(asc(knowledgeBase.createdAt), asc(knowledgeBase.id))
            .limit(PAGE)
        : [],
      visible.credentials
        ? loadVisibleCredentials(workspaceId, userId, { limit: PAGE, access })
        : [],
      db
        .select({ id: workflowTable.id, name: workflowTable.name })
        .from(workflowTable)
        .where(and(eq(workflowTable.workspaceId, workspaceId), isNull(workflowTable.archivedAt)))
        .orderBy(asc(workflowTable.createdAt), asc(workflowTable.id))
        .limit(PAGE),
      visible.skills
        ? db
            .select({ id: skill.id, name: skill.name })
            .from(skill)
            .where(eq(skill.workspaceId, workspaceId))
            .orderBy(asc(skill.createdAt), asc(skill.id))
            .limit(PAGE)
        : [],
      visible.customTools
        ? db
            .select({ id: customTools.id, name: customTools.title })
            .from(customTools)
            .where(eq(customTools.workspaceId, workspaceId))
            .orderBy(asc(customTools.createdAt), asc(customTools.id))
            .limit(PAGE)
        : [],
      visible.mcpServers
        ? db
            .select({ id: mcpServers.id, name: mcpServers.name })
            .from(mcpServers)
            .where(and(eq(mcpServers.workspaceId, workspaceId), isNull(mcpServers.deletedAt)))
            .orderBy(asc(mcpServers.createdAt), asc(mcpServers.id))
            .limit(PAGE)
        : [],
      visible.env ? loadEnvNames(workspaceId, userId, access) : [],
    ])

    const tables = capped(tableRows)
    const kbs = capped(kbRows)
    const credentials = capped(credentialRows)
    const workflows = capped(workflowRows)
    const skills = capped(skillRows)
    const tools = capped(customToolRows)
    const servers = capped(mcpServerRows)

    const refs: ResourceIdRef[] = [
      ...tables.rows.map((row) => ({ kind: 'table' as const, id: row.id })),
      ...kbs.rows.map((row) => ({ kind: 'knowledge-base' as const, id: row.id })),
      ...credentials.rows.map((row) => ({ kind: 'credential' as const, id: row.id })),
      ...workflows.rows.map((row) => ({ kind: 'workflow' as const, id: row.id })),
      ...skills.rows.map((row) => ({ kind: 'skill' as const, id: row.id })),
      ...tools.rows.map((row) => ({ kind: 'custom-tool' as const, id: row.id })),
      ...servers.rows.map((row) => ({ kind: 'mcp-server' as const, id: row.id })),
    ]
    const [keys, inputs, mcpTools] = await Promise.all([
      resolveKeys(workspaceId, refs, { createdBy: userId ?? null }),
      loadWorkflowInputs(workflows.rows.map((row) => row.id)),
      loadMcpToolNames(
        principal,
        workspaceId,
        servers.rows.map((row) => row.id)
      ),
    ])
    const keyOf = (kind: ResourceKind, id: string) => keys.get(kind)?.get(id)
    const named = (kind: ResourceKind, rows: Array<{ id: string; name: string }>) =>
      rows.flatMap((row) => {
        const key = keyOf(kind, row.id)
        return key ? [{ key, id: row.id, name: row.name }] : []
      })

    return {
      workspaceId,
      tables: tables.rows.flatMap((row) => {
        const key = keyOf('table', row.id)
        return key ? [{ key, id: row.id, name: row.name, columns: columnsOf(row.schema) }] : []
      }),
      knowledgeBases: named('knowledge-base', kbs.rows),
      credentials: credentials.rows.flatMap((row) => {
        const key = keyOf('credential', row.id)
        return key
          ? [{ key, id: row.id, name: row.name, provider: row.providerId ?? row.type }]
          : []
      }),
      workflows: workflows.rows.flatMap((row) => {
        const key = keyOf('workflow', row.id)
        return key ? [{ key, id: row.id, name: row.name, inputs: inputs.get(row.id) ?? [] }] : []
      }),
      skills: named('skill', skills.rows),
      customTools: named('custom-tool', tools.rows),
      mcpServers: named('mcp-server', servers.rows).map((server) => {
        const names = mcpTools.get(server.id)
        return names ? { ...server, tools: names } : server
      }),
      env,
      truncated: [tables, kbs, credentials, workflows, skills, tools, servers].some(
        (section) => section.truncated
      ),
    }
  },
})
