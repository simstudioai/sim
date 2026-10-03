import {
  type AgentCliEngine,
  type AgentCliFlags,
  agentCliFail,
  agentCliOk,
} from '@/lib/mothership/agent-cli/types'
import { prepareCopilotEnvironmentContext } from '@/lib/mothership/environment-context'
import { searchDocsServerTool } from '@/lib/mothership/tools/server/docs/search-docs'

const DEFAULT_TOP = 6
const MAX_TOP = 20

function topFrom(flags: AgentCliFlags): number | string {
  const raw = flags.top
  if (raw === undefined || raw === true) return DEFAULT_TOP
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return '--top needs a positive number'
  return Math.min(n, MAX_TOP)
}

/**
 * `docs search <query> [--top n] [--path prefix]` — the product docs, through the same
 * engine the `search_docs` tool used, as a noun in the CLI grammar (18-agent-surface.md
 * A3). One knowledge surface: the tips corpus merges into these pages over time.
 */
export const docsSearchCommand: AgentCliEngine = {
  async execute(positionals, runtime, flags) {
    const query = positionals.join(' ').trim()
    if (!query) return agentCliFail('Usage: sim docs search <query> [--top n] [--path prefix]')
    const top = topFrom(flags)
    if (typeof top === 'string') return agentCliFail(top)
    const path = typeof flags.path === 'string' ? flags.path : undefined
    const { resolvedSecretTraceRegistry } = await prepareCopilotEnvironmentContext(
      runtime.userId,
      runtime.workspaceId
    )
    const output = await searchDocsServerTool.execute(
      { query, topK: top, ...(path ? { path } : {}) },
      { userId: runtime.userId, workspaceId: runtime.workspaceId, resolvedSecretTraceRegistry }
    )
    return agentCliOk(JSON.stringify(output, null, 2))
  },
}
