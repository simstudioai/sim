import { describe, expect, it } from 'vitest'
import { compileWorkflow } from './compile'
import { TEST_CATALOG } from './compile/test-catalog'
import { valueTree } from './json-fields'

const IMPORTS = "import { raw, table, workflow } from '@sim/workflow-sdk'"

function storedData(body: string): unknown {
  const text = `// @sim-sdk 1\n${IMPORTS}\n\nexport default workflow('Test', {}, () => {\n  ${body}\n})\n`
  const result = compileWorkflow({
    entry: { path: 'workflow.ts', text },
    files: new Map(),
    catalog: TEST_CATALOG,
    sdkMajor: 1,
  })
  const param = result.workflow?.blocks.row?.params.data
  return param?.kind === 'value' ? param.value : undefined
}

describe('valueTree', () => {
  it('has no JSON form for a resource, variable, csv or unresolved node', () => {
    expect(valueTree({ $sim: 'resource', kind: 'table', key: 'leads' })).toBeUndefined()
    expect(valueTree({ $sim: 'var', key: 'n' })).toBeUndefined()
    expect(valueTree({ $sim: 'unresolved', kind: 'table', id: 't1' })).toBeUndefined()
    expect(valueTree({ a: [{ $sim: 'var', key: 'n' }] })).toBeUndefined()
  })

  it('reads a literal node as the data it escapes', () => {
    expect(valueTree({ a: { $sim: 'literal', value: { $sim: 'plain' } } })).toEqual({
      a: { $sim: 'plain' },
    })
  })

  it('stores a raw literal node inside a JSON field as its data', () => {
    const stored = storedData(
      "const row = table.insertRow('Row', { data: { t: raw({ $sim: 'literal', value: { $sim: 'x' } }) } })"
    )
    expect(JSON.parse(String(stored))).toEqual({ t: { $sim: 'x' } })
  })
})
