import {
  normalizeWorkflowBlockName,
  RESERVED_WORKFLOW_BLOCK_NAMES,
  type WorkflowState,
  wouldCreateCycle,
} from '@sim/workflow-types/workflow'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { collidingNamesArbitrary, jsCodeBodyArbitrary, workflowStateArbitrary } from './arbitraries'

/** Every structural invariant a stored graph holds; returns the first violation or null. */
function structuralViolation(state: WorkflowState): string | null {
  const keys = new Set<string>()
  for (const block of Object.values(state.blocks)) {
    const key = normalizeWorkflowBlockName(block.name)
    if (!key) return `empty key for ${block.name}`
    if ((RESERVED_WORKFLOW_BLOCK_NAMES as readonly string[]).includes(key)) return `reserved ${key}`
    if (keys.has(key)) return `duplicate key ${key}`
    keys.add(key)
    const parentId = block.data?.parentId
    if (parentId) {
      const parent = state.blocks[parentId]
      if (!parent || (parent.type !== 'loop' && parent.type !== 'parallel')) {
        return `bad parent for ${block.name}`
      }
      const container = state.loops[parentId] ?? state.parallels[parentId]
      if (!container?.nodes.includes(block.id)) return `${block.name} missing from container nodes`
    }
  }
  const accepted: Array<{ source: string; target: string }> = []
  for (const edge of state.edges) {
    const source = state.blocks[edge.source]
    const target = state.blocks[edge.target]
    if (!source || !target) return `dangling edge ${edge.id}`
    const startEdge = edge.sourceHandle?.endsWith('-start-source') === true
    if (startEdge) {
      if (target.data?.parentId !== source.id) return `start edge leaves its container ${edge.id}`
    } else if ((source.data?.parentId ?? null) !== (target.data?.parentId ?? null)) {
      return `cross-scope edge ${edge.id}`
    }
    if (target.type === 'start_trigger') return `edge into the trigger ${edge.id}`
    if (wouldCreateCycle(accepted, edge.source, edge.target)) return `cycle at ${edge.id}`
    accepted.push({ source: edge.source, target: edge.target })
  }
  return null
}

describe('workflowStateArbitrary', () => {
  it('only generates structurally valid graphs', () => {
    fc.assert(
      fc.property(workflowStateArbitrary({ maxBlocks: 10, maxDepth: 3 }), (state) => {
        expect(structuralViolation(state)).toBeNull()
      }),
      { numRuns: 300, seed: 20261115 }
    )
  })

  it('reaches nested containers', () => {
    const samples = fc.sample(workflowStateArbitrary({ maxBlocks: 10, maxDepth: 3 }), {
      numRuns: 300,
      seed: 7,
    })
    const nested = samples.some((state) =>
      Object.values(state.blocks).some((block) => {
        const parent = block.data?.parentId ? state.blocks[block.data.parentId] : undefined
        return (
          (block.type === 'loop' || block.type === 'parallel') && Boolean(parent?.data?.parentId)
        )
      })
    )
    expect(nested).toBe(true)
  })
})

describe('collidingNamesArbitrary', () => {
  it('yields distinct names with one normalized key', () => {
    fc.assert(
      fc.property(collidingNamesArbitrary(), ([a, b]) => {
        expect(a).not.toBe(b)
        expect(normalizeWorkflowBlockName(a)).toBe(normalizeWorkflowBlockName(b))
      }),
      { numRuns: 200, seed: 1 }
    )
  })
})

describe('jsCodeBodyArbitrary', () => {
  it('puts references in code, quote, template and comment positions', () => {
    const bodies = fc.sample(jsCodeBodyArbitrary(['agent1']), { numRuns: 400, seed: 3 }).join('\n')
    expect(bodies).toMatch(/= <agent1\./)
    expect(bodies).toMatch(/'<agent1\.[^']*'/)
    expect(bodies).toMatch(/"<agent1\.[^"]*"/)
    expect(bodies).toMatch(/`\$\{<agent1\./)
    expect(bodies).toMatch(/\/\/ <agent1\./)
    expect(bodies).toMatch(/<agent1\.[^>]*> <3/)
  })
})
