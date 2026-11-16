import { compareStrings } from '@sim/utils/string'
import type { BlockKey } from '../model'

interface OrderNode {
  key: BlockKey
  isTrigger: boolean
  /** Lock / source meta order; absent sorts last. */
  order: number | undefined
}

export interface OrderDependency {
  before: BlockKey
  after: BlockKey
  /**
   * A ref dependency: declaring `after` first would be TS2448, so the printer literalizes the ref
   * when a cycle forces it. Edge dependencies are soft and only shape the reading order.
   */
  hard: boolean
}

function compareNodes(a: OrderNode, b: OrderNode): number {
  if (a.isTrigger !== b.isTrigger) return a.isTrigger ? -1 : 1
  const ao = a.order ?? Number.POSITIVE_INFINITY
  const bo = b.order ?? Number.POSITIVE_INFINITY
  if (ao !== bo) return ao < bo ? -1 : 1
  return compareStrings(a.key, b.key)
}

/**
 * Declaration order for one scope: Kahn's algorithm whose ready queue is keyed by
 * (trigger first, lock order, key). When every remaining node waits on another (a cycle),
 * the smallest node with no unmet hard dependency goes next, else the smallest node outright; the
 * caller literalizes the refs that end up pointing forward.
 */
export function declarationOrder(nodes: OrderNode[], dependencies: OrderDependency[]): BlockKey[] {
  const byKey = new Map(nodes.map((node) => [node.key, node]))
  const hardIn = new Map<BlockKey, number>()
  const softIn = new Map<BlockKey, number>()
  const outgoing = new Map<BlockKey, OrderDependency[]>()
  for (const node of nodes) {
    hardIn.set(node.key, 0)
    softIn.set(node.key, 0)
    outgoing.set(node.key, [])
  }
  const seen = new Set<string>()
  for (const dep of dependencies) {
    if (dep.before === dep.after || !byKey.has(dep.before) || !byKey.has(dep.after)) continue
    const id = `${dep.hard ? 'h' : 's'}\u0000${dep.before}\u0000${dep.after}`
    if (seen.has(id)) continue
    seen.add(id)
    const counts = dep.hard ? hardIn : softIn
    counts.set(dep.after, (counts.get(dep.after) ?? 0) + 1)
    outgoing.get(dep.before)?.push(dep)
  }

  const remaining = [...nodes].sort(compareNodes)
  const result: BlockKey[] = []
  while (remaining.length > 0) {
    let index = remaining.findIndex(
      (node) => (hardIn.get(node.key) ?? 0) === 0 && (softIn.get(node.key) ?? 0) === 0
    )
    if (index === -1) index = remaining.findIndex((node) => (hardIn.get(node.key) ?? 0) === 0)
    if (index === -1) index = 0
    const [next] = remaining.splice(index, 1)
    if (!next) break
    result.push(next.key)
    for (const dep of outgoing.get(next.key) ?? []) {
      const counts = dep.hard ? hardIn : softIn
      counts.set(dep.after, (counts.get(dep.after) ?? 0) - 1)
    }
  }
  return result
}
