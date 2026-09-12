import { createHash } from 'node:crypto'
import { appearanceValue } from '#design-diff/appearance'
import { changedCategory } from '#design-diff/policy'
import { previewChange } from '#design-diff/report'
import type { Change, Definition } from '#design-diff/types'

function signature(definition: Definition) {
  return JSON.stringify([definition.value, definition.conditions])
}

export function finding(before: Definition | undefined, after: Definition | undefined): Change {
  const definition = after ?? before
  if (!definition) throw new Error('Finding needs evidence')
  const unresolved = [
    ...new Set([...(before?.unresolved ?? []), ...(after?.unresolved ?? [])]),
  ].sort()
  const category = changedCategory(before, after)
  const a = before && appearanceValue(before)
  const b = after && appearanceValue(after)
  const supported =
    (!before || a !== undefined) &&
    (!after || b !== undefined) &&
    (a !== undefined || b !== undefined)
  const changed = JSON.stringify(a) !== JSON.stringify(b)
  const flag = supported && changed && category !== 'movement'
  const result: Omit<Change, 'id'> = {
    decision: flag ? 'flag' : 'exempt',
    category,
    reason: flag
      ? 'Supported authored appearance values changed'
      : 'No established change to authored appearance under the designer policy',
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
  return previewChange({
    id: createHash('sha256').update(JSON.stringify(result)).digest('hex').slice(0, 24),
    ...result,
  })
}

export function compareDefinitions(before: Definition[], after: Definition[]): Change[] {
  const signatures = new Map<Definition, string | undefined>()
  const appearance = (definition: Definition) => {
    if (!signatures.has(definition))
      signatures.set(definition, JSON.stringify(appearanceValue(definition)))
    return signatures.get(definition)
  }
  const sameAppearance = (a: Definition, b: Definition) => appearance(a) === appearance(b)
  if (
    [...before, ...after].some(
      (definition) =>
        definition.kind === 'review' &&
        definition.unresolved.some((reason) => /Parser failure|extraction failed/.test(reason))
    )
  )
    return []
  const groups = (definitions: Definition[]) => {
    const result = new Map<string, Definition[]>()
    for (const definition of definitions) {
      const key = definition.key.replace(/:\d+$/, '')
      const entries = result.get(key) ?? []
      entries.push(definition)
      result.set(key, entries)
    }
    return result
  }
  const previous = groups(before)
  const next = groups(after)
  const result: Change[] = []
  for (const key of [...new Set([...previous.keys(), ...next.keys()])].sort()) {
    const left = previous.get(key) ?? []
    const right = next.get(key) ?? []
    const pairs: [Definition | undefined, Definition | undefined][] = []
    if (left.length === right.length) {
      left.forEach((definition, index) => pairs.push([definition, right[index]]))
    } else {
      /** Inserting repeated controls must not turn later unchanged definitions into edits. */
      const remaining = new Set(left)
      const additions: Definition[] = []
      for (const definition of right) {
        const match = [...remaining].find((candidate) => sameAppearance(candidate, definition))
        if (match) remaining.delete(match)
        else additions.push(definition)
      }
      const removals = [...remaining]
      for (let index = 0; index < Math.max(removals.length, additions.length); index++)
        pairs.push([removals[index], additions[index]])
    }
    for (const [a, b] of pairs) {
      const unpaired = !a ? b : !b ? a : undefined
      if (unpaired?.kind === 'attribute' && unpaired.appearance?.shared) {
        const element = unpaired.appearance.element?.replace(/:\d+$/, '')
        const count = (definitions: Definition[]) =>
          definitions.filter(
            (definition) =>
              definition.kind === 'markup' &&
              definition.appearance?.element?.replace(/:\d+$/, '') === element
          ).length
        const existing = !a ? before : after
        const added = !a ? after : before
        if (!count(existing) || count(added) > count(existing)) continue
      }
      if (a && b && (signature(a) === signature(b) || sameAppearance(a, b))) continue
      if ((!a || appearance(a) === undefined) && (!b || appearance(b) === undefined)) continue
      if (
        !a &&
        b &&
        before.some(
          (definition) =>
            definition.kind === b.kind &&
            definition.property === b.property &&
            sameAppearance(definition, b)
        )
      )
        continue
      if (
        a &&
        !b &&
        after.some(
          (definition) =>
            definition.kind === a.kind &&
            definition.property === a.property &&
            sameAppearance(definition, a)
        )
      )
        continue
      result.push(finding(a, b))
    }
  }
  return result
}
