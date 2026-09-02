import { fetchWorkflowState } from '@/lib/mothership/agent-cli/engines/workflow-views'
import { type AgentCliEngine, agentCliFail, agentCliOk } from '@/lib/mothership/agent-cli/types'
import { normalizeName, SPECIAL_REFERENCE_PREFIXES } from '@/executor/constants'
import {
  collectStringLeaves,
  createEnvVarPattern,
  createReferencePattern,
} from '@/executor/utils/reference-validation'

/**
 * `workflow deps <workflowId> <blockId>` — everything one block consumes, so the
 * agent knows exactly what to mock before running it in isolation with
 * run_block's variableInputs. Tokens are extracted with the same shapes the
 * executor resolves (`<ref.path>` templates, `{{ENV}}` secrets) and block heads
 * are matched through the executor's own name normalization — this command must
 * never re-invent resolution semantics.
 */

// The executor's own token grammars — this command must classify exactly what
// the runtime resolves, never a private re-invention of the syntax.
const TEMPLATE_REF = createReferencePattern()
const ENV_REF = createEnvVarPattern()

interface DepView {
  token: string
  kind: 'block' | 'loop' | 'parallel' | 'variable' | 'env' | 'unknown'
  blockId?: string
  blockName?: string
  paths?: string[]
}

export const workflowDepsCommand: AgentCliEngine = {
  async execute(rest, runtime) {
    const [workflowId, blockId] = rest
    if (!workflowId || !blockId)
      return agentCliFail('Usage: sim workflow deps <workflowId> <blockId>')
    const state = await fetchWorkflowState(runtime, workflowId)
    const blocks = (state.blocks ?? {}) as Record<string, Record<string, unknown>>
    const block = blocks[blockId]
    if (!block) return agentCliFail(`No block ${blockId} in workflow ${workflowId}`)

    const nameToId = new Map<string, string>()
    const idToName = new Map<string, string>()
    for (const [id, raw] of Object.entries(blocks)) {
      const name = typeof raw.name === 'string' ? raw.name : undefined
      if (name) {
        nameToId.set(normalizeName(name), id)
        idToName.set(id, name)
      }
    }

    const leaves: string[] = []
    collectStringLeaves(block.subBlocks ?? block, leaves)

    const byToken = new Map<string, DepView>()
    const envs = new Set<string>()
    for (const leaf of leaves) {
      for (const match of leaf.matchAll(TEMPLATE_REF)) {
        const token = match[1]
        if (!token || byToken.has(token)) continue
        const [head = '', ...pathParts] = token.split('.')
        const path = pathParts.join('.')
        const special = (SPECIAL_REFERENCE_PREFIXES as readonly string[]).includes(head)
        if (special) {
          byToken.set(token, { token, kind: head as 'loop' | 'parallel' | 'variable' })
          continue
        }
        const refBlockId = blocks[head] ? head : nameToId.get(normalizeName(head))
        if (refBlockId && refBlockId !== blockId) {
          const existing = [...byToken.values()].find((d) => d.blockId === refBlockId)
          if (existing) {
            if (path && !existing.paths?.includes(path)) existing.paths?.push(path)
            byToken.set(token, existing)
          } else {
            byToken.set(token, {
              token,
              kind: 'block',
              blockId: refBlockId,
              blockName: idToName.get(refBlockId),
              paths: path ? [path] : [],
            })
          }
        } else if (!refBlockId) {
          byToken.set(token, { token, kind: 'unknown' })
        }
      }
      for (const match of leaf.matchAll(ENV_REF)) {
        const key = match[1]?.trim()
        if (key) envs.add(key)
      }
    }

    const deps = [...new Set(byToken.values())]
    const blockDeps = deps.filter((d) => d.kind === 'block')
    return agentCliOk(
      JSON.stringify(
        {
          blockId,
          blockName: idToName.get(blockId),
          references: deps,
          env: [...envs].sort(),
          // Ready-made skeleton for run_block's variableInputs: mock each upstream
          // block's output at the paths this block actually reads.
          mock: Object.fromEntries(
            blockDeps.map((d) => [
              d.blockName ?? d.blockId,
              d.paths?.length ? d.paths : ['<output>'],
            ])
          ),
        },
        null,
        2
      )
    )
  },
}
