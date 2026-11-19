import { describe, expect, it } from 'vitest'
import type { BlockCatalog, CatalogBlock } from './catalog/types'
import { compileWorkflow } from './compile'
import { TEST_CATALOG } from './compile/catalog.test-helpers'
import { refValueKind, valueTree } from './json-fields'
import type { CanonicalBlock } from './model'

const IMPORTS = "import { agent, api, raw, table, trigger, workflow } from '@sim/workflow-sdk'"

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

describe('a reference into an agent responseFormat, in a JSON field', () => {
  function body(format: string) {
    const text = `// @sim-sdk 1\n${IMPORTS}\n\nexport default workflow('Test', {}, () => {
  const start = trigger.start('Start')
  const classify = agent('Classify', { model: 'm', responseFormat: ${format} })
  const next = api('Next', { url: 'https://x', body: { text: classify.summary } })
  start.to(classify)
  classify.to(next)
})\n`
    const result = compileWorkflow({
      entry: { path: 'workflow.ts', text },
      files: new Map(),
      catalog: TEST_CATALOG,
      sdkMajor: 1,
    })
    const param = result.workflow?.blocks.next?.params.body
    return {
      stored: param?.kind === 'value' ? param.value : undefined,
      untyped: result.diagnostics.filter((d) => d.code === 'W_JSON_REF_UNTYPED'),
    }
  }

  it.each([
    [
      'a schema property with no type',
      "{ schema: { properties: { summary: { description: 'One line' } } } }",
    ],
    ['a legacy fields entry', "{ fields: [{ name: 'summary', type: 'string' }] }"],
  ])('quotes a field the runtime types as a string: %s', (_label, format) => {
    const { stored, untyped } = body(format)
    expect(JSON.parse(String(stored))).toEqual({ text: '<classify.summary>' })
    expect(untyped).toEqual([])
  })

  it('keeps a field the format types as a number bare', () => {
    const { stored } = body("{ schema: { properties: { summary: { type: 'number' } } } }")
    expect(stored).toBe('{\n  "text": <classify.summary>\n}')
  })
})

describe('refValueKind for a block acting as a trigger', () => {
  const service: CatalogBlock = {
    ...TEST_CATALOG.blocks.api,
    type: 'service',
    name: 'Service',
    subBlocks: [],
    triggers: { enabled: true, available: ['service_a', 'service_b'] },
    outputs: { status: { type: 'string' } },
  }
  const catalog: BlockCatalog = {
    ...TEST_CATALOG,
    blocks: { ...TEST_CATALOG.blocks, service },
    triggers: {
      service_a: {
        id: 'service_a',
        provider: 'service',
        name: 'A',
        subBlocks: [],
        outputs: { payload: { type: 'string' } },
      },
      service_b: {
        id: 'service_b',
        provider: 'service',
        name: 'B',
        subBlocks: [],
        outputs: { payload: { type: 'json' } },
      },
    },
  }
  const stored = (params: CanonicalBlock['params']): CanonicalBlock => ({
    key: 'svc',
    name: 'Svc',
    type: 'service',
    parent: null,
    enabled: true,
    locked: false,
    triggerMode: true,
    advancedMode: false,
    errorPort: false,
    retry: null,
    params,
    modes: {},
  })
  const kind = (token: string, block: CanonicalBlock) =>
    refValueKind(token, {
      catalog,
      block: (key) => (key === block.key ? block : undefined),
      variable: () => undefined,
    })

  it('types an output by the trigger the block deploys as, its stored triggerId', () => {
    const block = stored({ triggerId: { kind: 'value', value: 'service_b' } })
    expect(kind('<svc.payload>', block)).toBe('typed')
  })

  it('exposes the trigger outputs in place of the block outputs', () => {
    const block = stored({ selectedTriggerId: { kind: 'value', value: 'service_a' } })
    expect(kind('<svc.payload>', block)).toBe('string')
    expect(kind('<svc.status>', block)).toBe('untyped')
  })
})
