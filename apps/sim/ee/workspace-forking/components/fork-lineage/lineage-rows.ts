import type { ForkForestNode } from '@/lib/api/contracts/workspace-fork'
import type { ForkTableRail } from '@/ee/workspace-forking/components/fork-table'

/** One rendered row of the lineage tree: a node, its tree connectors, and its parent. */
export interface ForkLineageRow {
  node: ForkForestNode
  /** Tree connectors, root-first. Empty on a root row. */
  rails: ForkTableRail[]
  /** The node's parent, when the forest carries it. */
  parent: ForkForestNode | null
}

/**
 * Narrow a forest to the nodes matching `matches`, keeping every ancestor of a match.
 *
 * A tree filtered by matches alone loses the path to them, so a search for a fork would render it
 * as a root and quietly misstate the lineage. Keeping ancestors preserves the shape at the cost of
 * showing rows that do not themselves match, which is the trade every file tree makes.
 */
function retainMatchesWithAncestors(
  nodes: ForkForestNode[],
  matches: (node: ForkForestNode) => boolean
): ForkForestNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const keep = new Set<string>()
  for (const node of nodes) {
    if (!matches(node)) continue
    let cursor: ForkForestNode | undefined = node
    while (cursor && !keep.has(cursor.id)) {
      keep.add(cursor.id)
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
    }
  }
  return nodes.filter((node) => keep.has(node.id))
}

/**
 * Lay a flat, depth-first forest out as table rows with tree connectors.
 *
 * The server already orders nodes depth-first, so sibling order here is the order they arrive in;
 * all this adds is each row's rails — which ancestors still have a subtree below them, and whether
 * the row itself is its parent's last child.
 */
export function buildForkLineageRows(
  nodes: ForkForestNode[],
  matches?: (node: ForkForestNode) => boolean
): ForkLineageRow[] {
  const visible = matches ? retainMatchesWithAncestors(nodes, matches) : nodes
  const byId = new Map(visible.map((node) => [node.id, node]))

  /** Parent id to its children in arrival order; `null` groups the visible roots. */
  const siblings = new Map<string | null, string[]>()
  for (const node of visible) {
    const parentKey = node.parentId && byId.has(node.parentId) ? node.parentId : null
    const group = siblings.get(parentKey)
    if (group) group.push(node.id)
    else siblings.set(parentKey, [node.id])
  }

  const isLastChild = (node: ForkForestNode): boolean => {
    const parentKey = node.parentId && byId.has(node.parentId) ? node.parentId : null
    const group = siblings.get(parentKey) ?? []
    return group[group.length - 1] === node.id
  }

  /** Root-first ancestor chain, ending at the node itself. */
  const chainOf = (node: ForkForestNode): ForkForestNode[] => {
    const chain: ForkForestNode[] = []
    let cursor: ForkForestNode | undefined = node
    while (cursor) {
      chain.unshift(cursor)
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
    }
    return chain
  }

  return visible.map((node) => {
    const chain = chainOf(node)
    const rails: ForkTableRail[] = chain
      .slice(1)
      .map((step, index, own) =>
        index === own.length - 1
          ? isLastChild(step)
            ? 'last-branch'
            : 'branch'
          : isLastChild(step)
            ? 'blank'
            : 'line'
      )
    return {
      node,
      rails,
      parent: node.parentId ? (byId.get(node.parentId) ?? null) : null,
    }
  })
}

/** The root of the lineage a workspace belongs to, or the workspace itself when it is one. */
export function forkLineageRootId(nodes: ForkForestNode[], workspaceId: string): string | null {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  let cursor = byId.get(workspaceId)
  if (!cursor) return null
  while (cursor.parentId) {
    const parent = byId.get(cursor.parentId)
    if (!parent) break
    cursor = parent
  }
  return cursor.id
}

/** Every root in the forest, for the lineage picker. */
export function forkLineageRoots(nodes: ForkForestNode[]): ForkForestNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return nodes.filter((node) => !node.parentId || !byId.has(node.parentId))
}
