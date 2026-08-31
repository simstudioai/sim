import type { ListWorkflowsResponse } from 'sim/embed'
import { fetchWorkflowState } from '@/lib/mothership/tools/handlers/agent-cli/commands/workflow-views'
import {
  type AgentCliCommand,
  type AgentCliRuntime,
  agentCliFail,
  agentCliOk,
} from '@/lib/mothership/tools/handlers/agent-cli/types'

/**
 * Structural grep over workflow state. Matches walk the exported JSON tree and
 * report `path: value` lines, so a hit names exactly where in the workflow it
 * lives (block param, edge handle, variable) instead of a rendered blob.
 */

const MAX_MATCHES = 200
const SNIPPET_CHARS = 200
const EXPORT_CONCURRENCY = 5

function compilePattern(raw: string): (value: string) => boolean {
  try {
    const regex = new RegExp(raw, 'i')
    return (value) => regex.test(value)
  } catch {
    const needle = raw.toLowerCase()
    return (value) => value.toLowerCase().includes(needle)
  }
}

function grepTree(
  node: unknown,
  matches: (value: string) => boolean,
  path: string,
  out: string[]
): void {
  if (out.length >= MAX_MATCHES) return
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    const text = String(node)
    if (matches(text)) {
      const snippet = text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS)}…` : text
      out.push(`${path}: ${snippet.replaceAll('\n', '\\n')}`)
    }
    return
  }
  if (Array.isArray(node)) {
    node.forEach((child, index) => grepTree(child, matches, `${path}[${index}]`, out))
    return
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, child] of Object.entries(node)) {
      // Keys are searchable too: a block id or param name is often the target.
      if (matches(key) && out.length < MAX_MATCHES) out.push(`${path}.${key}`)
      grepTree(child, matches, `${path}.${key}`, out)
    }
  }
}

function renderMatches(lines: string[]): string {
  if (lines.length === 0) return 'No matches.'
  const capped =
    lines.length >= MAX_MATCHES ? [...lines, `[capped at ${MAX_MATCHES} matches]`] : lines
  return capped.join('\n')
}

export const workflowGrepCommand: AgentCliCommand = {
  path: ['workflow', 'grep'],
  summary: 'Search one workflow state (blocks, params, edges) for a pattern',
  usage: 'workflow grep <workflowId> <pattern>',
  async execute(rest, runtime) {
    const [workflowId, ...patternParts] = rest
    const pattern = patternParts.join(' ')
    if (!workflowId || !pattern)
      return agentCliFail('Usage: sim workflow grep <workflowId> <pattern>')
    const state = await fetchWorkflowState(runtime, workflowId)
    const out: string[] = []
    grepTree(state, compilePattern(pattern), '', out)
    return agentCliOk(renderMatches(out))
  },
}

async function listAllWorkflows(runtime: AgentCliRuntime): Promise<ListWorkflowsResponse['data']> {
  const rows: ListWorkflowsResponse['data'] = []
  let cursor: string | null = null
  do {
    const page: ListWorkflowsResponse = await runtime.client.request<ListWorkflowsResponse>(
      '/api/v2/workflows',
      { query: { workspaceId: runtime.workspaceId, ...(cursor ? { cursor } : {}) } }
    )
    rows.push(...page.data)
    cursor = page.nextCursor
  } while (cursor)
  return rows
}

export const workflowsGrepCommand: AgentCliCommand = {
  path: ['workflows', 'grep'],
  summary: 'Search every workflow in the workspace for a pattern',
  usage: 'workflows grep <pattern>',
  async execute(rest, runtime) {
    const pattern = rest.join(' ')
    if (!pattern) return agentCliFail('Usage: sim workflows grep <pattern>')
    const matches = compilePattern(pattern)
    const workflows = await listAllWorkflows(runtime)
    const out: string[] = []
    for (let i = 0; i < workflows.length && out.length < MAX_MATCHES; i += EXPORT_CONCURRENCY) {
      const batch = workflows.slice(i, i + EXPORT_CONCURRENCY)
      const states = await Promise.all(
        batch.map(async (workflow) => {
          try {
            return { workflow, state: await fetchWorkflowState(runtime, workflow.id) }
          } catch {
            // One unexportable workflow must not sink the whole search.
            return { workflow, state: null }
          }
        })
      )
      for (const { workflow, state } of states) {
        const label = `${workflow.name} (${workflow.id})`
        if (matches(workflow.name) && out.length < MAX_MATCHES) out.push(`${label}: name matches`)
        if (state) grepTree(state, matches, label, out)
      }
    }
    return agentCliOk(renderMatches(out))
  },
}
