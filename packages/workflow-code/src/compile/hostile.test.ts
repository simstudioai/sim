import { expectLinearGrowth } from '@sim/testing/helpers/scaling'
import { afterEach, describe, expect, it } from 'vitest'
import { codeFileReferences } from '../code-files/references'
import { FINDING_LIMITS } from '../diagnostics/bound'
import { MAX_ERRORS } from '../diagnostics/codes'
import { SOURCE_LIMITS, sourceLimitExcesses } from '../limits'
import { parseWorkflowLock } from '../lock'
import { TEST_CATALOG } from './catalog.test-helpers'
import type { CompileResult } from './index'
import { compileWorkflow } from './index'
import { type CompileLimits, sourceDepthOverflow } from './parse'
import { Reporter } from './report'

/**
 * Hostile sources: compile never executes anything and never throws. Each input must come
 * back as diagnostics only, with no side effect on the process. A sentinel global is set by every
 * payload that would run if the compiler evaluated code.
 */

const HEADER = "// @sim-sdk 1\nimport { api, raw, workflow } from '@sim/workflow-sdk'\n\n"
const SENTINEL = '__simWorkflowCodePwned'

function wrap(body: string, options = '{}'): string {
  return `${HEADER}export default workflow('Hostile', ${options}, () => {\n${body}\n})\n`
}

function run(
  text: string,
  limits?: CompileLimits,
  files: Record<string, string> = {}
): CompileResult {
  return compileWorkflow({
    entry: { path: 'workflows/hostile.ts', text },
    files: new Map(Object.entries(files)),
    catalog: TEST_CATALOG,
    sdkMajor: 1,
    ...(limits && { limits }),
  })
}

function codes(result: CompileResult): string[] {
  return result.diagnostics.map((d) => d.code)
}

function errorCodes(result: CompileResult): string[] {
  return result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code)
}

function sentinel(): unknown {
  return Reflect.get(globalThis, SENTINEL)
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, SENTINEL)
  Reflect.deleteProperty(Object.prototype, 'polluted')
})

describe('hostile sources produce diagnostics only', () => {
  it.each([
    ['eval', `const a = api('A', { url: eval("globalThis.${SENTINEL} = 1") })`],
    ['Function', `const a = api('A', { url: Function("globalThis.${SENTINEL} = 1")() })`],
    [
      'dynamic import',
      `const a = api('A', { url: import('data:text/javascript,globalThis.${SENTINEL}=1') })`,
    ],
    ['a getter', `const a = api('A', { get url() { globalThis.${SENTINEL} = 1; return 'x' } })`],
    ['an IIFE', `const a = api('A', { url: (() => { globalThis.${SENTINEL} = 1 })() })`],
    [
      'a tagged template from scope',
      `const a = api('A', { url: String.raw\`\${globalThis.${SENTINEL} = 1}\` })`,
    ],
    ['an assignment', `const a = api('A', { url: (globalThis.${SENTINEL} = 1) })`],
    ['a top-level statement', `globalThis.${SENTINEL} = 1`],
    [
      'a constructor read',
      `const a = api('A', { url: ({}).constructor.constructor("globalThis.${SENTINEL} = 1")() })`,
    ],
  ])('%s', (_label, body) => {
    const result = run(wrap(body))
    expect(result.workflow).toBeNull()
    expect(codes(result)).toContain('E_UNSUPPORTED_SYNTAX')
    expect(sentinel()).toBeUndefined()
  })

  it('keeps __proto__, constructor and prototype keys as data and never pollutes prototypes', () => {
    const result = run(
      wrap(
        [
          "const a = api('A', { url: 'x', headers: { __proto__: { polluted: true }, constructor: 1, prototype: 2 } })",
          "const b = api('B', { url: raw({ __proto__: { polluted: true } }) })",
          "const c = api('__proto__', { url: 'x' })",
          'a.to(c)',
        ].join('\n'),
        "{ variables: { __proto__: { type: 'object', value: { __proto__: { polluted: true } } } } }"
      )
    )
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const workflow = result.workflow
    if (!workflow) throw new Error('expected a workflow')
    expect(Reflect.get(Object.prototype, 'polluted')).toBeUndefined()
    const headers = workflow.blocks.a?.params.headers
    expect(headers?.kind === 'value' && Object.getPrototypeOf(headers.value)).toBe(Object.prototype)
    expect(headers?.kind === 'value' && Object.keys(headers.value ?? {})).toEqual([
      '__proto__',
      'constructor',
      'prototype',
    ])
    const url = workflow.blocks.b?.params.url
    expect(url?.kind === 'value' && Object.keys(url.value ?? {})).toEqual(['__proto__'])
    expect(Object.keys(workflow.blocks)).toContain('__proto__')
    expect(Object.getPrototypeOf(workflow.blocks)).toBe(Object.prototype)
    expect(Object.keys(workflow.variables)).toEqual(['__proto__'])
    expect(Object.keys(result.hints.blocks)).toContain('__proto__')
    expect(workflow.edges).toEqual([{ from: 'a', port: { kind: 'out' }, to: '__proto__' }])
  })

  it('rejects a 10 MB input before parsing it', () => {
    const text = wrap(`const a = api('A', { url: '${'x'.repeat(10 * 1024 * 1024)}' })`)
    const result = run(text)
    expect(codes(result)).toEqual(['E_LIMIT_EXCEEDED'])
  })

  it('refuses an oversize input before scanning its characters', () => {
    const text = wrap(`const a = api('A', { url: '\u0000${'x'.repeat(2_000)}' })`)
    expect(codes(run(text, { maxTotalBytes: 1_000 }))).toEqual(['E_LIMIT_EXCEEDED'])
  })

  it.each([
    ['nested arrays', `const a = api('A', { url: ${'['.repeat(100_000)}${']'.repeat(100_000)} })`],
    [
      'nested objects',
      `const a = api('A', { url: ${'{a:'.repeat(50_000)}1${'}'.repeat(50_000)} })`,
    ],
    [
      'nested parentheses',
      `const a = api('A', { url: ${'('.repeat(100_000)}1${')'.repeat(100_000)} })`,
    ],
    [
      'nested template expressions',
      `const a = api('A', { url: ${'`${'.repeat(20_000)}1${'}`'.repeat(20_000)} })`,
    ],
  ])('rejects a depth bomb of %s', (_label, body) => {
    const result = run(wrap(body))
    expect(codes(result)).toContain('E_LIMIT_EXCEEDED')
    expect(result.workflow).toBeNull()
  })

  it('survives a long operator chain without throwing', () => {
    const chain = Array.from({ length: 150_000 }, () => "'a'").join('+')
    const result = run(wrap(`const a = api('A', { url: ${chain} })`))
    expect(result.workflow).toBeNull()
    expect(
      codes(result).some((code) => code === 'E_LIMIT_EXCEEDED' || code === 'E_UNSUPPORTED_SYNTAX')
    ).toBe(true)
  })

  it('scans a 400 KB value of overlapping token prefixes for secrets in linear time', () => {
    const source = (repeats: number) =>
      wrap(`const a = api('A', { url: 'https://x', body: '${'-eyJ'.repeat(repeats)}' })`)
    const scan = (repeats: number) => {
      const text = source(repeats)
      return () => run(text)
    }
    expectLinearGrowth(scan, 12_500)
    const result = run(source(100_000))
    expect(result.workflow).not.toBeNull()
    expect(codes(result)).not.toContain('W_LITERAL_SECRET')
    const segment = 'A'.repeat(12)
    const jwt = [`eyJ${segment}`, `eyJ${segment}`, segment].join('.')
    const detected = run(wrap(`const a = api('A', { url: 'https://x', body: 'token ${jwt}' })`))
    expect(codes(detected)).toContain('W_LITERAL_SECRET')
  })

  it('never frames a literal secret, alone or as the warning past the cap', () => {
    const segment = 'A'.repeat(12)
    const jwt = [`eyJ${segment}`, `eyJ${segment}`, segment].join('.')
    const detected = run(wrap(`const a = api('A', { url: 'https://x', body: 'token ${jwt}' })`))
    const finding = detected.diagnostics.find((d) => d.code === 'W_LITERAL_SECRET')
    expect(finding?.span.line).toBe(5)
    expect(finding?.frame).toBeUndefined()

    const reporter = new Reporter()
    reporter.addFile('w.ts', `body: '${jwt}'`)
    const at = { file: 'w.ts', start: 7, end: 7 + jwt.length }
    // Enough codes, each filled to its own cap in turn, that the warnings reach the total cap
    // whatever the two caps are.
    const fillers = [
      'W_SUBFLOW_COUNT',
      'W_FORWARD_REF',
      'W_VALUE_KIND',
      'W_OUT_OF_RANGE',
      'W_UNKNOWN_OPTION',
      'W_REQUIRED_MISSING',
      'W_ENV_UNKNOWN',
      'W_REF_NOT_NORMALIZED',
      'W_JSON_REF_UNTYPED',
      'W_COMMENT_MOVED',
      'W_COMMENT_DROPPED',
      'W_FIELD_NOT_APPLICABLE',
    ] as const
    expect(fillers.length * FINDING_LIMITS.warningsPerCode).toBeGreaterThanOrEqual(
      FINDING_LIMITS.perSeverity
    )
    for (let i = 0; i < FINDING_LIMITS.perSeverity; i++) {
      reporter.report(fillers[Math.floor(i / FINDING_LIMITS.warningsPerCode)], `x${i}`, at)
    }
    reporter.report('W_LITERAL_SECRET', 'body holds a literal secret', at)
    const capped = reporter.diagnostics.at(-1)
    expect(capped?.code).toBe('I_FINDINGS_TRUNCATED')
    expect(capped?.frame).toBeUndefined()
  })

  it('records one I_FINDINGS_TRUNCATED however many warnings come past the total cap', () => {
    const reporter = new Reporter()
    reporter.addFile('w.ts', 'x')
    const at = { file: 'w.ts', start: 0, end: 1 }
    // Spread over enough codes that none reaches its own cap before the total cap.
    const spread = [
      'W_SUBFLOW_COUNT',
      'W_FORWARD_REF',
      'W_VALUE_KIND',
      'W_OUT_OF_RANGE',
      'W_UNKNOWN_OPTION',
      'W_REQUIRED_MISSING',
      'W_ENV_UNKNOWN',
      'W_REF_NOT_NORMALIZED',
    ] as const
    expect(FINDING_LIMITS.perSeverity / spread.length).toBeLessThan(FINDING_LIMITS.warningsPerCode)
    for (let i = 0; i < FINDING_LIMITS.perSeverity + 50; i++) {
      reporter.report(spread[i % spread.length], `x${i}`, at)
    }

    const markers = reporter.diagnostics.filter((d) => d.code === 'I_FINDINGS_TRUNCATED')
    expect(markers).toHaveLength(1)
  })

  it('checks the precision of a 100 KB numeric literal in linear time', () => {
    const source = (zeros: number) =>
      wrap(`const a = api('A', { url: 'x', timeout: 0.1${'0'.repeat(zeros)}1 })`)
    const check = (zeros: number) => {
      const text = source(zeros)
      return () => run(text)
    }
    expectLinearGrowth(check, 12_500)
    expect(codes(run(source(100_000)))).toContain('W_NUMBER_PRECISION')
  })

  it('stops after 100 errors, framing a 40 KB line in bounded output', () => {
    const result = run(wrap('x;'.repeat(20_000)))
    expect(result.workflow).toBeNull()
    expect(result.diagnostics).toHaveLength(MAX_ERRORS + 1)
    expect(result.diagnostics.at(-1)?.code).toBe('E_TOO_MANY_ERRORS')
    const frameChars = result.diagnostics.reduce((sum, d) => sum + (d.frame ?? '').length, 0)
    expect(frameChars).toBeLessThan(result.diagnostics.length * 1_000)
  })

  it('lists 20 warnings of one code and omits the rest without failing the compile', () => {
    let body = ''
    for (let i = 0; i < 150; i++) body += `const a${i} = api('A${i}', { url: a${i + 1}.data })\n`
    body += `const a150 = api('A150', { url: 'x' })`
    const result = run(wrap(body))
    expect(result.workflow).not.toBeNull()
    expect(result.diagnostics).toHaveLength(FINDING_LIMITS.warningsPerCode + 1)
    expect(result.diagnostics.at(-1)?.code).toBe('I_FINDINGS_TRUNCATED')
  })

  it('never computes the did-you-mean of a warning past the cap', () => {
    const reporter = new Reporter()
    reporter.addFile('w.ts', 'x')
    let computed = 0
    for (let i = 0; i < 1_000; i++) {
      reporter.report(
        'W_UNRESOLVED_REF',
        `x${i}`,
        { file: 'w.ts', start: 0, end: 1 },
        {
          hint: () => {
            computed++
            return 'Did you mean y?'
          },
        }
      )
    }
    expect(computed).toBe(FINDING_LIMITS.warningsPerCode)
    expect(reporter.diagnostics[0]?.hint).toBe('Did you mean y?')
  })

  it('never computes the did-you-mean of a refusable warning it withholds until it is read', () => {
    const reporter = new Reporter()
    reporter.addFile('w.ts', 'x')
    let computed = 0
    for (let i = 0; i < 1_000; i++) {
      reporter.report(
        'W_UNRESOLVED_REF',
        `x${i}`,
        { file: 'w.ts', start: 0, end: 1 },
        {
          blockKey: `b${i}`,
          hint: () => {
            computed++
            return 'Did you mean y?'
          },
        }
      )
    }
    expect(reporter.withheld).toHaveLength(1_000 - FINDING_LIMITS.warningsPerCode)
    expect(computed).toBe(FINDING_LIMITS.warningsPerCode)
    expect({ ...reporter.withheld[0] }.hint).toBe('Did you mean y?')
    expect(computed).toBe(FINDING_LIMITS.warningsPerCode + 1)
  })

  it('keeps one omitted entry per code and block, counting every warning past the caps', () => {
    const reporter = new Reporter()
    reporter.addFile('w.ts', 'x')
    const at = { file: 'w.ts', start: 0, end: 1 }
    const total = FINDING_LIMITS.perSeverity + 5_000
    for (let i = 0; i < total; i++) {
      reporter.report('W_LITERAL_SECRET', `x${i}`, at, { blockKey: i % 2 === 0 ? 'a' : 'b' })
    }

    expect(reporter.omitted).toHaveLength(2)
    const listed = reporter.diagnostics.filter((d) => d.code === 'W_LITERAL_SECRET').length
    expect(reporter.omitted.reduce((sum, entry) => sum + entry.count, 0)).toBe(total - listed)
  })

  it('keeps infos from crowding out a warning', () => {
    const reporter = new Reporter()
    reporter.addFile('w.ts', 'x')
    const at = { file: 'w.ts', start: 0, end: 1 }
    for (let i = 0; i < FINDING_LIMITS.perSeverity + 50; i++)
      reporter.report('I_SCHEDULE_UTC', `x${i}`, at)
    reporter.report('W_LITERAL_SECRET', 'apiKey holds a literal secret', at)
    const listed = reporter.diagnostics.map((d) => d.code)
    expect(listed).toContain('W_LITERAL_SECRET')
    expect(listed).not.toContain('I_FINDINGS_TRUNCATED')
    expect(listed.filter((code) => code === 'I_SCHEDULE_UTC')).toHaveLength(
      FINDING_LIMITS.perSeverity
    )
  })

  it('caps a diagnostic message that quotes a huge name', () => {
    const name = 'n'.repeat(100_000)
    const result = run(
      wrap(`const a = api('${name}', { url: 'x' })\nconst b = api('${name}', { url: 'x' })`)
    )
    expect(codes(result)).toContain('E_DUPLICATE_NAME')
    for (const d of result.diagnostics) expect(d.message.length).toBeLessThanOrEqual(1_001)
  })

  it('refuses fan-out past the edge cap and stops adding edges', () => {
    const ids = Array.from({ length: 300 }, (_, i) => `a${i}`)
    const blocks = ids.map((id) => `const ${id} = api('${id}', { url: 'x' })`).join('\n')
    const wiring = `a0.to(${ids.slice(1, 150).join(', ')}).to(${ids.slice(150).join(', ')})`
    const result = run(wrap(`${blocks}\n${wiring}`))
    expect(result.workflow).toBeNull()
    expect(codes(result)).toEqual(['E_LIMIT_EXCEEDED'])
  })

  it('accepts wiring at the edge cap and refuses one edge more', () => {
    const blocks =
      "const a = api('A', { url: 'x' })\nconst b = api('B', { url: 'x' })\nconst c = api('C', { url: 'x' })"
    expect(run(wrap(`${blocks}\na.to(b, c)`), { maxEdges: 2 }).workflow?.edges).toHaveLength(2)
    const over = run(wrap(`${blocks}\na.to(b, c)\nb.to(c)`), { maxEdges: 2 })
    expect(over.workflow).toBeNull()
    expect(codes(over)).toEqual(['E_LIMIT_EXCEEDED'])
  })

  it('never reads a code file outside the repository or past the size cap', () => {
    const text = `// @sim-sdk 1\nimport { codeFile, fn, workflow } from '@sim/workflow-sdk'\n\nexport default workflow('X', {}, () => {\n  const a = fn('A', { code: codeFile('../../etc/passwd.js') })\n  const b = fn('B', { code: codeFile('./functions/big.js') })\n})\n`
    const result = run(
      text,
      { maxTotalBytes: 1_000 },
      { 'workflows/functions/big.js': 'x'.repeat(5_000) }
    )
    expect(codes(result)).toEqual(expect.arrayContaining(['E_CODE_FILE_PATH', 'E_LIMIT_EXCEEDED']))
  })

  describe('code file budget', () => {
    const FILE_HEADER =
      "// @sim-sdk 1\nimport { codeFile, fn, workflow } from '@sim/workflow-sdk'\n\n"
    const fnFile = (count: number, path: (i: number) => string) =>
      `${FILE_HEADER}export default workflow('X', {}, () => {\n${Array.from(
        { length: count },
        (_, i) => `  const f${i} = fn('F${i}', { code: codeFile('${path(i)}') })`
      ).join('\n')}\n})\n`

    it('reports an unstorable code file shared by many blocks once', () => {
      const result = run(
        fnFile(5, () => './functions/a.js'),
        undefined,
        {
          'workflows/functions/a.js': 'return "x\u0000"\n',
        }
      )
      expect(errorCodes(result)).toEqual(['E_INVALID_CHARACTER'])
    })

    it('caps the total bytes of distinct code files with one diagnostic, on the file that crosses it', () => {
      const files = Object.fromEntries(
        Array.from({ length: 4 }, (_, i) => [
          `workflows/functions/f${i}.js`,
          `return ${'1'.repeat(700)}\n`,
        ])
      )
      const result = run(
        fnFile(4, (i) => `./functions/f${i}.js`),
        { maxTotalBytes: 2_000 },
        files
      )
      const limits = result.diagnostics.filter((d) => d.code === 'E_LIMIT_EXCEEDED')
      expect(limits.map((d) => d.blockKey)).toEqual(['f2'])
      expect(result.workflow).toBeNull()
    })

    it('accepts exactly the block cap', () => {
      const result = run(
        fnFile(3, () => './functions/a.js'),
        { maxBlocks: 3 },
        { 'workflows/functions/a.js': 'return 1\n' }
      )
      expect(errorCodes(result)).toEqual([])
      expect(Object.keys(result.workflow?.blocks ?? {})).toHaveLength(3)
    })

    it('caps the number of blocks with one diagnostic', () => {
      const result = run(
        fnFile(4, () => './functions/a.js'),
        { maxBlocks: 3 },
        { 'workflows/functions/a.js': 'return 1\n' }
      )
      expect(errorCodes(result)).toEqual(['E_LIMIT_EXCEEDED'])
      expect(result.workflow).toBeNull()
    })

    it('counts the entry file toward the total bytes', () => {
      const entry = fnFile(1, () => './functions/a.js')
      const result = run(
        entry,
        { maxTotalBytes: entry.length + 4 },
        { 'workflows/functions/a.js': 'return 1\n' }
      )
      expect(errorCodes(result)).toEqual(['E_LIMIT_EXCEEDED'])
    })

    it('caps the number of codeFile() references with one diagnostic', () => {
      const result = run(
        fnFile(10, () => './functions/a.js'),
        { maxCodeFileRefs: 3 },
        { 'workflows/functions/a.js': 'return 1\n' }
      )
      expect(errorCodes(result)).toEqual(['E_LIMIT_EXCEEDED'])
    })

    it('rejects a depth bomb in a code file before parsing it', () => {
      const result = run(
        fnFile(1, () => './functions/a.js'),
        undefined,
        {
          'workflows/functions/a.js': `return ${'['.repeat(100_000)}${']'.repeat(100_000)}\n`,
        }
      )
      expect(errorCodes(result)).toEqual(['E_LIMIT_EXCEEDED'])
    })
  })

  it('returns diagnostics for binary garbage', () => {
    const garbage = Array.from({ length: 4_096 }, (_, i) =>
      String.fromCharCode((i * 7919) % 65_536)
    ).join('')
    expect(() => run(garbage)).not.toThrow()
    expect(run(garbage).workflow).toBeNull()
  })
})

describe('one set of limits for get and compile', () => {
  const nested = (levels: number) => `${'{ a: '.repeat(levels)}1${' }'.repeat(levels)}`
  const entryWith = (value: string) =>
    wrap(`  const a = api('A', { url: 'x', body: raw(${value}) })`)

  it('lets one inline entry file use the whole byte budget', () => {
    const text = wrap(`  const a = api('A', { url: 'x', body: '${'x'.repeat(2_500_000)}' })`)
    expect(errorCodes(run(text))).not.toContain('E_LIMIT_EXCEEDED')
  })

  it.each([
    [
      'an entry nested in syntax but not in brackets',
      { 'workflows/hostile.ts': entryWith(nested(120)) },
    ],
    [
      'a JavaScript code file nested in brackets',
      {
        'workflows/hostile.ts': `${HEADER.replace('api, ', 'codeFile, fn, ')}export default workflow('Hostile', {}, () => {\n  const f = fn('F', { code: codeFile('./functions/deep.js') })\n})\n`,
        'workflows/functions/deep.js': `return ${'['.repeat(250)}${']'.repeat(250)}\n`,
      },
    ],
  ])('flags %s that compile refuses, so a get never prints it', (_, files) => {
    const { 'workflows/hostile.ts': entry, ...codeFiles } = files as Record<string, string>
    expect(errorCodes(run(entry, undefined, codeFiles))).toContain('E_LIMIT_EXCEEDED')
    expect(sourceDepthOverflow(files, Number.POSITIVE_INFINITY)).not.toBeNull()
  })

  it('refuses more variables than a get prints or a lock holds', () => {
    const declare = (count: number) => {
      const entries = Array.from(
        { length: count },
        (_, i) => `v${i}: { type: 'string', value: '' }`
      )
      return wrap("  const a = api('A', { url: 'x' })", `{ variables: { ${entries.join(', ')} } }`)
    }
    const max = SOURCE_LIMITS.maxVariables
    expect(errorCodes(run(declare(max)))).toEqual([])
    expect(errorCodes(run(declare(max + 1)))).toEqual(['E_LIMIT_EXCEEDED'])
    expect(sourceLimitExcesses({}, { blocks: 1, edges: 0, variables: max + 1 })).toEqual([
      { limit: 'maxVariables', actual: max + 1, max },
    ])
    const variables = Object.fromEntries(Array.from({ length: max }, (_, i) => [`v${i}`, `id${i}`]))
    expect(parseWorkflowLock({ version: 1, blocks: {}, variables }).diagnostics).toBeUndefined()
  })

  it('skips regex literal bodies, so many regexes with brackets and quotes pass', () => {
    const lines = Array.from({ length: 250 }, (_, i) =>
      [
        `const p${i} = s.split(/\\(/)`,
        `if (/'/.test(s${i})) { go() }`,
        `const u${i} = /^https?:\\/\\/x[({]/.test(s) && (a)`,
      ].join('\n')
    )
    const files = {
      'workflows/hostile.ts': `${HEADER.replace('api, ', 'codeFile, fn, ')}export default workflow('Hostile', {}, () => {\n  const f = fn('F', { code: codeFile('./functions/regex.js') })\n})\n`,
      'workflows/functions/regex.js': `${lines.join('\n')}\nreturn 1\n`,
    }
    const { 'workflows/hostile.ts': entry, ...codeFiles } = files
    expect(errorCodes(run(entry, undefined, codeFiles))).toEqual([])
    expect(sourceDepthOverflow(files, Number.POSITIVE_INFINITY)).toBeNull()
  })

  // Two linear walks of 300k nodes: ~0.5s locally, 1.8-2.4s on CI, 5.1s on one loaded runner.
  it('walks a node with more children than one call can take as arguments', () => {
    const wide = `[${'0,'.repeat(300_000)}0]`
    const entry = `${HEADER.replace('api, ', 'codeFile, fn, ')}export default workflow('Hostile', {}, () => {\n  const f = fn('F', { code: codeFile('./functions/f.js') })\n  const a = api('A', { url: 'x', body: raw(${wide}) })\n})\n`
    expect(() => run(entry, undefined, { 'workflows/functions/f.js': 'return 1\n' })).not.toThrow()
    expect(codeFileReferences(entry)).toEqual(['./functions/f.js'])
  }, 15_000)

  it('passes a source nested within the cap', () => {
    const files = { 'workflows/hostile.ts': entryWith(nested(20)) }
    expect(errorCodes(run(files['workflows/hostile.ts']))).not.toContain('E_LIMIT_EXCEEDED')
    expect(sourceDepthOverflow(files, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('characters a workflow cannot store', () => {
  it.each([
    ['a raw NUL in a comment', "// note \u0000\nconst a = api('A', { url: 'x' })"],
    ['a NUL escape in a string', "const a = api('A', { url: 'x\\u0000y' })"],
    ['a lone high surrogate escape', "const a = api('A', { url: '\\uD800' })"],
    ['a lone low surrogate escape in a template', "const a = api('A', { url: `\\uDC00` })"],
    ['a NUL escape in a block name', "const a = api('A\\u0000', { url: 'x' })"],
  ])('refuses %s with one located diagnostic', (_label, body) => {
    const text = wrap(body)
    const result = run(text)
    expect(result.workflow).toBeNull()
    const refused = result.diagnostics.filter((d) => d.code === 'E_INVALID_CHARACTER')
    expect(refused).toHaveLength(1)
  })

  it('refuses a NUL in a code file at its line, for the block reading it', () => {
    const text = `${HEADER.replace('api, ', 'codeFile, fn, ')}export default workflow('Hostile', {}, () => {\n  const f = fn('F', { code: codeFile('./functions/f.js') })\n})\n`
    const code = 'const a = 1\nreturn "x\u0000"\n'
    const result = run(text, undefined, { 'workflows/functions/f.js': code })
    const refused = result.diagnostics.find((d) => d.code === 'E_INVALID_CHARACTER')
    expect(refused?.span).toMatchObject({ file: 'workflows/functions/f.js', line: 2, column: 10 })
    expect(refused?.blockKey).toBe('f')
  })

  it('keeps a well-formed astral character, raw or escaped', () => {
    const result = run(wrap("const a = api('A', { url: '😀 \\uD83D\\uDE00 \\u{1F600}' })"))
    expect(errorCodes(result)).toEqual([])
  })
})
