import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { isPlainRecord } from '@sim/utils/object'
import type { BlockState } from '@sim/workflow-types/workflow'
import { bindCopilotWorkspaceOperation } from '@/lib/core/application/copilot-workspace-invocation'
import type { PrincipalForOperation } from '@/lib/core/application/workspace-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { readAvailableCustomToolByIdOrTitleUseCase } from '@/lib/custom-tools/application/use-cases'
import { discoverMcpServerToolsUseCase } from '@/lib/mcp/application/use-cases'
import { normalizeMcpOperationPolicy, permitsMcpOperation } from '@/lib/mcp/operation-policy'
import {
  assertValidMcpServerToolBindings,
  createMcpToolId,
  MCP_SERVER_ADVANCED_TOOL_TYPE,
} from '@/lib/mcp/shared'
import { resolveMcpToolBinding } from '@/lib/mcp/tool-binding'
import { buildIntegrationToolSchemas } from '@/lib/mothership/chat/payload'
import { projectIntegrationCatalog } from '@/lib/mothership/integrations/application/catalog'
import { OPERATION_SUBBLOCK_ID } from '@/lib/permission-groups/operation-access'
import { getSkillUseCase } from '@/lib/skills/application/use-cases'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import {
  loadWorkflowGraph,
  type ReadWorkflowGraphInput,
} from '@/lib/workflows/application/read-workflow-graph'
import { resolveBlockToolId } from '@/lib/workflows/tool-input/identity'
import { resolveAgentToolUsageControl } from '@/lib/workflows/tool-input/usage-control'
import { isCustomBlockType } from '@/blocks/custom/build-config'
import { getBlock } from '@/blocks/registry'
import {
  assertPermissionsAllowed,
  CustomToolsNotAllowedError,
  IntegrationNotAllowedError,
  McpToolsNotAllowedError,
  SkillsNotAllowedError,
  ToolNotAllowedError,
  validateBlockType,
} from '@/ee/access-control/utils/permission-check'
import { AGENT } from '@/executor/constants'
import { createEnvVarPattern, createReferencePattern } from '@/executor/utils/reference-validation'
import { assignProviderToolIdentities } from '@/providers/tool-identity'
import { extractBlockParams } from '@/serializer/index'
import { getTool } from '@/tools/utils'

interface InspectWorkflowToolsInput extends ReadWorkflowGraphInput {
  blockId: string
  query?: string
  limit?: number
  signal?: AbortSignal
}

type InspectionPrincipal = PrincipalForOperation<typeof workflowOperations.inspectTools>
interface InspectionContext {
  principal: InspectionPrincipal
  workspaceId: string
  userId: string
  signal?: AbortSignal
}

export interface InspectedWorkflowTool {
  bindingIndex?: number
  source: 'integration' | 'custom' | 'mcp' | 'mcp-server' | 'skill'
  status: 'configured' | 'disabled' | 'unavailable' | 'unresolved'
  canonicalName?: string
  callableName?: string
  displayTitle?: string
  usageControl?: 'auto' | 'force' | 'none'
  fixedArgumentNames?: string[]
  argumentsRequireRuntime?: boolean
  reason?: string
}

export interface WorkflowToolInspection {
  workflowId: string
  workspaceId: string
  version: 'draft'
  block: { id: string; name: string; type: string; enabled: boolean }
  accessBasis: 'current_user'
  exposure: 'direct' | 'integration_gateway'
  selectionMode: 'explicit' | 'additive'
  approval: { enforcedPerCall: false; note: string }
  selected: InspectedWorkflowTool[]
  ambient?: {
    total: number
    truncated: boolean
    operations: { toolId: string; service?: string }[]
  }
  notes: string[]
}

/** References are described, never evaluated or expanded into credentials during inspection. */
function hasRuntimeInput(value: unknown): boolean {
  if (typeof value === 'string')
    return createReferencePattern().test(value) || createEnvVarPattern().test(value)
  if (Array.isArray(value)) return value.some(hasRuntimeInput)
  return isPlainRecord(value) && Object.values(value).some(hasRuntimeInput)
}

function sourceOf(tool: Record<string, unknown>): InspectedWorkflowTool['source'] {
  if (tool.type === 'custom-tool') return 'custom'
  if (tool.type === 'mcp') return 'mcp'
  if (tool.type === MCP_SERVER_ADVANCED_TOOL_TYPE) return 'mcp-server'
  return 'integration'
}

function isUnavailable(error: unknown): boolean {
  return (
    (error instanceof OrchestrationError &&
      ['not_found', 'forbidden', 'conflict'].includes(error.code)) ||
    error instanceof IntegrationNotAllowedError ||
    error instanceof CustomToolsNotAllowedError ||
    error instanceof McpToolsNotAllowedError ||
    error instanceof SkillsNotAllowedError ||
    error instanceof ToolNotAllowedError
  )
}

async function inspectCustomTool(
  tool: Record<string, unknown>,
  context: InspectionContext
): Promise<string | undefined> {
  await assertPermissionsAllowed({ ...context, toolKind: 'custom' })
  let title = tool.title
  let schema = tool.schema
  if (typeof tool.customToolId === 'string') {
    const result = await readAvailableCustomToolByIdOrTitleUseCase.execute({
      principal: bindCopilotWorkspaceOperation(
        context.principal,
        context.workspaceId,
        ['sim:workflows'],
        readAvailableCustomToolByIdOrTitleUseCase
      ),
      input: { workspaceId: context.workspaceId, identifier: tool.customToolId, lookup: 'id' },
    })
    if (result.tool) {
      title = result.tool.title
      schema = result.tool.schema
    }
  }
  if (!isPlainRecord(schema) || !isPlainRecord(schema.function) || typeof title !== 'string')
    return undefined
  return `${AGENT.CUSTOM_TOOL_PREFIX}${title}`
}

async function inspectBinding(
  tool: Record<string, unknown>,
  entry: InspectedWorkflowTool,
  context: InspectionContext,
  discovery: Map<string, Promise<{ name: string }[]>>
): Promise<InspectedWorkflowTool[]> {
  const params = isPlainRecord(tool.params) ? tool.params : {}
  if (entry.source === 'mcp' || entry.source === 'mcp-server') {
    await assertPermissionsAllowed({ ...context, toolKind: 'mcp' })
    let serverId: string
    let toolName: string | undefined
    try {
      if (entry.source === 'mcp') ({ serverId, toolName } = resolveMcpToolBinding(tool))
      else if (typeof params.serverId === 'string' && params.serverId.trim())
        serverId = params.serverId
      else return [{ ...entry, status: 'unavailable', reason: 'MCP server binding is missing.' }]
    } catch {
      return [{ ...entry, status: 'unavailable', reason: 'MCP tool binding is invalid.' }]
    }
    let policy: ReturnType<typeof normalizeMcpOperationPolicy>
    try {
      policy = normalizeMcpOperationPolicy(
        entry.source === 'mcp-server' ? tool.operationPolicy : undefined
      )
    } catch {
      return [{ ...entry, status: 'unavailable', reason: 'MCP operation policy is invalid.' }]
    }
    let pending = discovery.get(serverId)
    if (!pending) {
      pending = discoverMcpServerToolsUseCase
        .execute({
          principal: bindCopilotWorkspaceOperation(
            context.principal,
            context.workspaceId,
            ['sim:workflows'],
            discoverMcpServerToolsUseCase
          ),
          input: {
            workspaceId: context.workspaceId,
            serverId,
            signal: context.signal,
            requireComplete: true,
          },
        })
        .then(({ tools }) => tools)
      discovery.set(serverId, pending)
    }
    const tools = (await pending).filter(
      (candidate) =>
        (!toolName || candidate.name === toolName) && permitsMcpOperation(policy, candidate.name)
    )
    return tools.length
      ? tools.map((candidate) => ({
          ...entry,
          canonicalName: createMcpToolId(serverId, candidate.name),
        }))
      : [
          {
            ...entry,
            status: 'unavailable',
            reason:
              'No matching MCP operations are available under the saved policy and current caller access.',
          },
        ]
  }
  if (entry.source === 'custom') {
    const name = await inspectCustomTool(tool, context)
    return [
      {
        ...entry,
        ...(name
          ? { canonicalName: name }
          : {
              status: 'unavailable' as const,
              reason: 'Custom tool definition is missing or unavailable.',
            }),
      },
    ]
  }
  if (typeof tool.type !== 'string')
    return [{ ...entry, status: 'unavailable', reason: 'Tool type is missing.' }]
  await validateBlockType(context.userId, context.workspaceId, tool.type)
  if (isCustomBlockType(tool.type))
    return [
      {
        ...entry,
        canonicalName: 'deployed_block_executor',
        status: 'unresolved',
        reason: 'Published custom-block authority and required inputs are resolved at execution.',
      },
    ]
  const definition = getBlock(tool.type)
  if (
    definition?.tools.config?.tool &&
    definition.tools.access.length > 1 &&
    !tool.operation &&
    !params.operation &&
    !definition.subBlocks.some((field) => field.id === OPERATION_SUBBLOCK_ID) &&
    hasRuntimeInput(params)
  )
    return [
      {
        ...entry,
        status: 'unresolved',
        reason: 'Operation selection depends on runtime arguments.',
      },
    ]
  let name: string | null = null
  try {
    if (definition)
      name = resolveBlockToolId(
        definition,
        params,
        typeof tool.operation === 'string' ? tool.operation : undefined
      )
  } catch {
    return [
      {
        ...entry,
        status: 'unavailable',
        reason: 'The configured operation could not be resolved.',
      },
    ]
  }
  const registered = name ? getTool(name) : undefined
  if (!registered)
    return [{ ...entry, status: 'unavailable', reason: 'No registered tool matches this binding.' }]
  await assertPermissionsAllowed({ ...context, toolId: registered.id })
  return [{ ...entry, canonicalName: registered.id }]
}

async function inspectSelections(
  block: BlockState,
  tools: unknown,
  context: InspectionContext,
  inactive = false
): Promise<InspectedWorkflowTool[]> {
  if (tools === undefined || tools === null || tools === '') return []
  if (typeof tools === 'string') {
    try {
      tools = JSON.parse(tools)
    } catch {
      /* Report invalid saved data below. */
    }
  }
  if (!Array.isArray(tools))
    return [
      {
        source: 'integration',
        status: 'unresolved',
        reason:
          'The tools field is not a static array. Its effective bindings require runtime inputs.',
      },
    ]
  const discovery = new Map<string, Promise<{ name: string }[]>>()
  const result: InspectedWorkflowTool[] = []
  const active: Record<string, unknown>[] = []
  for (const [bindingIndex, value] of tools.entries()) {
    context.signal?.throwIfAborted()
    if (!isPlainRecord(value)) {
      result.push({
        bindingIndex,
        source: 'integration',
        status: 'unavailable',
        reason: 'Invalid saved tool binding.',
      })
      continue
    }
    const entry: InspectedWorkflowTool = {
      bindingIndex,
      source: sourceOf(value),
      status: 'configured',
      ...(typeof value.title === 'string' && !hasRuntimeInput(value.title)
        ? { displayTitle: value.title }
        : {}),
    }
    const mode = resolveAgentToolUsageControl(value, bindingIndex, block.data?.canonicalModes)
    if (block.enabled === false || mode === 'none' || inactive) {
      result.push({
        ...entry,
        status: 'disabled',
        usageControl: mode,
        reason:
          block.enabled === false
            ? 'The block is disabled.'
            : inactive
              ? 'The tools field is inactive for the saved block settings.'
              : 'The binding is disabled (none).',
      })
      continue
    }
    const params = isPlainRecord(value.params) ? value.params : {}
    if (
      !mode ||
      hasRuntimeInput([
        value.type,
        value.operation,
        value.customToolId,
        entry.source === 'custom' && !value.customToolId ? value.title : undefined,
        params.operation,
        params.serverId,
        params.toolName,
        value.operationPolicy,
      ])
    ) {
      result.push({
        ...entry,
        status: 'unresolved',
        reason:
          'Tool identity or permission mode depends on runtime inputs. No references were evaluated.',
      })
      continue
    }
    entry.usageControl = mode
    if (block.type === 'agent' && hasRuntimeInput(value.params))
      entry.argumentsRequireRuntime = true
    if (block.type === 'mothership' && entry.source !== 'mcp' && entry.source !== 'mcp-server') {
      result.push({
        ...entry,
        status: 'unavailable',
        reason:
          'Sim Chat only consumes MCP selections; integrations come from its ambient catalog.',
      })
      continue
    }
    active.push({ ...value, usageControl: mode })
    if (block.type === 'agent' && entry.source !== 'mcp-server' && isPlainRecord(value.params)) {
      entry.fixedArgumentNames = Object.keys(value.params).filter(
        (name) => !['serverId', 'toolName', 'serverName', 'connectionId'].includes(name)
      )
    }
    try {
      result.push(...(await inspectBinding(value, entry, context, discovery)))
    } catch (error) {
      if (!isUnavailable(error)) throw error
      result.push({
        ...entry,
        status: 'unavailable',
        reason:
          'Tool or credential source is disabled, inaccessible, or unavailable to the current caller.',
      })
    }
  }
  try {
    assertValidMcpServerToolBindings(active)
  } catch {
    for (const entry of result) {
      if (entry.source !== 'mcp' && entry.source !== 'mcp-server') continue
      if (entry.status === 'disabled') continue
      entry.status = 'unavailable'
      entry.reason = 'Invalid or overlapping MCP server bindings prevent tool preparation.'
    }
  }
  return result
}

/** No execution context is fabricated: discovery is explicitly for the caller reading this draft. */
export const inspectWorkflowTools = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.inspectTools,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: InspectionPrincipal
    input: InspectWorkflowToolsInput
  }) =>
    resolveActiveWorkflowApplicationContext({
      workflowId: input.workflowId,
      assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
    }),
  async execute({ principal, input, context }): Promise<WorkflowToolInspection> {
    input.signal?.throwIfAborted()
    const limit = input.limit ?? 20
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new OrchestrationError(
        'validation',
        'limit must be a nonnegative integer; 0 returns all ambient operations'
      )
    const graph = await loadWorkflowGraph(context)
    const block = graph.blocks[input.blockId]
    if (!block) throw new OrchestrationError('not_found', 'Block not found in this workflow')
    if (block.type !== 'agent' && block.type !== 'mothership')
      throw new OrchestrationError(
        'validation',
        'Tool inspection supports Agent and Sim Chat blocks'
      )
    const inputs = extractBlockParams(block)
    const inspectionContext: InspectionContext = {
      principal,
      workspaceId: context.workspaceId,
      userId: requirePrincipalSubjectUserId(principal),
      signal: input.signal,
    }
    const selected = await inspectSelections(
      block,
      inputs.tools ?? block.subBlocks.tools?.value,
      inspectionContext,
      inputs.tools === undefined
    )
    const report: WorkflowToolInspection = {
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      version: 'draft',
      block: { id: block.id, name: block.name, type: block.type, enabled: block.enabled !== false },
      accessBasis: 'current_user',
      exposure: block.type === 'agent' ? 'direct' : 'integration_gateway',
      selectionMode: block.type === 'agent' ? 'explicit' : 'additive',
      approval: {
        enforcedPerCall: false,
        note: 'These workflow blocks do not pause for per-tool user approval. Tool labels, auto/force modes and prompt instructions do not add enforcement; any approval gate must be implemented in the executed workflow.',
      },
      selected,
      notes: [
        'This is a draft configuration and current-caller discovery report, not a test run or a grant to execute. Deployment snapshots and execution actors can differ.',
        'Credentials, resolved inputs, schema enrichment, model capabilities and execution permissions are checked at runtime. No tools were invoked and no secret values were resolved.',
      ],
    }
    if (block.type === 'mothership') {
      const schemas =
        block.enabled === false
          ? []
          : await buildIntegrationToolSchemas(
              inspectionContext.userId,
              { schemaSurface: 'copilot' },
              context.workspaceId
            )
      const catalog = projectIntegrationCatalog(schemas, {
        mode: 'agent',
        workspaceId: context.workspaceId,
        mcpServerIds: [],
        query: input.query,
        limit,
      })
      report.ambient = {
        total: catalog.total,
        truncated: catalog.truncated,
        operations: catalog.operations.map(({ toolId, service }) => ({
          toolId,
          ...(service ? { service } : {}),
        })),
      }
      report.notes.push(
        'Sim Chat discovers integration and selected MCP operations and calls them through its integration gateway. An empty selections array does not disable integrations. Catalog visibility does not prove a credential is connected. This block does not inherit the interactive Mothership CLI, browser, terminal or delegation tools.'
      )
      report.notes.push(
        'MCP selections support fixed or variable auto/force/none modes. Force requires an invocation of each selected operation; None disables that selection. These modes do not change ambient integration access. Fixed MCP arguments are not supported.'
      )
      for (const entry of selected)
        if (entry.status === 'configured') entry.callableName = entry.canonicalName
    } else {
      if (
        Array.isArray(block.subBlocks.skills?.value) &&
        block.subBlocks.skills.value.length &&
        (block.enabled === false || inputs.skills === undefined)
      ) {
        selected.push({
          source: 'skill',
          status: 'disabled',
          reason: 'Selected skills are inactive for the saved block settings.',
        })
      }
      if (block.enabled !== false && Array.isArray(inputs.skills) && inputs.skills.length) {
        let available = false
        let unresolved = false
        for (const selection of inputs.skills) {
          if (
            !isPlainRecord(selection) ||
            typeof selection.skillId !== 'string' ||
            hasRuntimeInput(selection.skillId)
          ) {
            unresolved = true
            continue
          }
          try {
            await assertPermissionsAllowed({ ...inspectionContext, toolKind: 'skill' })
            await getSkillUseCase.execute({
              principal: bindCopilotWorkspaceOperation(
                principal,
                context.workspaceId,
                ['sim:workflows'],
                getSkillUseCase
              ),
              input: { workspaceId: context.workspaceId, skillId: selection.skillId },
            })
            available = true
          } catch (error) {
            if (!isUnavailable(error)) throw error
          }
        }
        selected.push({
          source: 'skill',
          canonicalName: 'load_skill',
          status: available ? 'configured' : unresolved ? 'unresolved' : 'unavailable',
          reason: 'The runtime adds load_skill when at least one selected skill resolves.',
        })
      }
      const order = { integration: 0, custom: 0, mcp: 1, 'mcp-server': 2, skill: 3 }
      const known = selected
        .filter((entry) => entry.status === 'configured' && entry.canonicalName)
        .sort((a, b) => order[a.source] - order[b.source])
        .map((entry) => ({ entry, id: entry.canonicalName! }))
      if (
        selected.some((entry) => entry.status === 'unresolved' || entry.status === 'unavailable')
      ) {
        report.notes.push(
          'Callable names are withheld where unresolved or unavailable bindings could change provider duplicate-name suffixes. canonicalName identifies the operation before that suffix.'
        )
      } else {
        assignProviderToolIdentities(known)
        for (const { entry, id } of known) entry.callableName = id
      }
    }
    input.signal?.throwIfAborted()
    return report
  },
})
