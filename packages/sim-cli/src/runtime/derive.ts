import type { Command } from 'commander'
import { V2_OPERATIONS, type V2OperationName } from '../generated/v2-api'

/** The full `sim …` path of a command, for a message that has to name it. */
export function commandPath(command: Command): string {
  const names: string[] = []
  let current: Command | null = command
  while (current) {
    names.unshift(current.name())
    current = current.parent
  }
  return names.join(' ')
}

/**
 * Trailing path segments that read as verbs rather than sub-resources, so
 * `/tables/[id]/rows/upsert` derives `tables upsert` instead of
 * `tables rows upsert create`.
 *
 * `execute` and `cancel` are deliberately absent: they are verbs, but their
 * derived names read badly enough that the contract names them explicitly, and
 * listing them here would produce `workflows execute` — close, but not the
 * `workflows run` the contract asks for. Keeping them out means the contract is
 * the only place that decision lives.
 */
const ACTION_SEGMENTS = new Set([
  'upsert',
  'query',
  'search',
  'export',
  'import',
  'deploy',
  'rollback',
])

/**
 * Derives a command path from an operation's route.
 *
 * `<resource> [sub-resource] <verb>`, where the verb comes from the method and
 * whether the path ends in a parameter (an item) or not (a collection). This
 * covers 41 of the 47 operations; the rest are named in the CLI contract.
 */
export function deriveCommandPath(operation: V2OperationName): string[] {
  const spec = V2_OPERATIONS[operation]
  const segments = spec.path.replace('/api/v2/', '').split('/')
  const resource = segments[0]
  const nouns = segments.slice(1).filter((segment) => !segment.startsWith('['))
  const last = nouns[nouns.length - 1]

  if (last && ACTION_SEGMENTS.has(last)) return [resource, last]

  const isItem = spec.path.endsWith(']')
  const verb =
    spec.method === 'GET'
      ? isItem
        ? 'get'
        : 'list'
      : spec.method === 'POST'
        ? 'create'
        : spec.method === 'DELETE'
          ? 'delete'
          : 'update'

  return last ? [resource, last, verb] : [resource, verb]
}

/** `conflictTarget` → `conflict-target`. */
export function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
}

/**
 * `min-duration-ms` → `minDurationMs`, the key commander actually stores.
 *
 * Commander camelCases every multi-word flag when it builds its options object,
 * so a lookup by the flag's own name finds nothing and the value is silently
 * dropped — no error, the field just never reaches the API. Every read of a
 * parsed flag has to go through this.
 */
export function camel(flag: string): string {
  return flag.replace(/-([a-z])/g, (_match, character: string) => character.toUpperCase())
}
