import type { WorkflowState } from '@sim/workflow-types/workflow'
import { fetchWorkflowState } from '@/lib/mothership/agent-cli/engines/workflow-state'
import {
  type AgentCliEngine,
  type AgentCliRuntime,
  agentCliFail,
  agentCliOk,
} from '@/lib/mothership/agent-cli/types'
import { formatWorkflowLintMessage, hasWorkflowLintIssues } from '@/lib/workflows/editing/lint'
import { buildWorkflowLintReport } from '@/lib/workflows/editing/lint-report'
import { createEnvVarPattern } from '@/executor/utils/reference-validation'

/**
 * The Go copilot served this as the virtual `workflows/{path}/lint.json` VFS
 * file; here it is a command. Authorization rides the v2 export fetch (a user
 * who cannot read the workflow gets the 403 there); the report itself is the
 * same engine both graph writes publish, so a lint here can never disagree
 * with what an edit would have reported.
 */
export const workflowLintCommand: AgentCliEngine = {
  async execute(rest, runtime) {
    const workflowId = rest[0]
    if (!workflowId) return agentCliFail('Usage: sim workflows lint <workflowId>')
    const state = await fetchWorkflowState(runtime, workflowId)
    // double-cast-allowed: the v2 export's `state` is the serialized WorkflowState;
    // the lint engine reads it structurally (blocks/edges only)
    const graph = state as unknown as Pick<WorkflowState, 'blocks' | 'edges'>
    const report = await buildWorkflowLintReport(graph, {
      workflowId,
      workspaceId: runtime.workspaceId,
      subjectUserId: runtime.userId,
    })
    const undeclaredEnvVars = await collectUndeclaredEnvVars(runtime, graph)
    const summary = hasWorkflowLintIssues(report)
      ? formatWorkflowLintMessage(report)
      : undeclaredEnvVars.length > 0
        ? `Undeclared environment variables referenced: ${undeclaredEnvVars.map((v) => v.name).join(', ')} — an unresolved {{TOKEN}} resolves to an EMPTY STRING at run time, not an error.`
        : 'No structural issues found (orphans, ports, required fields, references). Code and runtime behaviour are not checked — run it.'
    return agentCliOk(JSON.stringify({ summary, undeclaredEnvVars, ...report }, null, 2))
  },
}

// The executor's own env-token grammar (keys trimmed to match its resolution).
const ENV_TOKEN = createEnvVarPattern()

function envTokenNames(value: unknown, out: Map<string, Set<string>>, blockName: string): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(ENV_TOKEN)) {
      const key = match[1]?.trim()
      if (!key) continue
      const blocks = out.get(key) ?? new Set<string>()
      blocks.add(blockName)
      out.set(key, blocks)
    }
  } else if (Array.isArray(value)) {
    for (const item of value) envTokenNames(item, out, blockName)
  } else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) envTokenNames(item, out, blockName)
  }
}

/**
 * Referenced-but-undeclared {{TOKEN}} audit. Sim resolves a missing token to an
 * empty string rather than an error, so the failure it causes is silent and
 * downstream — the exact trap a fleet audit found masking a broken production
 * error monitor. Declared names come from the same secrets surface the CLI
 * exposes (workspace + the caller's personal scope).
 */
async function collectUndeclaredEnvVars(
  runtime: AgentCliRuntime,
  graph: Pick<WorkflowState, 'blocks'>
): Promise<{ name: string; blocks: string[] }[]> {
  const referenced = new Map<string, Set<string>>()
  for (const block of Object.values(graph.blocks ?? {})) {
    const b = block as { name?: string; subBlocks?: Record<string, { value?: unknown }> }
    for (const subBlock of Object.values(b.subBlocks ?? {})) {
      envTokenNames(subBlock?.value, referenced, b.name ?? 'unnamed block')
    }
  }
  if (referenced.size === 0) return []
  const declared = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < 10; page++) {
    const response = await runtime.client.request<{
      data: { name: string }[]
      nextCursor: string | null
    }>('/api/v2/secrets', {
      query: { workspaceId: runtime.workspaceId, ...(cursor ? { cursor } : {}) },
    })
    for (const secret of response.data) declared.add(secret.name)
    if (!response.nextCursor) break
    cursor = response.nextCursor
  }
  return [...referenced.entries()]
    .filter(([name]) => !declared.has(name))
    .map(([name, blocks]) => ({ name, blocks: [...blocks].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
