import { describe, expect, it } from 'vitest'
import type { BlockCatalog, CatalogBlock } from './catalog/types'
import { compileWorkflow } from './compile'
import { TEST_CATALOG } from './compile/catalog.test-helpers'
import { refValueKind, valueTree } from './json-fields'
import type { CanonicalBlock, CanonicalWorkflow } from './model'

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

describe('W_JSON_REF_UNTYPED on a Function block output', () => {
  const FN_IMPORTS = "import { api, fn, trigger, workflow } from '@sim/workflow-sdk'"

  /** Compiles a Function block with `code` whose result `field` a JSON body uses bare. */
  function compile(code: string, field: string, stored?: CanonicalWorkflow) {
    const text = `// @sim-sdk 1\n${FN_IMPORTS}\n\nexport default workflow('Test', {}, () => {
  const start = trigger.start('Start')
  const score = fn('Score', { code: ${JSON.stringify(code)} })
  const next = api('Next', { url: 'https://x', body: { v: score.result.${field} } })
  start.to(score)
  score.to(next)
})\n`
    return compileWorkflow({
      entry: { path: 'workflow.ts', text },
      files: new Map(),
      catalog: TEST_CATALOG,
      sdkMajor: 1,
      ...(stored ? { stored } : {}),
    })
  }

  function untyped(code: string, field: string, stored?: CanonicalWorkflow) {
    return compile(code, field, stored).diagnostics.filter((d) => d.code === 'W_JSON_REF_UNTYPED')
  }

  it('stays quiet on a field the code returns as a number, boolean, array or object literal', () => {
    const code = [
      'const items = $ref.start.items || []',
      'const tax = Math.round(items.length * 10) / 100',
      'let score = $ref.start.total > 2000 ? 90 : 20',
      "if ($ref.start.tier === 'new') score += 10",
      "const names = 'a,b'.split(',')",
      'return { tax, score, ok: score >= 70, count: names.length, chars: "ab".length, list: items.map((i) => i.sku), meta: {} }',
    ].join('\n')
    for (const field of ['tax', 'score', 'ok', 'count', 'chars', 'list', 'meta']) {
      expect(untyped(code, field), field).toEqual([])
    }
  })

  it('stores a field the code returns as text quoted, so a string value cannot break the JSON', () => {
    const code =
      "return { tier: 'gold', label: String(1) + 'x', day: new Date().toISOString().slice(0, 10) }"
    for (const field of ['tier', 'label', 'day']) {
      const result = compile(code, field)
      expect(untyped(code, field), field).toEqual([])
      const body = result.workflow?.blocks.next?.params.body
      expect(body, field).toEqual({
        kind: 'value',
        value: `{\n  "v": "<score.result.${field}>"\n}`,
      })
    }
  })

  it('does not read a method name as proof of text when the receiver can define it', () => {
    // A user-defined `toString` or `join` can return anything, and a shadowed `String` is not the built-in.
    expect(
      untyped('const o = { toString: () => 42 }\nreturn { v: o.toString() }', 'v')
    ).toHaveLength(1)
    expect(untyped('const o = { join: () => 42 }\nreturn { v: o.join(",") }', 'v')).toHaveLength(1)
    expect(untyped('const String = (x) => 1\nreturn { v: String(2) }', 'v')).toHaveLength(1)
    expect(
      untyped("const Object = { keys: () => 'oops' }\nreturn { v: Object.keys({}).slice(0) }", 'v')
    ).toHaveLength(1)
    expect(untyped("import String from 'x'\nreturn { v: String(2) }", 'v')).toHaveLength(1)
    expect(untyped('const parseInt = () => "x"\nreturn { v: parseInt("1") }', 'v')).toHaveLength(1)
    expect(
      untyped("const o = { map: () => 'text' }\nreturn { v: o.map().slice(0) }", 'v')
    ).toHaveLength(1)
    expect(
      untyped("const o = { map: () => 'text' }\nreturn { v: o.map().join(',') }", 'v')
    ).toHaveLength(1)
    expect(untyped("return { v: 'a,b'.split(',').join('-') }", 'v')).toEqual([])
    expect(untyped('return { v: [1, 2].map((n) => n * 2).join(",") }', 'v')).toEqual([])
    expect(untyped('return { v: new Date().toString() }', 'v')).toEqual([])
    expect(untyped("return { v: 'a'.toLocaleString() }", 'v')).toEqual([])
    expect(untyped('return { v: (5).toFixed(2) }', 'v')).toEqual([])
    expect(untyped("return { v: ['a'].join(',') }", 'v')).toEqual([])
  })

  it('keeps the warning when nothing certain says what the field holds', () => {
    // A reference, a variable reassigned to text, a field only one return sets, a non-literal
    // return, and a spread that may replace the field.
    expect(untyped('return { v: $ref.start.v }', 'v')).toHaveLength(1)
    expect(untyped("let v = 1\nif ($ref.start.x) v = 'one'\nreturn { v }", 'v')).toHaveLength(1)
    expect(untyped('if ($ref.start.x) return { v: 1 }\nreturn { w: 2 }', 'v')).toHaveLength(1)
    expect(untyped('if ($ref.start.x) return { v: 1 }\nreturn $ref.start.o', 'v')).toHaveLength(1)
    expect(untyped('return { v: 1, ...$ref.start.o }', 'v')).toHaveLength(1)
    expect(untyped('return { v: 1 ', 'v')).toHaveLength(1)
  })

  it('keeps the warning when a computed key, a loop or an object length may make the field text', () => {
    // A computed key or a getter of the same name replaces the field written before it.
    expect(untyped("const key = 'v'\nreturn { v: 1, [key]: 'text' }", 'v')).toHaveLength(1)
    expect(untyped("return { v: 1, get v() { return 'text' } }", 'v')).toHaveLength(1)
    // A for-of or for-in loop over an existing variable reassigns it without an assignment.
    expect(untyped("let v = 1\nfor (v of ['a']) {}\nreturn { v }", 'v')).toHaveLength(1)
    expect(untyped('let v = 1\nfor (v in { a: 1 }) {}\nreturn { v }', 'v')).toHaveLength(1)
    expect(untyped("let v = 1\nfor ([v] of [['a']]) {}\nreturn { v }", 'v')).toHaveLength(1)
    // `length` is a number only on a string or an array: an object can hold anything there.
    expect(untyped("return { v: ({ length: 'oops' }).length }", 'v')).toHaveLength(1)
    expect(
      untyped("let list = []\nlist = { length: 'oops' }\nreturn { v: list.length }", 'v')
    ).toHaveLength(1)
    expect(
      untyped('const items = $ref.start.items || []\nreturn { v: items.length }', 'v')
    ).toHaveLength(1)
  })

  it('reads only the returns of the body, not those of a callback inside it', () => {
    const code = "const f = (x) => { return { v: 'text' } }\nreturn { v: 1 }"
    expect(untyped(code, 'v')).toEqual([])
  })

  it('on an apply, warns only on a JSON field the source changed from the stored workflow', () => {
    const code = 'return { v: $ref.start.v, w: $ref.start.w }'
    const printed = compile(code, 'v').workflow
    if (!printed) throw new Error('the source did not compile')

    expect(untyped(code, 'v', printed)).toEqual([])
    expect(untyped(code, 'w', printed)).toHaveLength(1)
  })

  it('on an apply, stays quiet on an unchanged JSON field whose reference only a rename rewrote', () => {
    const code = 'return { v: $ref.start.v }'
    const printed = compile(code, 'v').workflow
    if (!printed) throw new Error('the source did not compile')
    const renamed = (stored: CanonicalWorkflow, renamedKeys: ReadonlyMap<string, string>) => {
      const text = `// @sim-sdk 1\n${FN_IMPORTS}\n\nexport default workflow('Test', {}, () => {
  const start = trigger.start('Start')
  const score = fn('Lead Score', { code: ${JSON.stringify(code)} })
  const next = api('Next', { url: 'https://x', body: { v: score.result.v } })
  start.to(score)
  score.to(next)
})\n`
      return compileWorkflow({
        entry: { path: 'workflow.ts', text },
        files: new Map(),
        catalog: TEST_CATALOG,
        sdkMajor: 1,
        stored,
        renamedKeys,
      }).diagnostics.filter((d) => d.code === 'W_JSON_REF_UNTYPED')
    }

    const { score, ...others } = printed.blocks
    if (!score) throw new Error('the source has no score block')
    const rekeyed = { ...printed, blocks: { ...others, leadscore: { ...score, key: 'leadscore' } } }
    const renames = new Map([['score', 'leadscore']])

    expect(renamed(printed, renames)).toEqual([])
    expect(renamed(rekeyed, renames)).toEqual([])
    expect(renamed(printed, new Map())).toHaveLength(1)
  })

  it('on an apply, warns on an unchanged JSON field when the Function it reads no longer says what it returns', () => {
    const printed = compile('return { v: 1 }', 'v').workflow
    if (!printed) throw new Error('the source did not compile')

    expect(untyped('return { v: 2 }', 'v', printed)).toEqual([])
    expect(untyped('return { v: $ref.start.v }', 'v', printed)).toHaveLength(1)
  })

  it('on an apply, requotes an unchanged JSON field when the Function it reads now returns text there', () => {
    const printed = compile('return { v: 1 }', 'v').workflow
    if (!printed) throw new Error('the source did not compile')

    const next = compile("return { v: 'one' }", 'v', printed)
    expect(next.workflow?.blocks.next?.params.body).toEqual({
      kind: 'value',
      value: '{\n  "v": "<score.result.v>"\n}',
    })
    expect(untyped("return { v: 'one' }", 'v', printed)).toEqual([])
  })
})

describe('W_JSON_REF_UNTYPED on the whole of an output that can hold text', () => {
  const WHOLE_IMPORTS = "import { api, fn, trigger, workflow } from '@sim/workflow-sdk'"

  /** Compiles a Function block with `code` whose whole `result` a JSON body uses bare. */
  function compile(code: string, ref = 'score.result', stored?: CanonicalWorkflow) {
    const text = `// @sim-sdk 1\n${WHOLE_IMPORTS}\n\nexport default workflow('Test', {}, () => {
  const start = trigger.start('Start')
  const score = fn('Score', { code: ${JSON.stringify(code)} })
  const next = api('Next', { url: 'https://x', body: { v: ${ref} } })
  start.to(score)
  score.to(next)
})\n`
    return compileWorkflow({
      entry: { path: 'workflow.ts', text },
      files: new Map(),
      catalog: TEST_CATALOG,
      sdkMajor: 1,
      ...(stored ? { stored } : {}),
    })
  }

  const untyped = (code: string, ref?: string, stored?: CanonicalWorkflow) =>
    compile(code, ref, stored).diagnostics.filter((d) => d.code === 'W_JSON_REF_UNTYPED')

  const body = (code: string) => compile(code).workflow?.blocks.next?.params.body

  it('quotes a result every return makes text, so the string cannot break the JSON', () => {
    const code = 'return new Date().toISOString().slice(0, 10)'
    expect(untyped(code)).toEqual([])
    expect(body(code)).toEqual({ kind: 'value', value: '{\n  "v": "<score.result>"\n}' })
    expect(untyped("if ($ref.start.x) return 'a'\nreturn `b${1}`")).toEqual([])
  })

  it('leaves bare a result every return makes a number, boolean, array or object', () => {
    for (const code of [
      'return 1 + 2',
      'return $ref.start.n > 3',
      'return [1, 2]',
      "return { a: 'x' }",
      'if ($ref.start.x) return 1\nreturn true',
    ]) {
      expect(untyped(code), code).toEqual([])
      expect(body(code), code).toEqual({ kind: 'value', value: '{\n  "v": <score.result>\n}' })
    }
  })

  it('warns when nothing certain says whether the result is text', () => {
    // An unread value, text in one return and not another, a path that returns nothing, and no return.
    expect(untyped('return $ref.start.v')).toHaveLength(1)
    expect(untyped("if ($ref.start.x) return 'a'\nreturn 1")).toHaveLength(1)
    expect(untyped("if ($ref.start.x) return 'a'\nconst y = 2")).toHaveLength(1)
    expect(untyped('if ($ref.start.x) return\nreturn 1')).toHaveLength(1)
    expect(untyped('const y = 2')).toHaveLength(1)
    expect(untyped('return { v: 1 ', 'score.result')).toHaveLength(1)
  })

  it('warns on an HTTP response body, which is text unless the response says it is JSON', () => {
    const text = `// @sim-sdk 1\nimport { api, trigger, workflow } from '@sim/workflow-sdk'\n\nexport default workflow('Test', {}, () => {
  const start = trigger.start('Start')
  const get = api('Get', { url: 'https://x' })
  const next = api('Next', { url: 'https://x', body: { v: get.data, s: get.status } })
  start.to(get)
  get.to(next)
})\n`
    const result = compileWorkflow({
      entry: { path: 'workflow.ts', text },
      files: new Map(),
      catalog: TEST_CATALOG,
      sdkMajor: 1,
    })
    expect(
      result.diagnostics.filter((d) => d.code === 'W_JSON_REF_UNTYPED').map((d) => d.message)
    ).toEqual([expect.stringContaining('<get.data>')])
  })

  it('on an apply, stays quiet on an unchanged JSON field, and warns once the code stops saying', () => {
    const read = 'return $ref.start.v'
    const printed = compile(read).workflow
    if (!printed) throw new Error('the source did not compile')
    expect(untyped(read, 'score.result', printed)).toEqual([])

    const typed = compile('return 1').workflow
    if (!typed) throw new Error('the source did not compile')
    expect(untyped(read, 'score.result', typed)).toHaveLength(1)
  })

  describe('an output the catalog types any', () => {
    const catalog: BlockCatalog = {
      ...TEST_CATALOG,
      blocks: {
        ...TEST_CATALOG.blocks,
        service: {
          ...TEST_CATALOG.blocks.function,
          type: 'service',
          outputs: { id: { type: 'any' }, tags: { type: 'json' } },
        } as CatalogBlock,
      },
    }
    const service: CanonicalBlock = {
      key: 'svc',
      name: 'Svc',
      type: 'service',
      parent: null,
      enabled: true,
      locked: false,
      triggerMode: false,
      advancedMode: false,
      errorPort: false,
      retry: null,
      params: {},
      modes: {},
    }
    const kind = (token: string) =>
      refValueKind(token, {
        catalog,
        block: (key) => (key === 'svc' ? service : undefined),
        variable: () => undefined,
      })

    it('is untyped, since it may be text, while a json output stays typed', () => {
      expect(kind('<svc.id>')).toBe('untyped')
      expect(kind('<svc.tags>')).toBe('typed')
    })
  })
})
