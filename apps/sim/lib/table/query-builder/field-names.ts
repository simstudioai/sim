/**
 * Column names an authored filter or sort names, read from untrusted JSON.
 *
 * Shared by the surfaces that check authored Table-block JSON against a real
 * schema without executing it: workflow lint (does every field name a column?)
 * and column rename (which blocks still name the old column?). Tolerant by
 * design — a malformed node contributes nothing rather than throwing, since
 * these are advisory readers of persisted block state.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Every `field` a predicate tree names, in document order: a bare
 * `{ field, op, value }` condition, or nested `{ all | any: [...] }` groups.
 * Iterative so a deep tree cannot overflow the stack.
 */
export function collectPredicateFieldNames(root: unknown): string[] {
  const names: string[] = []
  const stack: unknown[] = [root]
  const visitLater = (members: readonly unknown[]) => {
    for (let index = members.length - 1; index >= 0; index -= 1) stack.push(members[index])
  }
  while (stack.length > 0) {
    const node = stack.pop()
    if (Array.isArray(node)) {
      visitLater(node)
      continue
    }
    if (!isRecord(node)) continue
    if (typeof node.field === 'string') names.push(node.field)
    if (Array.isArray(node.any)) visitLater(node.any)
    if (Array.isArray(node.all)) visitLater(node.all)
  }
  return names
}

/**
 * Every column a sort names: the `field` of each `[{ field, direction }]`
 * entry, or the keys of a `{ column: direction }` record.
 */
export function collectSortFieldNames(root: unknown): string[] {
  if (Array.isArray(root)) {
    return root.flatMap((entry) =>
      isRecord(entry) && typeof entry.field === 'string' ? [entry.field] : []
    )
  }
  return isRecord(root) ? Object.keys(root) : []
}
