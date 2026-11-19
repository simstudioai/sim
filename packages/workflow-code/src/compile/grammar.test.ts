import { describe, expect, it } from 'vitest'
import type { CompileDiagnosticCode } from '../diagnostics/codes'
import type { CanonicalBlock, CanonicalWorkflow } from '../model'
import { TEST_CATALOG } from './catalog.test-helpers'
import type { CompileResult } from './index'
import { compileWorkflow } from './index'

const IMPORTS =
  "import { agent, api, block, childWorkflow, codeFile, condition, credential, edge, env, file, fn, js, json, knowledgeBase, loop, md, note, parallel, raw, ref, router, slack, stored, t, table, todo, trigger, workflow } from '@sim/workflow-sdk'"

const DEFAULT_OPTIONS = "{ variables: { retries: { type: 'number', value: 3 } } }"

/** A workflow file whose body starts on line 5, indented two spaces. */
function source(body: string, options = DEFAULT_OPTIONS): string {
  const indented = body
    .split('\n')
    .map((line) => (line ? `  ${line}` : line))
    .join('\n')
  return `// @sim-sdk 1\n${IMPORTS}\n\nexport default workflow('Test', ${options}, ({ vars }) => {\n${indented}\n})\n`
}

const ENTRY = 'workflows/test.ts'

function run(text: string, files: Record<string, string> = {}, sdkMajor = 1): CompileResult {
  return compileWorkflow({
    entry: { path: ENTRY, text },
    files: new Map(Object.entries(files)),
    catalog: TEST_CATALOG,
    sdkMajor,
  })
}

function errorsOf(result: CompileResult) {
  return result.diagnostics.filter((d) => d.severity === 'error')
}

/** Compiles and requires zero errors; returns the workflow. */
function ok(text: string, files: Record<string, string> = {}): CanonicalWorkflow {
  const result = run(text, files)
  expect(errorsOf(result).map((d) => `${d.code}: ${d.message}`)).toEqual([])
  if (!result.workflow) throw new Error('expected a workflow')
  return result.workflow
}

function blockOf(workflow: CanonicalWorkflow, key: string): CanonicalBlock {
  const found = workflow.blocks[key]
  if (!found) throw new Error(`missing block ${key}`)
  return found
}

function paramValue(workflow: CanonicalWorkflow, key: string, param: string): unknown {
  const entry = blockOf(workflow, key).params[param]
  if (!entry) return undefined
  return entry.kind === 'value' ? entry.value : entry.tools
}

/** 1-based line and column of the first occurrence of `needle` in `text`. */
function locate(text: string, needle: string, occurrence = 1): { line: number; column: number } {
  let index = -1
  for (let n = 0; n < occurrence; n++) {
    index = text.indexOf(needle, index + 1)
    if (index === -1) throw new Error(`needle not found: ${needle}`)
  }
  const before = text.slice(0, index).split('\n')
  return { line: before.length, column: before[before.length - 1].length + 1 }
}

function spanOf(result: CompileResult, anchor: string) {
  return Object.entries(result.spans).find(([key]) => key === anchor)?.[1]
}

function expectDiagnostic(
  result: CompileResult,
  code: CompileDiagnosticCode,
  at: { line: number; column: number },
  hint?: string
) {
  const matches = result.diagnostics.filter((d) => d.code === code)
  expect(
    matches.map((d) => ({ line: d.span.line, column: d.span.column })),
    `diagnostics: ${result.diagnostics.map((d) => `${d.code}@${d.span.line}:${d.span.column}`).join(', ')}`
  ).toContainEqual(at)
  const match = matches.find((d) => d.span.line === at.line && d.span.column === at.column)
  if (hint !== undefined) expect(match?.hint).toBe(hint)
  expect(match?.frame).toContain('^')
  if (code.startsWith('E_')) expect(result.workflow).toBeNull()
}

const START = "const start = trigger.start('Start', {})"

describe('accepted grammar', () => {
  it('compiles literals, objects, arrays, negative numbers and drops a null param', () => {
    const wf = ok(
      source(
        [
          START,
          "const call = api('Call', { url: 'https://x', method: 'GET', headers: { Authorization: 'k', 'X-Id': 2, list: [true, null] }, body: { a: 1 } })",
          "const think = agent('Think', { model: 'm', temperature: -0.5, messages: null })",
          'start.to(call)',
          'call.to(think)',
        ].join('\n')
      )
    )
    expect(paramValue(wf, 'call', 'url')).toBe('https://x')
    expect(paramValue(wf, 'call', 'headers')).toEqual({
      Authorization: 'k',
      'X-Id': 2,
      list: [true, null],
    })
    expect(paramValue(wf, 'call', 'body')).toBe(JSON.stringify({ a: 1 }, null, 2))
    expect(paramValue(wf, 'think', 'temperature')).toBe(-0.5)
    expect(blockOf(wf, 'think').params).not.toHaveProperty('messages')
  })

  it('compiles tagged templates to text-identical stored strings', () => {
    const wf = ok(
      source(
        [
          START,
          "const a = agent('A', { model: t`Hi ${start.input} key ${env.API_KEY} n=${3} s=${'x'}`, temperature: 1 })",
          'const b = agent(\'B\', { model: `multi\\nline <literal.ref>`, responseFormat: json`{ "a": ${a.content} }` })',
          "const c = agent('C', { model: md`**bold**`, responseFormat: js`${a.content} === 'x'` })",
        ].join('\n')
      )
    )
    expect(paramValue(wf, 'a', 'model')).toBe('Hi <start.input> key {{API_KEY}} n=3 s=x')
    expect(paramValue(wf, 'b', 'model')).toBe('multi\nline <literal.ref>')
    expect(paramValue(wf, 'b', 'responseFormat')).toBe('{ "a": <a.content> }')
    expect(paramValue(wf, 'c', 'model')).toBe('**bold**')
    expect(paramValue(wf, 'c', 'responseFormat')).toBe("<a.content> === 'x'")
  })

  it('maps every ref path form exactly', () => {
    const wf = ok(
      source(
        [
          START,
          "const a = api('A', { url: start.input.items[0].id, headers: { k: start['some-field'], n: start.input['0'], whole: start, v: vars.retries, e: env.TOKEN, r: ref('Start.input') } })",
        ].join('\n')
      )
    )
    expect(paramValue(wf, 'a', 'url')).toBe('<start.input.items[0].id>')
    expect(paramValue(wf, 'a', 'headers')).toEqual({
      k: '<start.some-field>',
      n: '<start.input.0>',
      whole: '<start>',
      v: '<variable.retries>',
      e: '{{TOKEN}}',
      r: '<Start.input>',
    })
  })

  it('lifts resources, raw values and the generic block builder', () => {
    const wf = ok(
      source(
        [
          "const send = slack.sendMessage('Send', { authMethod: 'oauth', credential: credential('support-slack'), channel: 'C1', text: 'hi' })",
          "const row = table.insertRow('Row', { tableId: table('leads'), data: raw('{\"a\":1}') })",
          "const legacy = block('custom_block_x', 'Legacy', { a: knowledgeBase('docs'), b: childWorkflow('enrich'), c: file('files/a.pdf'), d: raw({ $sim: 'unresolved', kind: 'table', id: 't1' }), e: { $sim: 'plain' } }, { triggerMode: true })",
        ].join('\n')
      )
    )
    expect(paramValue(wf, 'send', 'credential')).toEqual({
      $sim: 'resource',
      kind: 'credential',
      key: 'support-slack',
    })
    expect(paramValue(wf, 'send', 'manualChannel')).toBe('C1')
    expect(paramValue(wf, 'send', 'operation')).toBe('send')
    expect(paramValue(wf, 'row', 'tableId')).toEqual({
      $sim: 'resource',
      kind: 'table',
      key: 'leads',
    })
    expect(paramValue(wf, 'row', 'data')).toBe('{"a":1}')
    const legacy = blockOf(wf, 'legacy')
    expect(legacy.type).toBe('custom_block_x')
    expect(legacy.triggerMode).toBe(true)
    expect(paramValue(wf, 'legacy', 'a')).toEqual({
      $sim: 'resource',
      kind: 'knowledge-base',
      key: 'docs',
    })
    expect(paramValue(wf, 'legacy', 'b')).toEqual({
      $sim: 'resource',
      kind: 'workflow',
      key: 'enrich',
    })
    expect(paramValue(wf, 'legacy', 'c')).toEqual({
      $sim: 'resource',
      kind: 'file',
      key: 'files/a.pdf',
    })
    expect(paramValue(wf, 'legacy', 'd')).toEqual({ $sim: 'unresolved', kind: 'table', id: 't1' })
    expect(paramValue(wf, 'legacy', 'e')).toEqual({ $sim: 'literal', value: { $sim: 'plain' } })
  })

  it('derives the basic/advanced member from the value kind', () => {
    const wf = ok(
      source(
        [
          "const b = slack.sendMessage('B', { authMethod: 'oauth', channel: 'C2', text: 'x' })",
          "const d = slack.sendMessage('D', { authMethod: 'oauth', text: 'x' })",
          "const e = slack.sendMessage('E', { authMethod: 'oauth', text: 'x' }, { advancedMode: true })",
        ].join('\n')
      )
    )
    expect(blockOf(wf, 'b').modes).toEqual({ channel: 'advanced' })
    expect(paramValue(wf, 'b', 'manualChannel')).toBe('C2')
    expect(blockOf(wf, 'b').params).not.toHaveProperty('channel')
    expect(blockOf(wf, 'd').modes).toEqual({ channel: 'basic' })
    expect(blockOf(wf, 'e').modes).toEqual({ channel: 'basic' })
    expect(blockOf(wf, 'e').advancedMode).toBe(true)
  })

  it('puts a list or object literal in the pair member that takes it as written, not JSON code', () => {
    const wf = ok(
      source(
        [
          "const list = table.insertRow('List', { filterInput: [{ column: 'a', operator: 'eq', value: '1' }] })",
          'const text = table.insertRow(\'Text\', { filterInput: json`{"field":"a"}` })',
        ].join('\n')
      )
    )
    expect(blockOf(wf, 'list').modes).toEqual({ filterInput: 'basic' })
    expect(paramValue(wf, 'list', 'filterBuilder')).toEqual([
      { column: 'a', operator: 'eq', value: '1' },
    ])
    expect(blockOf(wf, 'list').params).not.toHaveProperty('filter')
    expect(blockOf(wf, 'text').modes).toEqual({ filterInput: 'advanced' })
    expect(paramValue(wf, 'text', 'filter')).toBe('{"field":"a"}')
  })

  it('compiles named condition branches, an empty branch object and router routes', () => {
    const wf = ok(
      source(
        [
          START,
          "const a = agent('A', { model: 'm' })",
          "const route = condition('Route', { billing: js`${a.content} === 'billing'`, urgent: 'x > 1', else: '' })",
          "const blank = condition('Blank', {})",
          "const triage = router('Triage', { context: 'c', routes: { small: 'Under $100', big: 'Over' } })",
          "const escalate = agent('Escalate', { model: 'm' })",
          'start.to(a)',
          'a.to(route)',
          'route.billing.to(triage)',
          'route.else.to(blank)',
          'blank.if.to(triage)',
          'triage.big.to(escalate)',
        ].join('\n')
      )
    )
    expect(blockOf(wf, 'route').branches).toEqual({
      kind: 'condition',
      rows: [
        { key: 'billing', value: "<a.content> === 'billing'" },
        { key: 'urgent', value: 'x > 1' },
        { key: 'else', value: '' },
      ],
    })
    expect(blockOf(wf, 'blank').branches).toEqual({ kind: 'condition', rows: null })
    expect(blockOf(wf, 'triage').branches).toEqual({
      kind: 'router',
      rows: [
        { key: 'small', value: 'Under $100' },
        { key: 'big', value: 'Over' },
      ],
    })
    expect(blockOf(wf, 'triage').params).not.toHaveProperty('routes')
    expect(wf.edges).toContainEqual({
      from: 'route',
      port: { kind: 'branch', key: 'billing' },
      to: 'triage',
    })
    expect(wf.edges).toContainEqual({
      from: 'blank',
      port: { kind: 'branch', key: 'if' },
      to: 'triage',
    })
    expect(wf.edges).toContainEqual({
      from: 'triage',
      port: { kind: 'branch', key: 'big' },
      to: 'escalate',
    })
  })

  it('references a block whose key holds characters a reference carries', () => {
    const wf = ok(
      source(
        "const its = api(\"it's\", { url: 'x' })\nconst b = api('B', { url: t`${its.data}`, body: its })"
      )
    )
    expect(paramValue(wf, 'b', 'url')).toBe("<it's.data>")
    expect(paramValue(wf, 'b', 'body')).toBe("<it's>")
  })

  it('compiles loops and parallels with innermost and named loop params', () => {
    const wf = ok(
      source(
        [
          START,
          "const each = loop.forEach('Each', { collection: start.input.items }, (p) => {",
          "  const inner = api('Inner', { url: t`https://x/${p.currentItem.id}` })",
          "  const fan = parallel.collection('Fan', { collection: p.items, batchSize: 4 }, (q) => {",
          "    const leaf = api('Leaf', { url: t`${q.index}/${p.index}/${each.index}` })",
          '    q.to(leaf)',
          '  })',
          "  const deep = loop.for('Deep', { count: 2 }, (r) => {",
          "    const bottom = api('Bottom', { url: t`${p.index}/${r.index}` })",
          '    r.to(bottom)',
          '  })',
          '  p.to(inner)',
          '  inner.to(fan)',
          '  fan.to(deep)',
          '})',
          "const quick = parallel.count('Quick', { count: 3 }, (s) => api('Solo', { url: 'x' }))",
          "const after = api('After', { url: t`${each.results}` })",
          'start.to(each)',
          'each.to(after)',
          'after.to(quick)',
        ].join('\n')
      )
    )
    expect(blockOf(wf, 'each').subflow).toEqual({
      kind: 'loop',
      loopType: 'forEach',
      iterations: 5,
      forEachItems: '<start.input.items>',
    })
    expect(blockOf(wf, 'fan').subflow).toEqual({
      kind: 'parallel',
      parallelType: 'collection',
      distribution: '<loop.items>',
      batchSize: 4,
    })
    expect(blockOf(wf, 'deep').subflow).toMatchObject({ loopType: 'for', iterations: 2 })
    expect(blockOf(wf, 'inner').parent).toBe('each')
    expect(blockOf(wf, 'leaf').parent).toBe('fan')
    expect(blockOf(wf, 'solo').parent).toBe('quick')
    expect(paramValue(wf, 'inner', 'url')).toBe('https://x/<loop.currentItem.id>')
    expect(paramValue(wf, 'leaf', 'url')).toBe('<parallel.index>/<loop.index>/<each.index>')
    expect(paramValue(wf, 'bottom', 'url')).toBe('<each.index>/<loop.index>')
    expect(paramValue(wf, 'after', 'url')).toBe('<each.results>')
    expect(wf.edges).toContainEqual({ from: 'each', port: { kind: 'subflowStart' }, to: 'inner' })
    expect(wf.edges).toContainEqual({ from: 'deep', port: { kind: 'subflowStart' }, to: 'bottom' })
    expect(wf.edges).toContainEqual({ from: 'quick', port: { kind: 'subflowStart' }, to: 'solo' })
    expect(wf.edges).toContainEqual({ from: 'each', port: { kind: 'subflowEnd' }, to: 'after' })
  })

  it('compiles fan-out, chains, fan-in groups, error edges and raw handles', () => {
    const text = source(
      [
        START,
        "const a = api('A', { url: 'a' })",
        "const b = api('B', { url: 'b' })",
        "const c = api('C', { url: 'c' })",
        "const d = api('D', { url: 'd' })",
        "const e = api('E', { url: 'e' })",
        'start.to(a, b)',
        'a.to(c).to(d)',
        'b.to(c, d).to(e)',
        'c.onError(d)',
        "edge(d, 'legacy-handle', e)",
      ].join('\n')
    )
    const result = run(text)
    expect(errorsOf(result)).toEqual([])
    const wf = result.workflow
    if (!wf) throw new Error('expected a workflow')
    expect(wf.edges).toEqual([
      { from: 'a', port: { kind: 'out' }, to: 'c' },
      { from: 'b', port: { kind: 'out' }, to: 'c' },
      { from: 'b', port: { kind: 'out' }, to: 'd' },
      { from: 'c', port: { kind: 'error' }, to: 'd' },
      { from: 'c', port: { kind: 'out' }, to: 'd' },
      { from: 'c', port: { kind: 'out' }, to: 'e' },
      { from: 'd', port: { kind: 'out' }, to: 'e' },
      { from: 'd', port: { kind: 'raw', handle: 'legacy-handle' }, to: 'e' },
      { from: 'start', port: { kind: 'out' }, to: 'a' },
      { from: 'start', port: { kind: 'out' }, to: 'b' },
    ])
    expect(blockOf(wf, 'c').errorPort).toBe(true)
    expect(blockOf(wf, 'd').errorPort).toBe(false)
    expectDiagnostic(result, 'W_RAW_HANDLE', locate(text, 'edge(d'))
  })

  it('compiles block meta and extra fields', () => {
    const text = source(
      [
        "const s = slack.sendMessage('S', { authMethod: 'oauth', text: 'x' }, { disabled: true, locked: true, errorPort: true, retry: { enabled: true, maxTries: 3, waitBetweenTriesMs: 1000 }, extra: { legacyField: 'old' } })",
        "const l = loop.for('L', { count: 2 }, (p) => {\n  const a = api('A', { url: 'u' })\n  p.to(a)\n}, { extra: { note: 'kept' }, subflowData: { loopType: 'weird' } })",
      ].join('\n')
    )
    const result = run(text)
    expect(errorsOf(result)).toEqual([])
    const wf = result.workflow
    if (!wf) throw new Error('expected a workflow')
    expect(blockOf(wf, 's')).toMatchObject({
      enabled: false,
      locked: true,
      errorPort: true,
      retry: { enabled: true, maxTries: 3, waitBetweenTriesMs: 1000 },
    })
    expect(paramValue(wf, 's', 'legacyField')).toBe('old')
    expect(blockOf(wf, 'l').extra).toEqual({ loopType: 'weird' })
    expect(paramValue(wf, 'l', 'note')).toBe('kept')
  })

  it('pins the trigger builder, its fixed values and the operation', () => {
    const wf = ok(
      source(
        "const mail = trigger.gmail.poller('Mail', { credential: credential('g'), labelIds: ['INBOX'], markAsRead: true })"
      )
    )
    const mail = blockOf(wf, 'mail')
    expect(mail).toMatchObject({ type: 'gmail', triggerMode: true })
    expect(paramValue(wf, 'mail', 'selectedTriggerId')).toBe('gmail_poller')
    expect(paramValue(wf, 'mail', 'labelIds')).toEqual(['INBOX'])
  })

  it('reads function code from files, rewriting $ref and $env for JavaScript only', () => {
    const result = run(
      source(
        [
          START,
          "const score = fn('Score', { language: 'javascript', code: codeFile('./fns/score.js') })",
          "const py = fn('Py', { language: 'python', code: codeFile('./fns/py.py') })",
        ].join('\n')
      ),
      {
        'workflows/fns/score.js': 'return $ref.start.input + $env.KEY // $ref.x',
        'workflows/fns/py.py': 'print($ref.start.input)',
      }
    )
    expect(errorsOf(result)).toEqual([])
    const wf = result.workflow
    if (!wf) throw new Error('expected a workflow')
    expect(paramValue(wf, 'score', 'code')).toBe('return <start.input> + {{KEY}} // $ref.x')
    expect(paramValue(wf, 'py', 'code')).toBe('print($ref.start.input)')
    expect(result.hints.blocks.score).toEqual({
      ident: 'score',
      order: 1,
      codeFile: 'workflows/fns/score.js',
    })
  })

  it('accepts a bare builder statement as an unbound block', () => {
    const result = run(source("note('How it works', { content: md`**Polls** inbox` })"))
    expect(errorsOf(result)).toEqual([])
    expect(result.workflow?.blocks.howitworks?.params.content).toEqual({
      kind: 'value',
      value: '**Polls** inbox',
    })
    expect(result.hints.blocks.howitworks).toEqual({ order: 0 })
  })

  it('compiles the workflow header, variables and sdk major', () => {
    const result = run(
      source(
        START,
        "{ description: 'Does things', variables: { 'My Count': { type: 'number', value: 0 }, flags: { type: 'object', value: { a: [1] } } } }"
      )
    )
    expect(errorsOf(result)).toEqual([])
    expect(result.sdkMajor).toBe(1)
    expect(result.workflow?.meta).toEqual({ name: 'Test', description: 'Does things' })
    expect(result.workflow?.variables).toEqual({
      mycount: { key: 'mycount', name: 'My Count', type: 'number', value: 0 },
      flags: { key: 'flags', name: 'flags', type: 'object', value: { a: [1] } },
    })
  })

  it('resolves vars.<key as declared> to the normalized variable key the SDK types it by', () => {
    const wf = ok(
      source(
        `${START}\nconst a = api('A', { url: vars.MyVar, body: t\`\${vars['My Var']}\` })`,
        "{ variables: { MyVar: { type: 'string', value: '' } } }"
      )
    )
    expect(paramValue(wf, 'a', 'url')).toBe('<variable.myvar>')
    expect(paramValue(wf, 'a', 'body')).toBe('<variable.myvar>')
  })

  it('collects comments at anchors and reports spans by anchor', () => {
    const text = [
      '// @sim-sdk 1',
      '// Header note',
      IMPORTS,
      '',
      "export default workflow('Test', {}, () => {",
      '  // About start',
      "  const start = trigger.start('Start', {}) // trailing start",
      "  const call = api('Call', {",
      '    // the endpoint',
      "    url: 'https://x',",
      '    headers: { a: [1 /* inner */] },',
      '  })',
      '',
      '  // Wiring follows',
      '',
      '  // start feeds call',
      '  start.to(call)',
      '  // the end',
      '})',
      '',
    ].join('\n')
    const result = run(text)
    expect(errorsOf(result)).toEqual([])
    expect(result.workflow?.annotations.comments).toEqual({
      header: [{ text: ' Header note', kind: 'line', placement: 'leading' }],
      'block:start': [
        { text: ' About start', kind: 'line', placement: 'leading' },
        { text: ' trailing start', kind: 'line', placement: 'trailing' },
      ],
      'param:call:url': [{ text: ' the endpoint', kind: 'line', placement: 'leading' }],
      'param:call:headers': [{ text: ' inner ', kind: 'block', placement: 'leading' }],
      wiring: [{ text: ' Wiring follows', kind: 'line', placement: 'leading' }],
      'edges:start:out': [{ text: ' start feeds call', kind: 'line', placement: 'leading' }],
      footer: [{ text: ' the end', kind: 'line', placement: 'leading' }],
    })
    expectDiagnostic(result, 'W_COMMENT_MOVED', locate(text, '/* inner */'))
    expect(spanOf(result, 'block:call')).toMatchObject({
      file: ENTRY,
      line: 8,
      column: 3,
      endLine: 12,
    })
    expect(spanOf(result, 'param:call:url')).toMatchObject({ line: 10, column: 5 })
    expect(spanOf(result, 'edges:start:out')).toMatchObject({ line: 17, column: 3 })
    expect(result.hints.blocks).toEqual({
      start: { ident: 'start', order: 0 },
      call: { ident: 'call', order: 1 },
    })
  })
})

describe('warnings that never block a compile', () => {
  it.each([
    [
      'a ref to a block declared later',
      "const a = api('A', { url: b.data })\nconst b = api('B', { url: 'x' })",
      'W_FORWARD_REF',
      'b.data',
    ],
    [
      'an output path the block does not declare',
      "const a = api('A', { url: 'x' })\nconst b = api('B', { url: a.nope })",
      'W_UNKNOWN_OUTPUT_PATH',
      'a.nope',
    ],
    [
      'a nested output path the block does not declare',
      "const a = api('A', { url: 'x' })\nconst b = api('B', { url: a.headers.nope })",
      'W_UNKNOWN_OUTPUT_PATH',
      'a.headers.nope',
    ],
    [
      'a field hidden under the current operation',
      "const s = slack.sendMessage('S', { authMethod: 'oauth', text: 'x', limit: 3 })",
      'W_FIELD_NOT_APPLICABLE',
      'limit: 3',
    ],
    [
      'a value of the wrong JSON type',
      "const a = agent('A', { model: 'm', temperature: '0.5' })",
      'W_VALUE_KIND',
      "temperature: '0.5'",
    ],
    [
      'a required field written as todo()',
      "const a = api('A', { url: todo() })",
      'W_REQUIRED_MISSING',
      'url: todo()',
    ],
    ['a required field left out', "const a = api('A', {})", 'W_REQUIRED_MISSING', "api('A'"],
    [
      'a loop count of 0',
      "const l = loop.for('L', { count: 0 }, (p) => {})",
      'W_SUBFLOW_COUNT',
      '0 }',
    ],
    [
      'a fractional negative loop count',
      "const l = loop.doWhile('L', { count: -3.5 }, (p) => {})",
      'W_SUBFLOW_COUNT',
      '-3.5',
    ],
    [
      'a parallel batch size past the runtime limit',
      "const p = parallel.count('P', { count: 3, batchSize: 500 }, (b) => {})",
      'W_SUBFLOW_COUNT',
      '500',
    ],
  ] as const)('warns on %s', (_label, body, code, needle) => {
    const text = source(body)
    const result = run(text)
    expect(errorsOf(result)).toEqual([])
    expect(result.workflow).not.toBeNull()
    expectDiagnostic(result, code, locate(text, needle))
  })

  it('skips output-path checks on an input format the compiler cannot read', () => {
    const result = run(
      source(
        "const h = human('H', { inputFormat: vars.retries })\nconst b = api('B', { url: h.anything.goes })"
      )
    )
    expect(result.diagnostics.map((d) => d.code)).not.toContain('W_UNKNOWN_OUTPUT_PATH')
  })
})

describe('errors, each with its code, location and hint', () => {
  it.each([
    ['a syntax error', 'const = 1', 'E_SYNTAX', '= 1', undefined],
    [
      'an unknown builder',
      "const a = slack.sendMesage('A', {})",
      'E_UNKNOWN_BUILDER',
      'slack.sendMesage',
      'Did you mean slack.sendMessage?',
    ],
    [
      'an unknown param',
      "const a = api('A', { url: 'x', bodyy: 'y' })",
      'E_UNKNOWN_PARAM',
      'bodyy',
      'Did you mean body?',
    ],
    [
      'a pair member written by its own id',
      "const a = slack.sendMessage('A', { authMethod: 'oauth', manualChannel: 'C', text: 'x' })",
      'E_UNKNOWN_PARAM',
      'manualChannel',
      'Write it as channel; the value kind picks the basic or advanced field.',
    ],
    [
      'a param the builder pins',
      "const a = slack.sendMessage('A', { operation: 'send', text: 'x' })",
      'E_FIXED_PARAM',
      'operation',
      undefined,
    ],
    [
      'a tool param the builder pins',
      "const a = agent('A', { model: 'm', tools: [slack.tool.sendMessage({ operation: 'list_channels', text: 'x' })] })",
      'E_FIXED_PARAM',
      'operation',
      'Remove operation; the method name pins it.',
    ],
    [
      "a tool's operation option the method pins",
      "const a = agent('A', { model: 'm', tools: [slack.tool.sendMessage({ text: 'x' }, { operation: 'list_channels' })] })",
      'E_FIXED_PARAM',
      'operation',
      'Remove operation; the method name pins it.',
    ],
    [
      'a trigger builder as an agent tool',
      "const a = agent('A', { model: 'm', tools: [trigger.gmail.tool.poller({ selectedTriggerId: 'other' })] })",
      'E_UNKNOWN_BUILDER',
      'trigger.gmail.tool.poller',
      "Write an integration operation as namespace.tool.method(params), a child workflow as childWorkflow('key').asTool(), or any other stored tool as raw(tool).",
    ],
    [
      'a core block builder as an agent tool',
      "const a = agent('A', { model: 'm', tools: [api.tool({ url: 'x' })] })",
      'E_UNKNOWN_BUILDER',
      'api.tool',
      "Write an integration operation as namespace.tool.method(params), a child workflow as childWorkflow('key').asTool(), or any other stored tool as raw(tool).",
    ],
    [
      'two blocks whose names normalize alike',
      "const a = api('My Block', { url: 'x' })\nconst b = api('my.block', { url: 'y' })",
      'E_DUPLICATE_NAME',
      "'my.block'",
      undefined,
    ],
    [
      'a reserved name',
      "const a = api('Loop', { url: 'x' })",
      'E_RESERVED_NAME',
      "'Loop'",
      undefined,
    ],
    ['an empty name', "const a = api(' ', { url: 'x' })", 'E_EMPTY_NAME', "' '", undefined],
    [
      'a name that is not a literal',
      "const a = api(t`A${1}`, { url: 'x' })",
      'E_NAME_NOT_LITERAL',
      't`A${1}`',
      undefined,
    ],
    [
      'an unknown identifier',
      "const start = trigger.start('Start', {})\nconst a = api('A', { url: strt.input })",
      'E_UNKNOWN_IDENTIFIER',
      'strt',
      'Did you mean start?',
    ],
    [
      'a ref into a sibling subflow child',
      "const l = loop.for('L', { count: 1 }, (p) => {\n  const inside = api('Inside', { url: 'x' })\n  p.to(inside)\n})\nconst out = api('Out', { url: inside.data })",
      'E_OUT_OF_SCOPE',
      'inside.data',
      undefined,
    ],
    [
      'an undeclared variable',
      "const a = api('A', { url: vars.retires })",
      'E_UNKNOWN_VARIABLE',
      'vars.retires',
      'Did you mean vars.retries?',
    ],
    [
      'an env name outside the pattern',
      "const a = api('A', { url: env['bad-name'] })",
      'E_INVALID_ENV_NAME',
      "env['bad-name']",
      undefined,
    ],
    [
      'an unknown loop property',
      "const l = loop.forEach('L', { collection: [] }, (p) => {\n  const a = api('A', { url: p.curentItem })\n  p.to(a)\n})",
      'E_UNKNOWN_SUBFLOW_PROPERTY',
      'p.curentItem',
      'Did you mean p.currentItem?',
    ],
    [
      'subflow data on a block that is not a container',
      "const s = slack.sendMessage('S', { authMethod: 'oauth', text: 'x' }, { subflowData: { count: 2 } })",
      'E_UNSUPPORTED_SYNTAX',
      'subflowData: { count: 2 }',
      'Remove subflowData; apply keeps the stored block data.',
    ],
    [
      'an extra field the block declares as a param',
      "const s = slack.sendMessage('S', { authMethod: 'oauth', text: 'x' }, { extra: { threadTs: '1' } })",
      'E_UNSUPPORTED_SYNTAX',
      "threadTs: '1'",
      'Write it in params.',
    ],
    [
      'a reference to a block whose key reads as text',
      "const qa = api('Q&A', { url: 'x' })\nconst b = api('B', { url: t`${qa.data}` })",
      'E_REF_UNREPRESENTABLE',
      'qa.data',
      'Rename the block without any of < > = + * / ! & | [ ].',
    ],
    [
      'a reference to a block whose key ends the token early',
      "const xy = api('x>y', { url: 'x' })\nconst b = api('B', { body: xy })",
      'E_REF_UNREPRESENTABLE',
      'xy }',
      undefined,
    ],
    [
      'a reference to a block whose key holds a bracket',
      "const ab = api('a.b[0]', { url: 'x' })\nconst b = api('B', { url: ab.data })",
      'E_REF_UNREPRESENTABLE',
      'ab.data',
      undefined,
    ],
    [
      'a named loop param of a loop whose key reads as text',
      "const outer = loop.for('Q&A', { count: 1 }, (p) => {\n  const inner = loop.for('In', { count: 1 }, (r) => {\n    const a = api('A', { url: t`${p.index}` })\n    r.to(a)\n  })\n  p.to(inner)\n})",
      'E_REF_UNREPRESENTABLE',
      'p.index',
      undefined,
    ],
    [
      'two variables whose names normalize alike',
      START,
      'E_DUPLICATE_VARIABLE',
      "'A B'",
      undefined,
      "{ variables: { ab: { type: 'string', value: '' }, 'A B': { type: 'string', value: '' } } }",
    ],
    [
      'a variable name that does not normalize to its key',
      START,
      'E_VARIABLE_NAME_MISMATCH',
      "'Total'",
      undefined,
      "{ variables: { count: { name: 'Total', type: 'number', value: 1 } } }",
    ],
    [
      'a resource inside a JSON field literal',
      "table.insertRow('Row', { data: { id: table('orders') } })",
      'E_UNSUPPORTED_SYNTAX',
      "table('orders')",
      'Write a string, number, boolean, null, array or object here.',
    ],
    [
      'a canonical node inside a JSON field literal',
      "table.insertRow('Row', { data: [raw({ $sim: 'var', key: 'retries' })] })",
      'E_UNSUPPORTED_SYNTAX',
      'raw({',
      'Write a string, number, boolean, null, array or object here.',
    ],
    [
      'an unresolved node of an unknown kind',
      "const a = api('A', { url: raw({ $sim: 'unresolved', kind: 'spreadsheet', id: 's1' }) })",
      'E_UNSUPPORTED_SYNTAX',
      "{ $sim: 'unresolved'",
      "Use { $sim: 'resource', kind, key }, { $sim: 'unresolved', kind, id }, { $sim: 'var', key }, { $sim: 'csv', items } or { $sim: 'literal', value }.",
    ],
    [
      'a malformed tool in raw([...])',
      "const a = agent('A', { model: 'm', tools: raw([{ type: 'x', params: {}, modes: {} }, { type: 'y' }]) })",
      'E_UNSUPPORTED_SYNTAX',
      "{ type: 'y' }",
      'Write raw({ type, params: {}, modes: {} }).',
    ],
    [
      'a template tag called as a function',
      "const a = api('A', { url: t('x') })",
      'E_UNSUPPORTED_SYNTAX',
      "t('x')",
      'Use t`...` as a tagged template.',
    ],
    [
      'edge() written as a value',
      "const a = api('A', { url: 'x' })\nconst b = api('B', { url: edge(a, 'source', a) })",
      'E_UNSUPPORTED_SYNTAX',
      'edge(a',
      'edge(...) is wiring; write it as its own statement.',
    ],
    [
      'a block builder written as a value',
      "const a = api('A', { url: api('B', { url: 'x' }) })",
      'E_UNSUPPORTED_SYNTAX',
      "api('B'",
      'Declare the block with const and pass its name.',
    ],
    [
      'a boolean meta field that is not a boolean literal',
      "const a = api('A', { url: 'x' }, { disabled: 1 })",
      'E_UNSUPPORTED_SYNTAX',
      '1 })',
      'Write true or false.',
    ],
    [
      'codeFile() in an extra field',
      "const a = api('A', { url: 'x' }, { extra: { script: codeFile('./fns/a.js') } })",
      'E_UNSUPPORTED_SYNTAX',
      "codeFile('./fns/a.js') }",
      "Write code: codeFile('./functions/x.js').",
    ],
    [
      'todo() in an extra field',
      "const a = api('A', { url: 'x' }, { extra: { later: todo() } })",
      'E_UNSUPPORTED_SYNTAX',
      'todo() }',
      'Write todo() as the param value.',
    ],
    [
      'a wiring target nothing declares',
      `${START}\nconst fetchUser = api('Fetch', { url: 'x' })\nstart.to(fetchUsr)`,
      'E_UNKNOWN_IDENTIFIER',
      'fetchUsr)',
      'Did you mean fetchUser?',
    ],
    [
      'a wiring source nothing declares',
      `${START}\nconst a = api('A', { url: 'x' })\nstrt.to(a)`,
      'E_UNKNOWN_IDENTIFIER',
      'strt.to',
      'Did you mean start?',
    ],
    [
      'an edge() end nothing declares',
      `${START}\nconst fetchUser = api('Fetch', { url: 'x' })\nedge(start, 'source', fetchUsr)`,
      'E_UNKNOWN_IDENTIFIER',
      'fetchUsr)',
      'Did you mean fetchUser?',
    ],
    [
      'a wiring target inside a loop',
      `${START}\nconst l = loop.for('L', { count: 1 }, (p) => {\n  const inside = api('Inside', { url: 'x' })\n  p.to(inside)\n})\nstart.to(inside)`,
      'E_OUT_OF_SCOPE',
      'inside)\n}',
      undefined,
    ],
    [
      'a generic block whose type is not a literal',
      "const a = block(kind, 'Thing', {})",
      'E_UNSUPPORTED_SYNTAX',
      'kind,',
      "Write block('custom_type', 'Name', { ... }).",
    ],
    [
      'a variable without a type',
      START,
      'E_UNSUPPORTED_SYNTAX',
      "{ value: '' }",
      "Write type: 'string'.",
      "{ variables: { a: { value: '' } } }",
    ],
    [
      'a variable with neither a type nor a value',
      START,
      'E_UNSUPPORTED_SYNTAX',
      '{} }',
      "Write type: 'string'.",
      '{ variables: { a: {} } }',
    ],
  ] as const)('reports %s', (_label, body, code, needle, hint, options?: string) => {
    const text = source(body, options)
    expectDiagnostic(run(text), code, locate(text, needle), hint)
  })

  it.each([
    [
      'an edge across subflow scopes',
      "const out = api('Out', { url: 'x' })\nconst l = loop.for('L', { count: 1 }, (p) => {\n  const inside = api('Inside', { url: 'x' })\n  p.to(inside)\n  inside.to(out)\n})",
      'E_EDGE_SCOPE',
      'inside.to(out)',
    ],
    [
      'a container end edge into its own child',
      "const l = loop.for('L', { count: 1 }, (p) => {\n  const inside = api('Inside', { url: 'x' })\n  l.to(inside)\n})",
      'E_EDGE_SCOPE',
      'l.to(inside)',
    ],
    [
      'an edge into a note',
      "const a = api('A', { url: 'x' })\nconst n = note('N', { content: 'x' })\na.to(n)",
      'E_EDGE_NOTE',
      'a.to(n)',
    ],
    [
      'an edge into a trigger',
      `${START}\nconst a = api('A', { url: 'x' })\na.to(start)`,
      'E_TARGET_TRIGGER',
      'a.to(start)',
    ],
    [
      '.to() directly on a condition',
      "const c = condition('C', { if: 'true', else: '' })\nconst a = api('A', { url: 'x' })\nc.to(a)",
      'E_NO_DEFAULT_OUTPUT',
      'c.to(a)',
    ],
    [
      'a duplicate edge',
      "const a = api('A', { url: 'x' })\nconst b = api('B', { url: 'x' })\na.to(b)\na.to(b)",
      'E_DUPLICATE_EDGE',
      'a.to(b)',
    ],
    [
      'an error edge from a block without an error port',
      `${START}\nconst a = api('A', { url: 'x' })\nstart.onError(a)`,
      'E_ERROR_PORT_UNSUPPORTED',
      'start.onError(a)',
    ],
    [
      'an unknown branch',
      "const c = condition('C', { if: 'true', else: '' })\nconst a = api('A', { url: 'x' })\nc.nope.to(a)",
      'E_UNKNOWN_BRANCH',
      'c.nope.to(a)',
    ],
    [
      'a duplicate branch key',
      "const c = condition('C', { yes: 'a', yes: 'b', else: '' })",
      'E_DUPLICATE_BRANCH_KEY',
      "yes: 'b'",
    ],
    [
      'a branch key colliding with an output',
      "const c = condition('C', { selectedPath: 'a', else: '' })",
      'E_BRANCH_KEY_COLLIDES',
      'selectedPath',
    ],
    [
      'a branch key colliding with an edge method',
      "const c = condition('C', { to: 'a', else: '' })",
      'E_BRANCH_KEY_COLLIDES',
      'to:',
    ],
    [
      'a condition that does not end with else',
      "const c = condition('C', { a: 'x', b: 'y' })",
      'E_BRANCH_ELSE_LAST',
      "b: 'y'",
    ],
    [
      'a missing code file',
      "const f = fn('F', { code: codeFile('./fns/missing.js') })",
      'E_CODE_FILE_MISSING',
      "'./fns/missing.js'",
    ],
    [
      'a code file outside the repo',
      "const f = fn('F', { code: codeFile('../../../x.js') })",
      'E_CODE_FILE_PATH',
      "'../../../x.js'",
    ],
    [
      'a code file whose extension does not match the language',
      "const f = fn('F', { language: 'python', code: codeFile('./fns/a.js') })",
      'E_CODE_FILE_PATH',
      "'./fns/a.js'",
    ],
  ] as const)('reports %s', (_label, body, code, needle) => {
    const text = source(body)
    expectDiagnostic(
      run(text, { 'workflows/fns/a.js': 'return 1' }),
      code,
      locate(text, needle, code === 'E_DUPLICATE_EDGE' ? 2 : 1)
    )
  })

  it('attributes a wiring error to the source block', () => {
    const text = source(
      "const a = api('A', { url: 'x' })\nconst b = api('B', { url: 'x' })\na.to(b)\na.to(b)"
    )
    const duplicate = run(text).diagnostics.find((d) => d.code === 'E_DUPLICATE_EDGE')
    expect(duplicate?.blockKey).toBe('a')
  })

  it('points a duplicate name at the first declaration', () => {
    const text = source(
      "const a = api('My Block', { url: 'x' })\nconst b = api('my.block', { url: 'y' })"
    )
    const duplicate = run(text).diagnostics.find((d) => d.code === 'E_DUPLICATE_NAME')
    expect(duplicate?.related).toEqual([
      expect.objectContaining({ span: expect.objectContaining(locate(text, "'My Block'")) }),
    ])
  })

  it('warns at the file location when a code file $ref names no block, variable or output', () => {
    const text = source(
      [
        START,
        "const classifier = agent('Triage Agent', { model: 'm' })",
        "const lookup = api('Lookup', { url: 'x' })",
        "const f = fn('F', { code: codeFile('./fns/f.js') })",
      ].join('\n')
    )
    const file = [
      'const a = $ref.classifier.content',
      'const b = $ref.lookup.nope',
      'const c = $ref.variable.missing',
      'const d = $ref.triageagent.content + $ref.lookup.data + $ref.start.input + $ref.variable.retries',
    ].join('\n')
    const result = run(text, { 'workflows/fns/f.js': file })
    expect(errorsOf(result)).toEqual([])
    const unresolved = result.diagnostics.filter((d) => d.code === 'W_UNRESOLVED_REF')
    expect(unresolved).toEqual([
      expect.objectContaining({
        span: expect.objectContaining({ file: 'workflows/fns/f.js', line: 1, column: 11 }),
        hint: expect.stringContaining('$ref.triageagent.content'),
      }),
      expect.objectContaining({
        span: expect.objectContaining({ file: 'workflows/fns/f.js', line: 3 }),
      }),
    ])
    const outputPath = result.diagnostics.filter((d) => d.code === 'W_UNKNOWN_OUTPUT_PATH')
    expect(outputPath).toEqual([
      expect.objectContaining({
        span: expect.objectContaining({ file: 'workflows/fns/f.js', line: 2 }),
      }),
    ])
  })

  it('reports a syntax error inside a code file at its own location', () => {
    const result = run(source("const f = fn('F', { code: codeFile('./fns/bad.js') })"), {
      'workflows/fns/bad.js': 'return (',
    })
    const syntax = result.diagnostics.find((d) => d.code === 'E_SYNTAX')
    expect(syntax?.span).toMatchObject({ file: 'workflows/fns/bad.js', line: 1 })
    expect(result.workflow).toBeNull()
  })

  it('reads the header behind a leading byte order mark', () => {
    const result = run(`\uFEFF${source("const a = api('A', { url: 'x' })")}`)
    expect(errorsOf(result)).toEqual([])
    expect(result.sdkMajor).toBe(1)
  })

  it('reports a missing header, a newer major and a missing or repeated default export', () => {
    const noHeader = `${IMPORTS}\nexport default workflow('X', {}, () => {})\n`
    expectDiagnostic(
      run(noHeader),
      'E_SDK_HEADER',
      { line: 1, column: 1 },
      'Start the file with // @sim-sdk 1.'
    )
    const newer = `// @sim-sdk 2\n${IMPORTS}\nexport default workflow('X', {}, () => {})\n`
    const newerResult = run(newer)
    expect(newerResult.sdkMajor).toBe(2)
    expectDiagnostic(newerResult, 'E_SDK_MAJOR', { line: 1, column: 1 })
    const none = `// @sim-sdk 1\n${IMPORTS}\n`
    expectDiagnostic(run(none), 'E_WORKFLOW_EXPORT', { line: 1, column: 1 })
    const notWorkflow = `// @sim-sdk 1\n${IMPORTS}\nexport default api('X', {})\n`
    expectDiagnostic(run(notWorkflow), 'E_WORKFLOW_EXPORT', locate(notWorkflow, "api('X'"))
  })
})

describe('rejected constructs', () => {
  const LET = 'Use const; blocks are immutable declarations.'
  const NON_BUILDER =
    'Only blocks can be named. Inline the value, or declare a workflow variable and use vars.x.'
  const DESTRUCTURE = 'Bind the block and use blk.field.'
  const HELPERS =
    "Helpers aren't supported in workflow files; put logic in a function block with code: codeFile('./functions/x.js')."
  const CONTROL =
    "Control flow can't create blocks. Use condition()/router() for branching and loop()/parallel() for iteration."
  const SPREAD = 'Write each field explicitly.'
  const COMPUTED = 'Use a literal key.'
  const EXPRESSIONS =
    "Expressions aren't evaluated. Use t`` to build strings, or js`` for a condition."
  const TYPES = 'Types come from the SDK; remove this.'
  const CALLS = 'Only SDK calls are allowed; nothing in a workflow file runs.'
  const UNTAGGED = 'Use t`` so interpolations become references.'
  const TAG = 'Use t`` for text, js`` for code, json`` for JSON or md`` for markdown.'
  const LITERAL_KIND =
    "Regex and BigInt literals aren't values; write the pattern or number as a string."
  const ELEMENT = "Use a literal key: blk['key'] or blk[0]."
  const IMPORT =
    "Only '@sim/workflow-sdk' is importable; reference function files with codeFile('./functions/x.js')."
  const EXTRA =
    'A workflow file holds imports and one export default workflow(...); move this inside the workflow body or delete it.'
  const NAMED_EXPORT = 'Only export default workflow(...) is allowed; remove this export.'

  it.each([
    ['let', "let a = api('A', { url: 'x' })", 'let a', LET],
    ['var', "var a = api('A', { url: 'x' })", 'var a', LET],
    ['a non-builder const', "const x = 'value'", "const x = 'value'", NON_BUILDER],
    ['a resource const', "const x = credential('k')", "const x = credential('k')", NON_BUILDER],
    ['destructuring', "const { a } = api('A', { url: 'x' })", '{ a }', DESTRUCTURE],
    ['a function declaration', 'function helper() {}', 'function helper', HELPERS],
    ['a class', 'class Helper {}', 'class Helper', HELPERS],
    ['a helper arrow', 'const h = () => 1', '() => 1', HELPERS],
    ['if', 'if (true) {}', 'if (true)', CONTROL],
    ['for', 'for (const x of []) {}', 'for (', CONTROL],
    ['while', 'while (false) {}', 'while', CONTROL],
    ['switch', 'switch (1) {}', 'switch', CONTROL],
    ['try', 'try {} catch {}', 'try', CONTROL],
    ['spread in params', "const a = api('A', { ...x })", '...x', SPREAD],
    [
      'spread in arrays',
      "const a = api('A', { url: 'x', headers: { a: [...x] } })",
      '...x',
      SPREAD,
    ],
    ['a computed key', "const a = api('A', { ['url']: 'x' })", "['url']", COMPUTED],
    ['a binary expression', "const a = api('A', { url: 'a' + 'b' })", "'a' + 'b'", EXPRESSIONS],
    ['a logical expression', "const a = api('A', { url: x || 'b' })", "x || 'b'", EXPRESSIONS],
    ['a ternary', "const a = api('A', { url: x ? 'a' : 'b' })", "x ? 'a'", EXPRESSIONS],
    ['a unary other than minus', "const a = api('A', { url: !x })", '!x', EXPRESSIONS],
    ['minus on a non-number', "const a = api('A', { url: -x })", '-x', EXPRESSIONS],
    ['a call to a non-SDK function', "const a = api('A', { url: eval('1') })", "eval('1')", CALLS],
    ['new', "const a = api('A', { url: new Date() })", 'new Date()', CALLS],
    ['this', "const a = api('A', { url: this })", 'this', CALLS],
    ['optional chaining', "const a = api('A', { url: x?.y })", 'x?.y', TYPES],
    ['a non-null assertion', "const a = api('A', { url: x! })", 'x!', TYPES],
    ['as', "const a = api('A', { url: 'x' as string })", "'x' as string", TYPES],
    [
      'satisfies',
      "const a = api('A', { url: 'x' satisfies string })",
      "'x' satisfies string",
      TYPES,
    ],
    ['a type annotation', "const a: Block = api('A', { url: 'x' })", ': Block', TYPES],
    ['an interface', 'interface X {}', 'interface X', TYPES],
    ['a type alias', 'type X = string', 'type X', TYPES],
    ['an untagged template with ${}', "const a = api('A', { url: `x${1}` })", '`x${1}`', UNTAGGED],
    ['an unknown tag', "const a = api('A', { url: sql`x` })", 'sql`x`', TAG],
    ['a regex', "const a = api('A', { url: /x/ })", '/x/', LITERAL_KIND],
    ['a BigInt', "const a = api('A', { url: 10n })", '10n', LITERAL_KIND],
    [
      'non-literal element access',
      "const start = trigger.start('Start', {})\nconst a = api('A', { url: start[k] })",
      'start[k]',
      ELEMENT,
    ],
    ['a getter', "const a = api('A', { get url() { return 'x' } })", 'get url', HELPERS],
    ['a method', "const a = api('A', { url() { return 'x' } })", 'url() {', HELPERS],
    ['a dynamic import', "const a = api('A', { url: import('x') })", "import('x')", CALLS],
    ['a return statement', 'return 1', 'return 1', EXTRA],
  ] as const)('rejects %s', (_label, body, needle, hint) => {
    const text = source(body)
    expectDiagnostic(run(text), 'E_UNSUPPORTED_SYNTAX', locate(text, needle), hint)
  })

  it('rejects another import, a named export and an extra top-level statement', () => {
    const otherImport = `// @sim-sdk 1\nimport fs from 'node:fs'\n${IMPORTS}\nexport default workflow('X', {}, () => {})\n`
    expectDiagnostic(run(otherImport), 'E_UNSUPPORTED_SYNTAX', { line: 2, column: 1 }, IMPORT)
    const named = `// @sim-sdk 1\n${IMPORTS}\nexport const x = 1\nexport default workflow('X', {}, () => {})\n`
    expectDiagnostic(run(named), 'E_UNSUPPORTED_SYNTAX', { line: 3, column: 1 }, NAMED_EXPORT)
    const extra = `// @sim-sdk 1\n${IMPORTS}\nconst x = 1\nexport default workflow('X', {}, () => {})\n`
    expectDiagnostic(run(extra), 'E_UNSUPPORTED_SYNTAX', { line: 3, column: 1 }, EXTRA)
  })

  it('names a rejected construct in words, not by its parser type', () => {
    const messages = (body: string) => run(source(body)).diagnostics.map((d) => d.message)
    expect(messages("const a = api('A', { url: `x${1}` })")).toContain(
      'An untagged template is not supported in a workflow file.'
    )
    expect(messages("if (true) { api('A', { url: 'x' }) }")).toContain(
      'An if statement is not supported in a workflow body.'
    )
    expect(messages("fetch('x')")).toContain('A call is not supported here.')
  })

  it('rejects a string statement at the top level, in the workflow body and in a loop body', () => {
    const topLevel = `// @sim-sdk 1\n'use strict'\n${IMPORTS}\nexport default workflow('X', {}, () => {})\n`
    expectDiagnostic(run(topLevel), 'E_UNSUPPORTED_SYNTAX', { line: 2, column: 1 }, EXTRA)
    const BODY = 'Delete it; a body holds block declarations and wiring.'
    const body = source(`'hello'\n${START}`)
    expectDiagnostic(run(body), 'E_UNSUPPORTED_SYNTAX', locate(body, "'hello'"), BODY)
    const loopBody = source("const l = loop.for('L', { count: 1 }, (p) => {\n  'hello'\n})")
    expectDiagnostic(run(loopBody), 'E_UNSUPPORTED_SYNTAX', locate(loopBody, "'hello'"), BODY)
  })
})

describe('meta.key: legacy keys the display name cannot carry', () => {
  function withKeys(text: string, knownKeys: string[]): CompileResult {
    return compileWorkflow({
      entry: { path: ENTRY, text },
      files: new Map(),
      catalog: TEST_CATALOG,
      sdkMajor: 1,
      knownKeys: new Set(knownKeys),
    })
  }

  const collision = source(
    "const a = api('Agent 1', { url: 'x' })\nconst b = api('agent1', { url: 'y' }, { key: 'agent1~2' })"
  )
  const reserved = source("const a = api('Loop', { url: 'x' }, { key: 'loop' })")

  it('keeps a stored name~n collision key and a stored reserved name', () => {
    const kept = withKeys(collision, ['agent1', 'agent1~2'])
    expect(errorsOf(kept)).toEqual([])
    expect(Object.keys(kept.workflow?.blocks ?? {}).sort()).toEqual(['agent1', 'agent1~2'])
    expect(kept.workflow?.blocks['agent1~2']?.name).toBe('agent1')
    expect(kept.hints.blocks['agent1~2']).toMatchObject({ ident: 'b' })

    const loopBlock = withKeys(reserved, ['loop'])
    expect(errorsOf(loopBlock)).toEqual([])
    expect(loopBlock.workflow?.blocks.loop?.name).toBe('Loop')
  })

  it('never introduces a legacy key the stored workflow does not have', () => {
    expect(errorsOf(withKeys(collision, ['agent1'])).map((d) => d.code)).toEqual([
      'E_KEY_OVERRIDE',
      'E_DUPLICATE_NAME',
    ])
    expect(errorsOf(run(reserved)).map((d) => d.code)).toEqual([
      'E_KEY_OVERRIDE',
      'E_RESERVED_NAME',
    ])
  })

  it('refuses a known key that is not the legacy form of this block name', () => {
    const renamed = source(
      "const a = api('Fetch', { url: 'x' })\nconst b = api('Other', { url: 'y' }, { key: 'fetch~2' })"
    )
    const steal = source("const a = api('Fetch', { url: 'x' }, { key: 'send' })")
    const plain = source("const a = api('Fetch', { url: 'x' }, { key: 'fetch' })")
    const known = ['fetch', 'fetch~2', 'send']
    expect(errorsOf(withKeys(renamed, known)).map((d) => d.code)).toEqual(['E_KEY_OVERRIDE'])
    expect(errorsOf(withKeys(steal, known)).map((d) => d.code)).toEqual(['E_KEY_OVERRIDE'])
    expect(errorsOf(withKeys(plain, known)).map((d) => d.code)).toEqual(['E_KEY_OVERRIDE'])
  })

  it('refuses a collision key whose plain key no block holds, and a key that is not a literal', () => {
    const orphan = source("const b = api('agent1', { url: 'y' }, { key: 'agent1~2' })")
    expectDiagnostic(
      withKeys(orphan, ['agent1~2']),
      'E_KEY_OVERRIDE',
      locate(orphan, "key: 'agent1~2'")
    )
    const computed = source("const a = api('Loop', { url: 'x' }, { key: 'lo' + 'op' })")
    expect(errorsOf(withKeys(computed, ['loop'])).map((d) => d.code)).toContain('E_KEY_OVERRIDE')
  })
})

describe('defaults rule: an omitted param is the editor default', () => {
  it('fills an omitted param with the editor default canvas creation writes', () => {
    const wf = ok(source("const call = api('Call', { url: 'https://x' })"))
    expect(paramValue(wf, 'call', 'method')).toBe('GET')
  })

  it('keeps a param written as null stored-absent', () => {
    const wf = ok(source("const call = api('Call', { url: 'https://x', method: null })"))
    expect(blockOf(wf, 'call').params).not.toHaveProperty('method')
  })

  it('keeps a param written as todo() stored-absent', () => {
    const wf = ok(source("const call = api('Call', { url: 'https://x', method: todo() })"))
    expect(blockOf(wf, 'call').params).not.toHaveProperty('method')
  })

  it('keeps both members of a basic/advanced pair written as null stored-absent', () => {
    const table = TEST_CATALOG.blocks.table
    const catalog = {
      ...TEST_CATALOG,
      blocks: {
        ...TEST_CATALOG.blocks,
        table: {
          ...table,
          subBlocks: table.subBlocks.map((sub) =>
            'id' in sub && sub.id === 'filter' ? { ...sub, valueDefault: { constant: '{}' } } : sub
          ),
        },
      },
    }
    for (const written of ['null', 'todo()']) {
      const result = compileWorkflow({
        entry: { path: ENTRY, text: source(`table.insertRow('T', { filterInput: ${written} })`) },
        files: new Map(),
        catalog,
        sdkMajor: 1,
      })
      expect(errorsOf(result)).toEqual([])
      expect(result.workflow?.blocks.t?.params).not.toHaveProperty('filter')
    }
  })

  it("compiles a doWhile loop's count, which runs when it has no condition", () => {
    const wf = ok(source("const again = loop.doWhile('Again', { count: 3 }, (p) => {})"))
    expect(blockOf(wf, 'again').subflow).toEqual({
      kind: 'loop',
      loopType: 'doWhile',
      iterations: 3,
    })
  })
})

describe('a condition branch refused where it is declared', () => {
  const codesOf = (body: string) => run(source(body)).diagnostics.map((d) => d.code)

  it('is reported once, not again where it is wired or annotated', () => {
    const codes = codesOf(
      [
        "const pick = condition('Pick', { yes: js`1 > 0`, no: true }, { branches: { no: { title: 'No' } } })",
        "const a = api('A', { url: 'x' })",
        'pick.no.to(a)',
      ].join('\n')
    )
    expect(codes).toContain('E_UNSUPPORTED_SYNTAX')
    expect(codes).not.toContain('E_UNKNOWN_BRANCH')
  })

  it('refuses branch extra that would overwrite the id, title, condition or key', () => {
    for (const field of ['id', 'title', 'value', 'key']) {
      const codes = codesOf(
        `const pick = condition('Pick', { yes: js\`1 > 0\` }, { branches: { yes: { extra: { ${field}: 'x', color: 'red' } } } })`
      )
      expect(codes, field).toContain('E_UNSUPPORTED_SYNTAX')
    }
    expect(
      codesOf(
        "const pick = condition('Pick', { yes: js`1 > 0` }, { branches: { yes: { extra: { color: 'red' } } } })"
      )
    ).not.toContain('E_UNSUPPORTED_SYNTAX')
  })

  it('still reports a branch that was never declared', () => {
    const codes = codesOf(
      [
        "const pick = condition('Pick', { yes: js`1 > 0`, no: true })",
        "const a = api('A', { url: 'x' })",
        'pick.maybe.to(a)',
      ].join('\n')
    )
    expect(codes).toContain('E_UNKNOWN_BRANCH')
  })
})

describe('env names the workspace does not hold', () => {
  const text = source("const a = api('A', { url: env.API_URL, body: env.MISSING_KEY })")
  const compileWith = (envNames?: ReadonlySet<string>) =>
    compileWorkflow({
      entry: { path: ENTRY, text },
      files: new Map(),
      catalog: TEST_CATALOG,
      sdkMajor: 1,
      ...(envNames ? { envNames } : {}),
    })

  it('warns on each env.NAME the listed names lack, at its source', () => {
    const result = compileWith(new Set(['API_URL']))
    const unknown = result.diagnostics.filter((d) => d.code === 'W_ENV_UNKNOWN')
    expect(unknown).toHaveLength(1)
    expect(unknown[0]).toMatchObject({ severity: 'warning', blockKey: 'a' })
    expect(unknown[0].message).toContain('MISSING_KEY')
    expect(unknown[0].span).toMatchObject(locate(text, 'env.MISSING_KEY'))
    expect(result.workflow).not.toBeNull()
  })

  it('says nothing when no env list is available', () => {
    expect(compileWith().diagnostics.map((d) => d.code)).not.toContain('W_ENV_UNKNOWN')
  })

  it('warns on a $env name in a code file at the file location', () => {
    const result = compileWorkflow({
      entry: { path: ENTRY, text: source("const f = fn('F', { code: codeFile('./fns/f.js') })") },
      files: new Map([['workflows/fns/f.js', 'return $env.API_URL + $env.MISSING_KEY']]),
      catalog: TEST_CATALOG,
      sdkMajor: 1,
      envNames: new Set(['API_URL']),
    })
    const unknown = result.diagnostics.filter((d) => d.code === 'W_ENV_UNKNOWN')
    expect(unknown).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('MISSING_KEY'),
        span: expect.objectContaining({ file: 'workflows/fns/f.js', line: 1, column: 23 }),
      }),
    ])
  })
})

describe('numbers JSON cannot carry as written', () => {
  it.each([
    ['a value', "const a = api('A', { url: 'x', timeout: 1e999 })", '1e999'],
    ['a negated value', "const a = api('A', { url: 'x', timeout: -1e999 })", '1e999'],
    ['a nested value', "const a = api('A', { url: 'x', headers: { n: 1e999 } })", '1e999'],
    ['a template part', "const a = api('A', { url: t`${1e999}` })", '1e999'],
  ])('refuses an infinite number in %s', (_label, body, needle) => {
    const text = source(body)
    expectDiagnostic(run(text), 'E_NUMBER_NOT_FINITE', locate(text, needle))
  })

  it('warns that an integer past double precision loses digits, and stores it', () => {
    const text = source("const a = api('A', { url: 'x', headers: { n: 12345678901234567890 } })")
    const result = run(text)
    expectDiagnostic(
      result,
      'W_NUMBER_PRECISION',
      locate(text, '12345678901234567890'),
      "Write it as a string: '12345678901234567890'."
    )
    expect(result.workflow).not.toBeNull()
  })

  it.each([
    '0.1',
    '1.50e3',
    '1_000_000',
    '0xFF',
    '9007199254740991',
    '1e21',
    '5e-324',
    '0.000',
    '1.7976931348623157e308',
  ])('keeps %s without a warning', (literal) => {
    const result = run(source(`const a = api('A', { url: 'x', headers: { n: ${literal} } })`))
    expect(result.diagnostics.map((d) => d.code)).toEqual([])
  })

  it.each(['9007199254740993', '0x20000000000000001', '0.12345678901234567890'])(
    'warns about %s',
    (literal) => {
      const result = run(source(`const a = api('A', { url: 'x', headers: { n: ${literal} } })`))
      expect(result.diagnostics.map((d) => d.code)).toEqual(['W_NUMBER_PRECISION'])
    }
  )
})

describe('table filters the runtime refuses', () => {
  const shapeFindings = (filterInput: string) =>
    run(source(`const q = table.insertRow('Q', { filterInput: ${filterInput} })`))
      .diagnostics.filter((d) => d.code === 'W_TABLE_FILTER_SHAPE')
      .map((d) => d.message)

  it('warns on the legacy operator-object grammar and on predicate leaves written as builder rows', () => {
    expect(shapeFindings("{ status: { $eq: 'open' } }")).toEqual([
      expect.stringContaining('legacy operator-object grammar'),
    ])
    expect(shapeFindings("[{ field: 'status', op: 'eq', value: 'open' }]")).toEqual([
      expect.stringContaining('builder row'),
    ])
  })

  it('accepts builder rows, a condition and nested groups', () => {
    expect(shapeFindings("[{ column: 'status', operator: 'eq', value: 'open' }]")).toEqual([])
    expect(shapeFindings("{ field: 'status', op: 'eq', value: 'open' }")).toEqual([])
    expect(
      shapeFindings(
        "{ any: [{ field: 'a', op: 'isNull' }, { all: [{ field: 'b', op: 'gt', value: 1 }] }] }"
      )
    ).toEqual([])
  })
})

describe('a loop or parallel config', () => {
  it.each([
    [
      'stored()',
      "loop.forEach('L', { collection: stored() }, (p) => api('In', { url: 'x' }))",
      'Write collection as a value or a reference.',
    ],
    [
      'codeFile()',
      "loop.while('L', { condition: codeFile('./functions/c.js') }, (p) => api('In', { url: 'x' }))",
      'Write condition: js`...`.',
    ],
  ])('refuses %s instead of dropping it', (_label, body, hint) => {
    const result = run(source(body))
    expect(result.workflow).toBeNull()
    expect(
      result.diagnostics.filter((d) => d.code === 'E_UNSUPPORTED_SYNTAX').map((d) => d.hint)
    ).toEqual([hint])
  })
})
