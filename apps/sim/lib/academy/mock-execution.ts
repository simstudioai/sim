import type { ExerciseBlockState, ExerciseEdgeState, MockBlockOutput } from '@/lib/academy/types'

export interface MockExecutionStep {
  blockId: string
  blockType: string
  output: Record<string, unknown>
  delay: number
}

/**
 * Builds a topologically-ordered list of execution steps for mock execution.
 * Blocks without incoming edges run first; downstream blocks follow.
 */
export function buildMockExecutionPlan(
  blocks: ExerciseBlockState[],
  edges: ExerciseEdgeState[],
  mockOutputs: Record<string, MockBlockOutput>
): MockExecutionStep[] {
  const steps: MockExecutionStep[] = []
  const visited = new Set<string>()
  const adjacency = new Map<string, string[]>()
  const inDegree = new Map<string, number>()
  const blockMap = new Map(blocks.map((b) => [b.id, b]))

  for (const block of blocks) {
    adjacency.set(block.id, [])
    inDegree.set(block.id, 0)
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target)
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
  }

  // Kahn's topological sort
  const queue: string[] = []
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id)
  }

  while (queue.length > 0) {
    const blockId = queue.shift()!
    if (visited.has(blockId)) continue
    visited.add(blockId)

    const block = blockMap.get(blockId)
    if (!block) continue

    // Resolve mock output: prefer block-id-keyed, fall back to block-type-keyed
    const mockOutput = mockOutputs[blockId] ?? mockOutputs[block.type]

    steps.push({
      blockId,
      blockType: block.type,
      output: mockOutput?.response ?? { result: '(no output defined)' },
      delay: mockOutput?.delay ?? 800,
    })

    for (const neighbor of adjacency.get(blockId) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 0) - 1
      inDegree.set(neighbor, newDegree)
      if (newDegree === 0) queue.push(neighbor)
    }
  }

  return steps
}
