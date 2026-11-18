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
