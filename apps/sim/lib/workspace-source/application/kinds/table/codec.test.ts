/**
 * @vitest-environment node
 *
 * The column-type facts the workspace packages hold outside the registry: the metadata keys the
 * pure table codec can read, the catalog its own tests read tables with, and the column helpers
 * the SDK declares. Each must match `@/lib/table/column-types`, or a type or option added there is
 * silently undeclarable (or mistyped) in source.
 */
import { WORKSPACE_SDK_DTS } from '@sim/workflow-sdk/codegen'
import { TABLE_COLUMN_METADATA_KEYS } from '@sim/workspace-code/kinds/table'
import { TEST_TABLE_COLUMNS } from '@sim/workspace-code/kinds/table.test-helpers'
import { describe, expect, it } from 'vitest'
import { ALL_COLUMN_TYPES, COLUMN_TYPES, TYPE_SPECIFIC_COLUMN_KEYS } from '@/lib/table/column-types'
import { TABLE_COLUMN_CATALOG } from '@/lib/workspace-source/application/kinds/table/codec'

/** The SDK's `column` helpers, name → the text of its overloads. */
function sdkColumnHelpers(): Map<string, string> {
  const dts = WORKSPACE_SDK_DTS['table.d.ts'] ?? ''
  const block = dts.slice(dts.indexOf('export declare const column: {'))
  const body = block.slice(0, block.indexOf('\n}')).replace(/\/\*\*[\s\S]*?\*\//g, '')
  const helpers = new Map<string, string>()
  let helper: string | undefined
  for (const line of body.split('\n')) {
    helper = /^ {2}(\w+)</.exec(line)?.[1] ?? helper
    if (helper) helpers.set(helper, `${helpers.get(helper) ?? ''}${line}\n`)
  }
  return helpers
}

describe('table column types in workspace source', () => {
  it('the table codec reads every metadata key the registry lets a type own', () => {
    expect([...TABLE_COLUMN_METADATA_KEYS].sort()).toEqual([...TYPE_SPECIFIC_COLUMN_KEYS].sort())
  })

  it('the package tests read tables with the catalog the registry builds', () => {
    expect(TEST_TABLE_COLUMNS).toEqual(TABLE_COLUMN_CATALOG)
  })

  it('the SDK declares one column helper per registry type, taking the options the type owns', () => {
    const helpers = sdkColumnHelpers()
    expect([...helpers.keys()].sort()).toEqual([...COLUMN_TYPES].sort())
    for (const definition of ALL_COLUMN_TYPES) {
      for (const owned of definition.ownedMetadata) {
        // An option of the helper's own options object, not its `options` parameter.
        expect(helpers.get(definition.id), `column.${definition.id}() takes ${owned}`).toMatch(
          new RegExp(`\\{[^}]*\\b${owned}\\??:`)
        )
      }
    }
  })
})
