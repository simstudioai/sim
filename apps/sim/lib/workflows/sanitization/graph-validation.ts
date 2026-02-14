export interface GraphCycleDetectionResult {
  hasCycle: boolean
  cyclePath: string[]
}

function buildAdjacency(edges: Array<{ source?: string; target?: string }>): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>()

  for (const edge of edges || []) {
    const source = String(edge?.source || '').trim()
    const target = String(edge?.target || '').trim()
    if (!source || !target) continue

    if (!adjacency.has(source)) adjacency.set(source, new Set())
    if (!adjacency.has(target)) adjacency.set(target, new Set())
    adjacency.get(source)!.add(target)
  }

  return adjacency
}

/**
 * Detects directed graph cycles using DFS color marking.
 * Returns the first detected cycle path in node-id order.
 */
export function detectDirectedCycle(
  edges: Array<{ source?: string; target?: string }>
): GraphCycleDetectionResult {
  const adjacency = buildAdjacency(edges)
  const color = new Map<string, 0 | 1 | 2>() // 0=unvisited,1=visiting,2=done
  const stack: string[] = []
  let detectedPath: string[] = []

  const dfs = (node: string): boolean => {
    color.set(node, 1)
    stack.push(node)

    const neighbors = adjacency.get(node) || new Set<string>()
    for (const next of neighbors) {
      const nextColor = color.get(next) || 0
      if (nextColor === 0) {
        if (dfs(next)) return true
        continue
      }
      if (nextColor === 1) {
        const startIndex = stack.lastIndexOf(next)
        if (startIndex >= 0) {
          detectedPath = [...stack.slice(startIndex), next]
        } else {
          detectedPath = [node, next, node]
        }
        return true
      }
    }

    stack.pop()
    color.set(node, 2)
    return false
  }

  for (const node of adjacency.keys()) {
    if ((color.get(node) || 0) !== 0) continue
    if (dfs(node)) {
      return {
        hasCycle: true,
        cyclePath: detectedPath,
      }
    }
  }

  return {
    hasCycle: false,
    cyclePath: [],
  }
}

