import { isPlainRecord } from '@sim/utils/object'
import { fetchWorkflowState } from '@/lib/mothership/agent-cli/engines/workflow-state'
import { type AgentCliEngine, agentCliFail, agentCliOk } from '@/lib/mothership/agent-cli/types'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
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
 *
 * Graph predecessors are listed alongside the token references: run_block's
 * validation (`validateRunFromBlock`) requires every block with an edge into the
 * target to have executed, whether or not the target reads its output by token,
 * so a parent the block never references still needs a mock.
 */

// The executor's own token grammars — this command must classify exactly what
// the runtime resolves, never a private re-invention of the syntax.
const TEMPLATE_REF = createReferencePattern()
const ENV_REF = createEnvVarPattern()

/** Block types that run a child workflow and hand back its Response block's envelope. */
const CHILD_WORKFLOW_BLOCK_TYPES: ReadonlySet<string> = new Set(['workflow', 'workflow_input'])
const CHILD_RETURNS_NOTE =
  "A child workflow's result is its Response block's envelope {data, status, headers}; fields live at result.data.<field>, so mock and read them there."
const MOCK_NOTE = 'variableInputs: fill each null with the value the block would output'

/**
 * A null-leaved object nested along each dotted path — the shape run_block's
 * variableInputs expects for that block, ready to paste and fill in. A path read
 * both whole and drilled into (`result` and `result.tier`) keeps the deeper shape.
 */
function skeletonFromPaths(paths: readonly string[]): Record<string, unknown> {
  const skeleton: Record<string, unknown> = {}
  for (const path of paths) {
    const segments = path.split('.').filter(Boolean)
    let cursor = skeleton
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index]
      if (index === segments.length - 1) {
        if (!(segment in cursor)) cursor[segment] = null
        break
      }
      const existing = cursor[segment]
      const next = isPlainRecord(existing) ? existing : {}
      cursor[segment] = next
      cursor = next
    }
  }
  return skeleton
}

interface DepView {
  token: string
  kind: 'block' | 'loop' | 'parallel' | 'variable' | 'env' | 'unknown'
  blockId?: string
  blockName?: string
  paths?: string[]
}

interface PredecessorView {
  blockId: string
  blockName?: string
  sourceHandle?: string
}

interface StateEdge {
  source?: unknown
  target?: unknown
  sourceHandle?: unknown
}

function isTriggerBlock(block: Record<string, unknown>): boolean {
  return (
    typeof block.type === 'string' &&
    TriggerUtils.isTriggerBlock({ type: block.type, triggerMode: block.triggerMode === true })
  )
}

/** Blocks with an edge into `blockId`, minus entry/trigger blocks and the block itself. */
function collectPredecessors(
  state: Record<string, unknown>,
  blocks: Record<string, Record<string, unknown>>,
  blockId: string,
  idToName: ReadonlyMap<string, string>
): PredecessorView[] {
  const edges = Array.isArray(state.edges) ? (state.edges as StateEdge[]) : []
  const seen = new Set<string>()
  const predecessors: PredecessorView[] = []
  for (const edge of edges) {
    const source = edge.source
    if (typeof source !== 'string' || edge.target !== blockId || source === blockId) continue
    const sourceBlock = blocks[source]
    if (!sourceBlock || seen.has(source) || isTriggerBlock(sourceBlock)) continue
    seen.add(source)
    predecessors.push({
      blockId: source,
      blockName: idToName.get(source),
      ...(typeof edge.sourceHandle === 'string' ? { sourceHandle: edge.sourceHandle } : {}),
    })
  }
  return predecessors
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
    const predecessors = collectPredecessors(state, blocks, blockId, idToName)

    // Paste-ready skeleton for run_block's variableInputs: mock each upstream
    // block's output at the paths this block actually reads, and every graph
    // parent it never reads at all — run_block refuses to start without them.
    const mock: Record<string, Record<string, unknown>> = Object.fromEntries(
      blockDeps.map((d) => [d.blockName ?? d.blockId, skeletonFromPaths(d.paths ?? [])])
    )
    for (const predecessor of predecessors) {
      const key = predecessor.blockName ?? predecessor.blockId
      if (!mock[key]) mock[key] = {}
    }
    const unshapedMocks = Object.entries(mock)
      .filter(([, shape]) => Object.keys(shape).length === 0)
      .map(([name]) => name)

    const upstreamIds = new Set<string>()
    for (const dep of blockDeps) if (dep.blockId) upstreamIds.add(dep.blockId)
    for (const predecessor of predecessors) upstreamIds.add(predecessor.blockId)
    const childReturns = [...upstreamIds]
      .filter((id) => {
        const type = blocks[id]?.type
        return typeof type === 'string' && CHILD_WORKFLOW_BLOCK_TYPES.has(type)
      })
      .map((id) => ({ blockId: id, blockName: idToName.get(id), note: CHILD_RETURNS_NOTE }))

    return agentCliOk(
      JSON.stringify(
        {
          blockId,
          blockName: idToName.get(blockId),
          references: deps,
          predecessors,
          env: [...envs].sort(),
          mock,
          mockNote: MOCK_NOTE,
          ...(unshapedMocks.length
            ? {
                mockEmptyNote: `${unshapedMocks.join(', ')}: mocked as {} because no field of their output is read here — run_block only needs the entry present.`,
              }
            : {}),
          ...(childReturns.length ? { childReturns } : {}),
        },
        null,
        2
      )
    )
  },
}
