export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace'
  path: string
  value?: unknown
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function arrayIndexForSegment(target: unknown[], segment: string): number {
  const byId = target.findIndex((element) => recordValue(element)?.id === segment)
  if (byId !== -1) return byId
  const index = Number(segment)
  return Number.isInteger(index) && index >= 0 && index < target.length ? index : -1
}

function arrayElementForSegment(target: unknown[], segment: string): unknown {
  const index = arrayIndexForSegment(target, segment)
  return index === -1 ? undefined : target[index]
}

/** Applies the Connect API's ID-aware RFC6902 path semantics. */
export function applyOnePasswordPatch(
  item: Record<string, unknown>,
  operation: JsonPatchOperation
): void {
  const segments = operation.path.split('/').filter(Boolean)
  const rootKey = segments[0]
  if (!rootKey) return

  if (segments.length === 1) {
    if (operation.op === 'replace' || operation.op === 'add') {
      item[rootKey] = operation.value
    } else {
      delete item[rootKey]
    }
    return
  }

  let target: unknown = item
  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index]
    if (!segment) return
    if (Array.isArray(target)) {
      target = arrayElementForSegment(target, segment)
    } else {
      target = recordValue(target)?.[segment]
    }
    if (target === undefined || target === null) return
  }

  const lastSegment = segments.at(-1)
  if (!lastSegment) return

  if (operation.op === 'replace' || operation.op === 'add') {
    if (Array.isArray(target) && lastSegment === '-') {
      target.push(operation.value)
    } else if (Array.isArray(target)) {
      const index = arrayIndexForSegment(target, lastSegment)
      if (index !== -1) target[index] = operation.value
    } else {
      const record = recordValue(target)
      if (record) record[lastSegment] = operation.value
    }
    return
  }

  if (Array.isArray(target)) {
    const index = arrayIndexForSegment(target, lastSegment)
    if (index !== -1) target.splice(index, 1)
  } else {
    const record = recordValue(target)
    if (record) delete record[lastSegment]
  }
}
