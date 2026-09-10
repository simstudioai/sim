import type { Entry } from '#design-diff/git'
import type { Definition } from '#design-diff/types'

export function extractAsset(entry: Entry): Definition[] {
  return [
    {
      key: 'asset',
      kind: 'asset',
      property: 'asset',
      value: { resource: entry.path, blob: entry.oid, bytes: entry.size },
      location: { file: entry.path, line: 1, column: 1 },
      symbol: 'asset',
      conditions: [],
      dependencies: [entry.path],
      unresolved: [],
    },
  ]
}
