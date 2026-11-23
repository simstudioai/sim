/** Marks each person whose proposed reporting path enters a cycle, visiting each member once. */
export function findCyclicPaths(managers: ReadonlyMap<string, string | null>) {
  const resolved = new Set<string>()
  const cyclic = new Set<string>()
  for (const id of managers.keys()) {
    if (resolved.has(id)) continue
    const path = new Set<string>()
    let next: string | null = id
    while (next && !resolved.has(next) && !path.has(next)) {
      path.add(next)
      next = managers.get(next) ?? null
    }
    const reachesCycle = next !== null && (path.has(next) || cyclic.has(next))
    for (const memberId of path) {
      resolved.add(memberId)
      if (reachesCycle) cyclic.add(memberId)
    }
  }
  return cyclic
}
