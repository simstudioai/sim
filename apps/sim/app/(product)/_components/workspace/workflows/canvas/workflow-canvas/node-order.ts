interface OrderableNode {
  id: string
  parentId?: string
}

/**
 * Returns the nodes with every container ahead of its descendants, otherwise
 * in their original order. An array that already satisfies that is returned
 * as-is, and a reorder sorts a copy — the caller's array is never sorted in
 * place, which matters because the editor hands React state straight in.
 *
 * React Flow v12 adopts nodes in one pass over the array and resolves a child's
 * absolute position against the parent it has *already* adopted; a child that
 * precedes its parent is placed at its parent-relative offset as if that were
 * absolute (and logged as "Parent node not found"). Adoption reruns whenever a
 * node object changes identity — every click rebuilds them — and the misplaced
 * card is only corrected by the next measurement pass, so it sits over the
 * top-left of the canvas until something resizes it. v11 resolved positions in
 * a second pass and never cared about order. The editor's block record is in
 * database row order, which puts a block ahead of a container it was later
 * dragged into.
 */
export function sortNodesParentsFirst<T extends OrderableNode>(nodes: T[]): T[] {
  const indexById = new Map<string, number>()
  for (let index = 0; index < nodes.length; index++) {
    indexById.set(nodes[index].id, index)
  }

  let ordered = true
  for (let index = 0; index < nodes.length && ordered; index++) {
    const parentId = nodes[index].parentId
    if (!parentId) continue
    const parentIndex = indexById.get(parentId)
    if (parentIndex !== undefined && parentIndex > index) ordered = false
  }
  if (ordered) return nodes

  const depthById = new Map<string, number>()
  const depthOf = (node: T): number => {
    const cached = depthById.get(node.id)
    if (cached !== undefined) return cached
    let depth = 0
    const visited = new Set<string>([node.id])
    let parentId = node.parentId
    while (parentId && !visited.has(parentId)) {
      const parentIndex = indexById.get(parentId)
      if (parentIndex === undefined) break
      visited.add(parentId)
      depth++
      parentId = nodes[parentIndex].parentId
    }
    depthById.set(node.id, depth)
    return depth
  }

  return [...nodes].sort((a, b) => depthOf(a) - depthOf(b))
}
