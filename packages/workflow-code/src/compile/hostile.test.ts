import { afterEach, describe, expect, it } from 'vitest'
import type { CompileLimits, CompileResult } from '../api'
import { compileWorkflow } from './index'
import { TEST_CATALOG } from './test-catalog'

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

  it('enforces the node-count cap', () => {
    const elements = Array.from({ length: 5_000 }, () => '0').join(',')
    const result = run(wrap(`const a = api('A', { url: 'x', headers: { list: [${elements}] } })`), {
      maxNodes: 1_000,
    })
    expect(codes(result)).toEqual(['E_LIMIT_EXCEEDED'])
  })

  it('never reads a code file outside the repository or past the size cap', () => {
    const text = `// @sim-sdk 1\nimport { codeFile, fn, workflow } from '@sim/workflow-sdk'\n\nexport default workflow('X', {}, () => {\n  const a = fn('A', { code: codeFile('../../etc/passwd.js') })\n  const b = fn('B', { code: codeFile('./big.js') })\n})\n`
    const result = run(text, { maxBytes: 1_000 }, { 'workflows/big.js': 'x'.repeat(5_000) })
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

    it('parses a code file referenced by many blocks once', () => {
      const body = `const x = [${Array.from({ length: 60_000 }, (_, i) => i).join(',')}]\n`
      const started = Date.now()
      const result = run(
        fnFile(200, () => './a.js'),
        undefined,
        { 'workflows/a.js': body }
      )
      const elapsed = Date.now() - started
      expect(codes(result)).toEqual([])
      expect(elapsed).toBeLessThan(2_000)
    })

    it('caps the total bytes of distinct code files', () => {
      const files = Object.fromEntries(
        Array.from({ length: 4 }, (_, i) => [`workflows/f${i}.js`, `return ${'1'.repeat(700)}\n`])
      )
      const result = run(
        fnFile(4, (i) => `./f${i}.js`),
        { maxBytes: 1_000, maxCodeFileBytesTotal: 2_000 },
        files
      )
      expect(codes(result)).toContain('E_LIMIT_EXCEEDED')
      expect(result.workflow).toBeNull()
    })

    it('caps the number of codeFile() references with one diagnostic', () => {
      const result = run(
        fnFile(10, () => './a.js'),
        { maxCodeFileRefs: 3 },
        { 'workflows/a.js': 'return 1\n' }
      )
      expect(errorCodes(result)).toEqual(['E_LIMIT_EXCEEDED'])
    })

    it('rejects a depth bomb in a code file before parsing it', () => {
      const result = run(
        fnFile(1, () => './a.js'),
        undefined,
        {
          'workflows/a.js': `return ${'['.repeat(100_000)}${']'.repeat(100_000)}\n`,
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
