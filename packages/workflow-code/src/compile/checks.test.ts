/**
 * Compile checks that catch source the runtime would silently mishandle: wiring that never runs,
 * references to outputs a block does not produce.
 */
import { describe, expect, it } from 'vitest'
import type { BlockCatalog, CatalogBlock } from '../catalog/types'
import type { CanonicalWorkflow } from '../model'
import { TEST_CATALOG } from './catalog.test-helpers'
import type { CompileResult } from './index'
import { compileWorkflow } from './index'

const IMPORTS =
  "import { agent, api, block, condition, fn, loop, slack, t, trigger, workflow } from '@sim/workflow-sdk'"

function source(body: string): string {
  return `// @sim-sdk 1\n${IMPORTS}\n\nexport default workflow('Test', {}, () => {\n${body}\n})\n`
}

function run(
  body: string,
  stored?: CanonicalWorkflow,
  catalog: BlockCatalog = TEST_CATALOG
): CompileResult {
  return compileWorkflow({
    entry: { path: 'workflow.ts', text: source(body) },
    files: new Map(),
    catalog,
    sdkMajor: 1,
    ...(stored && { stored }),
  })
}

function findings(result: CompileResult, code: string) {
  return result.diagnostics.filter((d) => d.code === code)
}

const START = "const start = trigger.start('Start')"

describe('cycles', () => {
  it('refuses a self-loop', () => {
    const result = run(
      [START, "const a = api('A', { url: 'https://x' })", 'start.to(a)', 'a.to(a)'].join('\n')
    )
    expect(result.workflow).toBeNull()
    const [cycle] = findings(result, 'E_EDGE_CYCLE')
    expect(cycle?.message).toBe(
      'A is wired to itself, so it waits on its own output and never runs.'
    )
    expect(cycle?.span.line).toBe(8)
  })

  it('refuses a cycle through a condition branch', () => {
    const result = run(
      [
        START,
        "const a = api('A', { url: 'https://x' })",
        "const check = condition('Check', { retry: t`${a.status} !== 200`, else: true })",
        'start.to(a)',
        'a.to(check)',
        'check.retry.to(a)',
      ].join('\n')
    )
    expect(findings(result, 'E_EDGE_CYCLE').map((d) => d.message)).toEqual([
      'A, Check are wired in a cycle; each waits on the one before it, so none of them runs.',
    ])
  })

  it('accepts a diamond, a loop body and a cycle broken by a disabled block', () => {
    const result = run(
      [
        START,
        "const a = api('A', { url: 'https://x' })",
        "const b = api('B', { url: 'https://x' })",
        "const c = api('C', { url: 'https://x' })",
        "const d = api('D', { url: 'https://x' }, { disabled: true })",
        "const l = loop.for('L', { count: 3 }, (p) => {",
        "  const inner = fn('Inner', { code: 'return 1' })",
        '  p.to(inner)',
        '})',
        'start.to(a)',
        'a.to(b)',
        'a.to(c)',
        'b.to(l)',
        'c.to(l)',
        'l.to(d)',
        'd.to(a)',
      ].join('\n')
    )
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })

  it('keeps a cycle the stored workflow already holds as a warning', () => {
    const body = [START, "const a = api('A', { url: 'https://x' })", 'start.to(a)'].join('\n')
    const stored = run(body).workflow
    if (!stored) throw new Error('expected a workflow')
    const withLoop = {
      ...stored,
      edges: [...stored.edges, { from: 'a', port: { kind: 'out' as const }, to: 'a' }],
    }
    const result = run(`${body}\na.to(a)`, withLoop)
    expect(findings(result, 'E_EDGE_CYCLE')).toEqual([])
    expect(findings(result, 'W_EDGE_CYCLE')).toHaveLength(1)
    expect(result.workflow).not.toBeNull()
  })
})

describe('references into an agent responseFormat', () => {
  const FORMAT =
    "responseFormat: { name: 'classify', schema: { type: 'object', properties: { priority: { type: 'string' }, score: { type: 'number' } } } }"
  const paths = (agentParams: string, ref: string) =>
    findings(
      run(
        [
          START,
          `const classify = agent('Classify', { model: 'm', ${agentParams} })`,
          `const next = api('Next', { url: t\`https://x/\${${ref}}\` })`,
          'start.to(classify)',
          'classify.to(next)',
        ].join('\n')
      ),
      'W_UNKNOWN_OUTPUT_PATH'
    )

  it('warns on a field the format does not declare, with a did-you-mean', () => {
    const [unknown] = paths(FORMAT, 'classify.priorty')
    expect(unknown?.message).toBe(
      'Classify has no output priorty: its responseFormat declares priority, score.'
    )
    expect(unknown?.hint).toBe('Did you mean priority?')
  })

  it.each([
    ['a declared field', FORMAT, 'classify.priority'],
    ['a path under a declared field', FORMAT, 'classify.score.value'],
    ['a static output beside the format', FORMAT, 'classify.content'],
    [
      'a format the compiler cannot read',
      'responseFormat: t`{ "properties": ${start.input} }`',
      'classify.anything',
    ],
  ])('accepts %s', (_label, params, ref) => {
    expect(paths(params, ref)).toEqual([])
  })

  it('checks the static outputs when there is no format', () => {
    expect(paths('messages: []', 'classify.priority')).toHaveLength(1)
    expect(paths('messages: []', 'classify.content')).toEqual([])
  })
})

describe('option values', () => {
  it('warns on a dropdown value the field does not offer, listing the options', () => {
    const [unknown] = findings(
      run("const a = api('A', { url: 'https://x', method: 'POSTT' })"),
      'W_UNKNOWN_OPTION'
    )
    expect(unknown?.message).toBe('method has no option POSTT; it is kept as written.')
    expect(unknown?.hint).toBe('Did you mean POST? Options: GET, POST.')
  })

  it('accepts an offered value and a reference', () => {
    expect(
      findings(run("const a = api('A', { url: 'https://x', method: 'POST' })"), 'W_UNKNOWN_OPTION')
    ).toEqual([])
    expect(
      findings(
        run(`${START}\nconst a = api('A', { url: 'https://x', method: t\`\${start.input}\` })`),
        'W_UNKNOWN_OPTION'
      )
    ).toEqual([])
  })

  it('refuses an operation the block does not offer, listing the operations', () => {
    const result = run("const s = block('slack', 'S', { operation: 'bogus' })")
    const [unknown] = findings(result, 'E_UNKNOWN_OPERATION')
    expect(unknown?.message).toBe('slack has no operation bogus.')
    expect(unknown?.hint).toBe('Options: send, list_channels.')
    expect(result.workflow).toBeNull()
  })

  it('keeps a retired operation the stored block holds, as a warning', () => {
    const stored = run("const s = block('slack', 'S', { operation: 'send' })").workflow
    if (!stored) throw new Error('expected a workflow')
    const block = stored.blocks.s
    if (!block) throw new Error('expected the block')
    const retired = {
      ...stored,
      blocks: {
        s: {
          ...block,
          params: { ...block.params, operation: { kind: 'value' as const, value: 'old_send' } },
        },
      },
    }
    const result = run("const s = block('slack', 'S', { operation: 'old_send' })", retired)
    expect(findings(result, 'E_UNKNOWN_OPERATION')).toEqual([])
    expect(findings(result, 'W_UNKNOWN_OPTION')).toHaveLength(1)
  })

  const withModels: BlockCatalog = {
    ...TEST_CATALOG,
    blocks: {
      ...TEST_CATALOG.blocks,
      agent: {
        ...(TEST_CATALOG.blocks.agent as CatalogBlock),
        subBlocks: (TEST_CATALOG.blocks.agent as CatalogBlock).subBlocks.map((sub) =>
          sub.id === 'model'
            ? {
                ...sub,
                options: [
                  { id: 'gpt-4o', label: 'gpt-4o' },
                  { id: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
                ],
              }
            : sub
        ),
      },
    },
  }

  it('warns on a model the catalog does not list, with a did-you-mean', () => {
    const [unknown] = findings(
      run("const a = agent('A', { model: 'gpt-4oo' })", undefined, withModels),
      'W_UNKNOWN_MODEL'
    )
    expect(unknown?.message).toBe(
      'gpt-4oo is not a model the catalog lists; it is kept as written.'
    )
    expect(unknown?.hint).toBe('Did you mean gpt-4o?')
    expect(
      findings(
        run("const a = agent('A', { model: 'gpt-4o' })", undefined, withModels),
        'W_UNKNOWN_MODEL'
      )
    ).toEqual([])
  })
})

describe('legacy block types', () => {
  const withLegacy: BlockCatalog = {
    ...TEST_CATALOG,
    blocks: {
      ...TEST_CATALOG.blocks,
      slack_legacy: {
        ...(TEST_CATALOG.blocks.slack as CatalogBlock),
        type: 'slack_legacy',
        lifecycle: { sunset: { status: 'legacy', replacedBy: 'slack' } },
      },
    },
  }

  it('warns on a new block of a legacy type, naming its replacement and builders', () => {
    const [legacy] = findings(
      run("const s = block('slack_legacy', 'S', {})", undefined, withLegacy),
      'W_LEGACY_BLOCK_TYPE'
    )
    expect(legacy?.message).toBe('slack_legacy is a legacy block type; slack replaces it.')
    expect(legacy?.hint).toBe('Use slack.* instead.')
  })

  it('stays quiet for a legacy block the stored workflow already holds', () => {
    const body = "const s = block('slack_legacy', 'S', {})"
    const stored = run(body, undefined, withLegacy).workflow
    if (!stored) throw new Error('expected a workflow')
    expect(findings(run(body, stored, withLegacy), 'W_LEGACY_BLOCK_TYPE')).toEqual([])
  })
})

describe('unknown builders', () => {
  it.each([
    ["const s = slack.postMessage('S', {})", 'Did you mean slack.sendMessage?'],
    [
      "const s = slack.fetchEverything('S', {})",
      'slack has: slack.sendMessage, slack.listChannels.',
    ],
    ["const h = http.request('H', {})", 'Did you mean api?'],
    ["const f = javascript.run('F', {})", 'Did you mean fn?'],
  ])('%s', (body, hint) => {
    const [unknown] = findings(run(body), 'E_UNKNOWN_BUILDER')
    expect(unknown?.hint).toBe(hint)
  })

  it('reports a namespace the SDK does not have as an unknown builder', () => {
    const result = run("const d = discord.sendMessage('D', {})")
    const [unknown] = findings(result, 'E_UNKNOWN_BUILDER')
    expect(unknown?.message).toBe(
      'discord.sendMessage is not a block builder: discord is not an SDK namespace.'
    )
    expect(result.diagnostics.map((d) => d.message)).not.toContain('Only blocks can be named.')
  })

  it('reports a namespace the file did not import', () => {
    const result = compileWorkflow({
      entry: {
        path: 'workflow.ts',
        text: "// @sim-sdk 1\nimport { workflow } from '@sim/workflow-sdk'\n\nexport default workflow('Test', {}, () => {\nconst s = slack.sendMessage('S', {})\n})\n",
      },
      files: new Map(),
      catalog: TEST_CATALOG,
      sdkMajor: 1,
    })
    expect(findings(result, 'E_UNKNOWN_BUILDER')[0]?.hint).toBe(
      "Add slack to the import from '@sim/workflow-sdk'."
    )
  })
})

describe('a misspelled required param', () => {
  it('reports the unknown param once, without a second W_REQUIRED_MISSING for its suggestion', () => {
    const result = run("const a = api('A', { urll: 'https://x' })")
    expect(findings(result, 'E_UNKNOWN_PARAM')[0]?.hint).toBe('Did you mean url?')
    expect(findings(result, 'W_REQUIRED_MISSING')).toEqual([])
  })
})

describe('typed references in JSON fields', () => {
  it("types a loop's results as an array, so no W_JSON_REF_UNTYPED fires", () => {
    const result = run(
      [
        "const l = loop.for('L', { count: 2 }, (p) => {",
        "  const inner = fn('Inner', { code: 'return 1' })",
        '  p.to(inner)',
        '})',
        "const a = api('A', { url: 'https://x', body: { items: l.results } })",
        'l.to(a)',
      ].join('\n')
    )
    expect(findings(result, 'W_JSON_REF_UNTYPED')).toEqual([])
  })

  it('tells an untyped reference to stay bare unless it holds text', () => {
    const result = run(
      `${START}\nconst a = api('A', { url: 'https://x', body: { items: start.input.list } })`
    )
    expect(findings(result, 'W_JSON_REF_UNTYPED')[0]?.hint).toMatch(
      /^Leave it bare when it holds an array/
    )
  })
})

describe('slider ranges', () => {
  const agentBlock = TEST_CATALOG.blocks.agent as CatalogBlock
  const withSliders: BlockCatalog = {
    ...TEST_CATALOG,
    blocks: {
      ...TEST_CATALOG.blocks,
      agent: {
        ...agentBlock,
        subBlocks: [
          ...agentBlock.subBlocks.filter((sub) => sub.id !== 'temperature'),
          {
            id: 'temperature',
            type: 'slider',
            valueKind: 'number',
            storage: 'native',
            min: 0,
            max: 1,
            step: 0.1,
          },
          {
            id: 'topK',
            type: 'slider',
            valueKind: 'number',
            storage: 'native',
            min: 1,
            max: 50,
            step: 1,
            integer: true,
          },
        ],
      },
    },
  }

  function sliders(params: string) {
    return run(`const a = agent('A', { model: 'm', ${params} })`, undefined, withSliders)
      .diagnostics.filter((d) => d.code === 'W_OUT_OF_RANGE')
      .map((d) => `${d.param}: ${d.message} ${d.hint}`)
  }

  it.each([
    [
      'temperature: -0.5',
      'temperature: temperature is -0.5, outside its range; it is kept as written. Write a value from 0 to 1.',
    ],
    [
      'temperature: 0.35',
      'temperature: temperature is 0.35, between steps of 0.1; it is kept as written. Write a multiple of 0.1, from 0 to 1.',
    ],
    [
      'topK: 0',
      'topK: topK is 0, outside its range; it is kept as written. Write a value from 1 to 50.',
    ],
    [
      'topK: 2.5',
      'topK: topK is 2.5, but takes whole numbers only; it is kept as written. Write a whole number from 1 to 50.',
    ],
  ])('warns on %s', (params, finding) => {
    expect(sliders(params)).toEqual([finding])
  })

  it('accepts bounds, float steps and references', () => {
    expect(
      sliders("temperature: 0.3, topK: 50, messages: [{ role: 'user', content: 'x' }]")
    ).toEqual([])
    expect(sliders('temperature: 1, topK: 1')).toEqual([])
    expect(sliders('temperature: vars.temp')).toEqual([])
  })
})

describe('hints that name the fix', () => {
  it('suggests a block whose name an identifier swaps two letters of', () => {
    const [unknown] = findings(
      run([START, "const save = api('Save', { url: 'https://x' })", 'start.to(saev)'].join('\n')),
      'E_UNKNOWN_IDENTIFIER'
    )
    expect(unknown?.hint).toBe('Did you mean save?')
  })

  it('names the block and suggests the output an unknown static output path is close to', () => {
    const [unknown] = findings(
      run(
        [
          START,
          "const call = api('Call', { url: 'https://x' })",
          "const next = api('Next', { url: 'https://x', body: { got: call.dat } })",
        ].join('\n')
      ),
      'W_UNKNOWN_OUTPUT_PATH'
    )
    expect(unknown?.message).toBe('Call has no output dat.')
    expect(unknown?.hint).toBe('Did you mean data?')
  })

  it('reads x.error in the handler of an error edge, and refuses it on a block without one', () => {
    const body = (wiring: string) =>
      [
        START,
        "const call = api('Call', { url: 'https://x' })",
        "const failed = api('Failed', { url: 'https://x', body: { why: call.error } })",
        'start.to(call)',
        wiring,
      ].join('\n')
    expect(findings(run(body('call.onError(failed)')), 'W_UNKNOWN_OUTPUT_PATH')).toEqual([])
    const [unknown] = findings(run(body('call.to(failed)')), 'W_UNKNOWN_OUTPUT_PATH')
    expect(unknown?.message).toBe(
      'Call has no output error: only a block with an error edge outputs its failure message.'
    )
    expect(unknown?.hint).toBe('Wire call.onError(<handler>) and read call.error in the handler.')
  })

  it('stores x.error quoted in a JSON body, since the failure message is a string', () => {
    const result = run(
      [
        START,
        "const call = api('Call', { url: 'https://x' })",
        "const failed = api('Failed', { url: 'https://x', body: { why: call.error } })",
        'start.to(call)',
        'call.onError(failed)',
      ].join('\n')
    )
    expect(findings(result, 'W_JSON_REF_UNTYPED')).toEqual([])
    expect(JSON.stringify(result.workflow?.blocks.failed?.params.body)).toContain(
      '\\"<call.error>\\"'
    )
  })

  it('reads x.error of an agent with a responseFormat only after an error edge', () => {
    const format =
      "responseFormat: { name: 'r', schema: { type: 'object', properties: { score: { type: 'number' } } } }"
    const body = (wiring: string) =>
      [
        START,
        `const classify = agent('Classify', { model: 'm', ${format} })`,
        "const failed = api('Failed', { url: 'https://x', body: { why: classify.error } })",
        'start.to(classify)',
        wiring,
      ].join('\n')
    expect(findings(run(body('classify.onError(failed)')), 'W_UNKNOWN_OUTPUT_PATH')).toEqual([])
    expect(findings(run(body('classify.to(failed)')), 'W_UNKNOWN_OUTPUT_PATH')).toHaveLength(1)
  })

  it('lists the outputs when no output is close to an unknown path', () => {
    const [unknown] = findings(
      run(
        [
          START,
          "const call = api('Call', { url: 'https://x' })",
          "const next = api('Next', { url: 'https://x', body: { got: call.everything } })",
        ].join('\n')
      ),
      'W_UNKNOWN_OUTPUT_PATH'
    )
    expect(unknown?.hint).toBe('Outputs: data, status, headers.')
  })

  it('suggests a declared env name an unknown one is close to', () => {
    const result = compileWorkflow({
      entry: {
        path: 'workflow.ts',
        text: source(
          "const a = api('A', { url: 'https://x', body: { key: env.OPENAI_KYE } })"
        ).replace('import { agent', 'import { env, agent'),
      },
      files: new Map(),
      catalog: TEST_CATALOG,
      sdkMajor: 1,
      envNames: new Set(['OPENAI_KEY']),
    })
    expect(findings(result, 'W_ENV_UNKNOWN')[0]?.hint).toBe('Did you mean OPENAI_KEY?')
  })

  it('points process.env at env.NAME', () => {
    const [unknown] = findings(
      run("const a = api('A', { url: process.env.API_URL })"),
      'E_UNKNOWN_IDENTIFIER'
    )
    expect(unknown?.hint).toBe(
      "Read an environment variable as env.NAME, with env imported from '@sim/workflow-sdk'."
    )
  })

  it('tells a reference to a non-block const to inline its value', () => {
    const result = run(["const URL = 'https://x'", "const a = api('A', { url: URL })"].join('\n'))
    const [refused] = findings(result, 'E_UNSUPPORTED_SYNTAX')
    expect(refused?.message).toBe('URL holds a value, not a block.')
    expect(findings(result, 'E_UNKNOWN_IDENTIFIER')[0]?.hint).toBe(
      'URL is a const that holds a value, which a workflow file cannot name: write the value here.'
    )
  })

  it.each([
    ['an untagged template', "const a = api('A', { url: `https://${start.host}` })"],
    ['an unknown identifier', "const a = api('A', { url: process.env.API_URL })"],
  ])('does not also report a required param written as %s as missing', (_, body) => {
    const result = run([START, body].join('\n'))
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true)
    expect(findings(result, 'W_REQUIRED_MISSING')).toEqual([])
  })

  it('still reports a required param left as todo() as missing', () => {
    const result = compileWorkflow({
      entry: {
        path: 'workflow.ts',
        text: source([START, "const a = api('A', { url: todo() })"].join('\n')).replace(
          'import { agent',
          'import { todo, agent'
        ),
      },
      files: new Map(),
      catalog: TEST_CATALOG,
      sdkMajor: 1,
    })
    expect(findings(result, 'W_REQUIRED_MISSING').map((d) => d.param)).toEqual(['url'])
  })
})

describe('an options object passed to .to()', () => {
  it('says an edge takes no options and where block options go', () => {
    const result = run(
      [START, "const a = api('A', { url: 'https://x' })", 'start.to(a, { retry: true })'].join('\n')
    )
    const [refused] = findings(result, 'E_UNSUPPORTED_SYNTAX')
    expect(refused?.message).toBe('.to() takes blocks only; an edge has no options.')
    expect(refused?.hint).toBe(
      "Set a block's options, such as retry, in its builder's third argument: api('Name', { ... }, { retry: { enabled: true, maxTries: 3 } })."
    )
  })
})
