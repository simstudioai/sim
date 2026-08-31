import type { ExportWorkflowResponse } from 'sim/embed'
import {
  type AgentCliCommand,
  type AgentCliRuntime,
  agentCliFail,
  agentCliOk,
} from '@/lib/mothership/tools/handlers/agent-cli/types'

/**
 * Projections over one workflow's exported state: just the blocks, or just the
 * connections. The full export is the v2 source of truth; these views exist so
 * the agent can orient in a large workflow without paging its whole state
 * through the context window.
 */

export async function fetchWorkflowState(
  runtime: AgentCliRuntime,
  workflowId: string
): Promise<Record<string, unknown>> {
  const response = await runtime.client.request<ExportWorkflowResponse>(
    `/api/v2/workflows/${encodeURIComponent(workflowId)}/export`
  )
  return response.data.state
}

interface BlockView {
  id: string
  type: string | undefined
  name: string | undefined
  enabled: boolean | undefined
}

function blockViews(state: Record<string, unknown>): BlockView[] {
  const blocks = state.blocks
  if (typeof blocks !== 'object' || blocks === null) return []
  return Object.entries(blocks as Record<string, unknown>).map(([id, raw]) => {
    const block = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    return {
      id,
      type: typeof block.type === 'string' ? block.type : undefined,
      name: typeof block.name === 'string' ? block.name : undefined,
      enabled: typeof block.enabled === 'boolean' ? block.enabled : undefined,
    }
  })
}

function edgeViews(state: Record<string, unknown>): Record<string, unknown>[] {
  const edges = state.edges
  if (!Array.isArray(edges)) return []
  return edges.map((raw) => {
    const edge = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    return {
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle !== undefined && edge.sourceHandle !== null
        ? { sourceHandle: edge.sourceHandle }
        : {}),
      ...(edge.targetHandle !== undefined && edge.targetHandle !== null
        ? { targetHandle: edge.targetHandle }
        : {}),
    }
  })
}

export const workflowBlocksCommand: AgentCliCommand = {
  path: ['workflow', 'blocks'],
  summary: 'List just the blocks of one workflow (id, type, name, enabled)',
  usage: 'workflow blocks <workflowId>',
  async execute(rest, runtime) {
    const workflowId = rest[0]
    if (!workflowId) return agentCliFail('Usage: sim workflow blocks <workflowId>')
    const state = await fetchWorkflowState(runtime, workflowId)
    return agentCliOk(JSON.stringify(blockViews(state), null, 2))
  },
}

export const workflowEdgesCommand: AgentCliCommand = {
  path: ['workflow', 'edges'],
  summary: 'List just the connections of one workflow (source, target, handles)',
  usage: 'workflow edges <workflowId>',
  async execute(rest, runtime) {
    const workflowId = rest[0]
    if (!workflowId) return agentCliFail('Usage: sim workflow edges <workflowId>')
    const state = await fetchWorkflowState(runtime, workflowId)
    return agentCliOk(JSON.stringify(edgeViews(state), null, 2))
  },
}
