/**
 * The source forms of the agent tools the editor's tool picker writes for an MCP server's tool and
 * for a child workflow (tool-input.tsx): `mcp('docs').tool('search')` and
 * `childWorkflow('enrich').asTool()`. Each form has a builder, which the compiler calls, and a
 * reader, which the printer calls. The reader accepts a tool only when the builder rebuilds it
 * exactly, so a printed form always compiles back to the tool it was printed from; any other tool
 * of these types prints through its block builder or `raw(tool)`.
 */

import { isRecordLike } from '@sim/utils/object'
import { toolModes } from './canonicalize/modes'
import type { BlockCatalog } from './catalog/types'
import type { CanonicalTool, Json, ResourceKind, ResourceNode, Value } from './model'
import { deepEqual, setOwn } from './records'

/** The stored type of an MCP server tool entry. */
const MCP_TOOL_TYPE = 'mcp'

/** The stored type of a child workflow tool entry (the `runWorkflow` block as a tool). */
const WORKFLOW_TOOL_TYPE = 'workflow_input'

/** The title and tool id the picker stores on every child workflow tool. */
const WORKFLOW_TOOL_TITLE = 'Workflow'
const WORKFLOW_TOOL_ID = 'workflow_executor'

/**
 * MCP tool params the form writes itself: the binding (`serverId`, `toolName`) and the server
 * snapshot (`serverName`, `serverUrl`). Every other param is a fixed argument, so none of these
 * can be one.
 */
export const MCP_RESERVED_ARGS: ReadonlySet<string> = new Set([
  'serverId',
  'toolName',
  'serverName',
  'serverUrl',
])

/**
 * `createMcpToolId` (lib/mcp/utils.ts): the `toolId` the picker stores for an MCP tool. It embeds
 * the server's internal id, so canonicalize drops a `toolId` equal to it and materialize derives it
 * again from the resolved server.
 */
export function mcpToolId(serverId: string, toolName: string): string {
  return `${serverId.startsWith('mcp-') ? serverId : `mcp-${serverId}`}-${toolName}`
}

/**
 * The server and tool a stored tool entry binds when it is an MCP tool with a non-empty
 * `serverId` and a `toolName`, else `null`.
 */
export function mcpBinding(
  type: unknown,
  params: Record<string, unknown>
): { serverId: string; toolName: string } | null {
  const { serverId, toolName } = params
  return type === MCP_TOOL_TYPE &&
    typeof serverId === 'string' &&
    serverId !== '' &&
    typeof toolName === 'string'
    ? { serverId, toolName }
    : null
}

type ToolUsage = Pick<CanonicalTool, 'usageControl' | 'usageControlExpression'>

/** An MCP tool as `mcp(server).tool(name, options)` writes it. */
export interface McpToolForm extends ToolUsage {
  server: ResourceNode
  name: string
  /** Argument values the workflow fixes; the model fills the rest. */
  args: Record<string, Value>
  /** What the picker saved about the server and the tool's input schema. Shown, never run. */
  snapshot: { serverName?: string; serverUrl?: string; schema?: Json }
}

/** A child-workflow tool as `childWorkflow(key).asTool(options)` writes it. */
export interface WorkflowToolForm extends ToolUsage {
  workflow: ResourceNode
}

function withUsage(tool: CanonicalTool, usage: ToolUsage): CanonicalTool {
  if (usage.usageControl !== undefined) tool.usageControl = usage.usageControl
  if (usage.usageControlExpression !== undefined) {
    tool.usageControlExpression = usage.usageControlExpression
  }
  return tool
}

function usageOf(tool: CanonicalTool): ToolUsage {
  return {
    ...(tool.usageControl !== undefined && { usageControl: tool.usageControl }),
    ...(tool.usageControlExpression !== undefined && {
      usageControlExpression: tool.usageControlExpression,
    }),
  }
}

function isResource(value: Value | undefined, kind: ResourceKind): value is ResourceNode {
  return (
    isRecordLike(value) &&
    value.$sim === 'resource' &&
    value.kind === kind &&
    typeof value.key === 'string'
  )
}

function optionalString(value: Value | undefined): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

/** The tool `mcp(server).tool(name, options)` compiles to: the picker's MCP tool entry. */
export function buildMcpTool(catalog: BlockCatalog, form: McpToolForm): CanonicalTool {
  const params: Record<string, Value> = { serverId: form.server, toolName: form.name }
  if (form.snapshot.serverName !== undefined) params.serverName = form.snapshot.serverName
  if (form.snapshot.serverUrl !== undefined) params.serverUrl = form.snapshot.serverUrl
  for (const [name, value] of Object.entries(form.args)) setOwn(params, name, value)
  const tool: CanonicalTool = {
    type: MCP_TOOL_TYPE,
    title: form.name,
    params,
    modes: toolModes(catalog, MCP_TOOL_TYPE, params),
  }
  if (form.snapshot.schema !== undefined) tool.extra = { schema: form.snapshot.schema }
  return withUsage(tool, form)
}

/** The `mcp(server).tool(name, options)` form of `tool`, or `null` when it has none. */
export function readMcpTool(catalog: BlockCatalog, tool: CanonicalTool): McpToolForm | null {
  if (tool.type !== MCP_TOOL_TYPE) return null
  const { serverId, toolName, serverName, serverUrl, ...args } = tool.params
  if (!isResource(serverId, 'mcp-server') || typeof toolName !== 'string') return null
  if (!optionalString(serverName) || !optionalString(serverUrl)) return null
  const schema = tool.extra?.schema
  const form: McpToolForm = {
    server: serverId,
    name: toolName,
    args,
    snapshot: {
      ...(serverName !== undefined && { serverName }),
      ...(serverUrl !== undefined && { serverUrl }),
      ...(schema !== undefined && { schema }),
    },
    ...usageOf(tool),
  }
  return deepEqual(buildMcpTool(catalog, form), tool) ? form : null
}

/** The tool `childWorkflow(key).asTool(options)` compiles to: the picker's workflow tool entry. */
export function buildWorkflowTool(catalog: BlockCatalog, form: WorkflowToolForm): CanonicalTool {
  const params: Record<string, Value> = { workflowId: form.workflow }
  return withUsage(
    {
      type: WORKFLOW_TOOL_TYPE,
      title: WORKFLOW_TOOL_TITLE,
      toolId: WORKFLOW_TOOL_ID,
      params,
      modes: toolModes(catalog, WORKFLOW_TOOL_TYPE, params),
    },
    form
  )
}

/** The `childWorkflow(key).asTool(options)` form of `tool`, or `null` when it has none. */
export function readWorkflowTool(
  catalog: BlockCatalog,
  tool: CanonicalTool
): WorkflowToolForm | null {
  const workflow = tool.params.workflowId
  if (tool.type !== WORKFLOW_TOOL_TYPE || !isResource(workflow, 'workflow')) return null
  const form: WorkflowToolForm = { workflow, ...usageOf(tool) }
  return deepEqual(buildWorkflowTool(catalog, form), tool) ? form : null
}
