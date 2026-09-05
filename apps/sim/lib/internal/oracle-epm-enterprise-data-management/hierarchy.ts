import type {
  EdmHierarchyFrontier,
  EdmHierarchyNode,
  EdmNode,
} from '@/lib/internal/oracle-epm-enterprise-data-management/types'

interface HierarchyBounds {
  maxDepth: number
  maxNodes: number
  pageSize: number
  maxRequests: number
}

const MAX_HIERARCHY_NODE_BYTES = 5 * 1024 * 1024

/** A bounded breadth-first traversal; a node ID alone is never an occurrence identity. */
export async function browseEdmHierarchy(
  bounds: HierarchyBounds,
  readPage: (
    frontier: EdmHierarchyFrontier,
    limit: number
  ) => Promise<{ items: EdmNode[]; hasMore?: boolean | null }>,
  signal?: AbortSignal
) {
  const queue: EdmHierarchyFrontier[] = [
    { parentNodeId: null, parentLocation: null, path: [], depth: 0, offset: 0 },
  ]
  const remainingFrontier: EdmHierarchyFrontier[] = []
  const nodes: EdmHierarchyNode[] = []
  const seen = new Set<string>()
  const reasons = new Set<string>()
  let providerRequests = 0
  let projectedBytes = 2
  while (queue.length) {
    signal?.throwIfAborted()
    if (nodes.length >= bounds.maxNodes) {
      reasons.add('nodes')
      break
    }
    if (providerRequests >= bounds.maxRequests) {
      reasons.add('provider-requests')
      break
    }
    const frontier = queue.shift()!
    if (frontier.depth > bounds.maxDepth) {
      remainingFrontier.push(frontier)
      reasons.add('depth')
      continue
    }
    const limit = Math.min(bounds.pageSize, bounds.maxNodes - nodes.length)
    const page = await readPage(frontier, limit)
    providerRequests += 1
    signal?.throwIfAborted()
    let added = 0
    let byteLimited = false
    for (const [index, node] of page.items.slice(0, limit).entries()) {
      const key = JSON.stringify([frontier.path, node.id, node.parentNodeId, node.location])
      if (seen.has(key)) continue
      const path = [...frontier.path, node.id]
      const occurrence = {
        ...node,
        depth: frontier.depth,
        traversalPath: path,
        traversalParentLocation: frontier.parentLocation,
      }
      const bytes = Buffer.byteLength(JSON.stringify(occurrence), 'utf8') + 1
      if (projectedBytes + bytes > MAX_HIERARCHY_NODE_BYTES) {
        reasons.add('output-bytes')
        queue.unshift({ ...frontier, offset: frontier.offset + index })
        byteLimited = true
        break
      }
      seen.add(key)
      projectedBytes += bytes
      nodes.push(occurrence)
      added += 1
      if (node.hasChildren === false || node.childCount === 0) continue
      const next = {
        parentNodeId: node.id,
        parentLocation: path.join(','),
        path,
        depth: frontier.depth + 1,
        offset: 0,
      }
      if (frontier.path.includes(node.id)) {
        reasons.add('cycle')
        remainingFrontier.push(next)
      } else {
        queue.push(next)
      }
    }
    if (byteLimited) break
    const hasMore = page.hasMore ?? page.items.length >= limit
    if (hasMore || page.items.length > limit) {
      const next = { ...frontier, offset: frontier.offset + Math.min(page.items.length, limit) }
      if (added === 0) {
        reasons.add('repeated-page')
        remainingFrontier.push(next)
      } else {
        queue.unshift(next)
      }
    }
  }
  remainingFrontier.push(...queue)
  return {
    nodes,
    count: nodes.length,
    providerRequests,
    truncated: remainingFrontier.length > 0,
    truncationReasons: [...reasons],
    remainingFrontier,
  }
}
