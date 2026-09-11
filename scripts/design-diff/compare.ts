import { createHash } from 'node:crypto'
import { pureMovement } from '#design-diff/movement'
import { changedCategory } from '#design-diff/policy'
import type { Change, Definition } from '#design-diff/types'

function signature(definition: Definition) {
  return JSON.stringify([definition.value, definition.conditions])
}

export function finding(
  before: Definition | undefined,
  after: Definition | undefined,
  reason?: string
): Change {
  const definition = after ?? before
  if (!definition) throw new Error('Finding needs evidence')
  const unresolved = [
    ...new Set([...(before?.unresolved ?? []), ...(after?.unresolved ?? [])]),
  ].sort()
  const movement = before && after && pureMovement(before, after)
  const category = changedCategory(before, after)
  const uncertain =
    unresolved.length ||
    definition.kind === 'review' ||
    ['movement', 'unresolved'].includes(category)
  const result: Omit<Change, 'id'> = {
    decision: movement ? 'exempt' : 'flag',
    category: movement ? 'movement' : category,
    reason:
      reason ??
      (movement
        ? 'Static geometry establishes movement within unchanged bounds'
        : uncertain
          ? 'Potential visual effect; static evidence is incomplete'
          : 'Visual definition changed'),
    before: before
      ? {
          value: before.value,
          location: before.location,
          conditions: before.conditions,
          property: before.property,
        }
      : null,
    after: after
      ? {
          value: after.value,
          location: after.location,
          conditions: after.conditions,
          property: after.property,
        }
      : null,
    symbol: definition.symbol,
    consumers: [
      ...new Set(
        [before?.location.file, after?.location.file].filter((file): file is string => !!file)
      ),
    ].sort(),
    dependencies: [
      ...new Set([
        ...(before?.dependencies ?? []),
        ...(after?.dependencies ?? []),
        definition.location.file,
      ]),
    ].sort(),
    limitations: unresolved,
  }
  return {
    id: createHash('sha256').update(JSON.stringify(result)).digest('hex').slice(0, 24),
    ...result,
  }
}

export function compareDefinitions(
  before: Definition[],
  after: Definition[],
  changed: Set<string>
): Change[] {
  const previous = new Map(before.map((definition) => [definition.key, definition]))
  const next = new Map(after.map((definition) => [definition.key, definition]))
  const result: Change[] = []
  const reviewedDependencies = new Set<string>()
  for (const key of [...new Set([...previous.keys(), ...next.keys()])].sort()) {
    const a = previous.get(key)
    const b = next.get(key)
    if (a && b && signature(a) === signature(b)) {
      const dependencyChanged = [...a.dependencies, ...b.dependencies].some(
        (file) => changed.has(file) && file !== a.location.file && file !== b.location.file
      )
      if (
        !(dependencyChanged && (a.unresolved.length || b.unresolved.length || a.kind === 'review'))
      )
        continue
      const group = JSON.stringify([
        b.symbol,
        [...new Set([...a.dependencies, ...b.dependencies])]
          .filter((file) => changed.has(file))
          .sort(),
      ])
      if (reviewedDependencies.has(group)) continue
      reviewedDependencies.add(group)
      result.push(
        finding(
          { ...a, kind: 'review' },
          { ...b, kind: 'review' },
          'A dependency of an unresolved visual expression changed'
        )
      )
    } else result.push(finding(a, b))
  }
  return result
}
