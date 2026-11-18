/**
 * Hostile declaration files: the server parses text from any API caller, so every input either
 * reads as a plain JSON value or is refused with a located finding. Nothing throws, nothing runs,
 * and no input reaches an object's prototype.
 */
import { describe, expect, it } from 'vitest'
import { readDeclaration } from './read'

const HEADER =
  "// @sim-sdk 1\nimport { column, defineTable } from '@sim/workflow-sdk/workspace'\n\n"
const OPTIONS = { callee: 'defineTable', calls: new Set(['column.string']) }

function read(body: string) {
  return readDeclaration('tables/leads.ts', `${HEADER}${body}`, OPTIONS)
}

function codes(body: string): string[] {
  return read(body).diagnostics.map((finding) => finding.code)
}

describe('readDeclaration on hostile input', () => {
  it('refuses a bracket depth bomb before parsing, without throwing', () => {
    const bomb = `export default defineTable(${'['.repeat(50_000)}${']'.repeat(50_000)})\n`
    expect(codes(bomb)).toEqual(['E_LIMIT_EXCEEDED'])
  })

  it('refuses an operator chain too long to parse instead of overflowing the stack', () => {
    const chain = `export default defineTable({ name: ${Array(200_000).fill('1').join(' + ')} })\n`
    const result = read(chain)
    expect(result.value).toBeUndefined()
    const found = result.diagnostics.map((finding) => finding.code)
    expect(found.length).toBeGreaterThan(0)
    // Which refusal fires depends on the stack depth Babel reaches before it gives up.
    expect(
      found.every((code) => code === 'E_LIMIT_EXCEEDED' || code === 'E_DECL_UNSUPPORTED')
    ).toBe(true)
  })

  it('refuses a file over the byte cap', () => {
    const big = `export default defineTable({ name: '${'a'.repeat(2_100_000)}' })\n`
    expect(codes(big)).toEqual(['E_LIMIT_EXCEEDED'])
  })

  it('never lets a __proto__ key reach the prototype', () => {
    const result = read(`export default defineTable({ "__proto__": { polluted: true } })\n`)
    expect(result.value).toBeUndefined()
    expect(result.diagnostics.map((finding) => finding.code)).toEqual(['E_DECL_UNSUPPORTED'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it.each([
    ['a call to anything but a helper', `export default defineTable(eval('1'))`],
    ['an identifier', 'export default defineTable(process)'],
    ['a spread', 'export default defineTable({ ...x })'],
    ['a computed key', "export default defineTable({ ['a' + 'b']: 1 })"],
    ['an interpolation', `export default defineTable({ name: \`\${x}\` })`],
    ['a getter', 'export default defineTable({ get name() { return 1 } })'],
    ['a function value', 'export default defineTable({ name: () => 1 })'],
    ['a regular expression', 'export default defineTable({ name: /x/ })'],
    ['a member read', 'export default defineTable({ name: column.string })'],
    ['a helper outside the kind', 'export default defineTable({ c: column.number() })'],
    ['a NUL character', "export default defineTable({ name: 'a\\u0000b' })"],
    ['an unpaired surrogate', "export default defineTable({ name: '\\ud800' })"],
    ['an infinite number', 'export default defineTable({ n: 1e999 })'],
  ])('refuses %s', (_name, body) => {
    const result = read(`${body}\n`)
    expect(result.value).toBeUndefined()
    expect(result.diagnostics.map((finding) => finding.code)).toContain('E_DECL_UNSUPPORTED')
  })

  it('refuses statements beside the imports and the one export', () => {
    expect(codes("console.log('x')\nexport default defineTable({})\n")).toEqual(['E_DECL_EXPORT'])
    expect(codes('export default defineTable({})\nexport const x = 1\n')).toEqual(['E_DECL_EXPORT'])
    expect(codes('export default defineTable({})\nexport default defineTable({})\n')).toEqual([
      'E_DECL_EXPORT',
    ])
  })

  it('refuses imports from anywhere else, and renamed imports', () => {
    const text = `// @sim-sdk 1\nimport { readFileSync } from 'node:fs'\nimport { defineTable as d } from '@sim/workflow-sdk/workspace'\nexport default defineTable({})\n`
    expect(
      readDeclaration('tables/leads.ts', text, OPTIONS).diagnostics.map((f) => f.code)
    ).toEqual(['E_DECL_IMPORT', 'E_DECL_IMPORT', 'E_DECL_IMPORT'])
  })

  it('refuses a missing header and pins a syntax error to its line', () => {
    expect(
      readDeclaration('tables/leads.ts', 'export default defineTable({})\n', OPTIONS).diagnostics[0]
        ?.code
    ).toBe('E_DECL_HEADER')
    const broken = read('export default defineTable({ name: })\n')
    expect(broken.diagnostics[0]).toMatchObject({
      code: 'E_DECL_SYNTAX',
      span: { file: 'tables/leads.ts', line: 4 },
    })
  })

  it('refuses a key declared twice, at the second one', () => {
    const result = read("export default defineTable({\n  name: 'a',\n  name: 'b',\n})\n")
    expect(result.diagnostics).toMatchObject([{ code: 'E_DECL_DUPLICATE_KEY', span: { line: 6 } }])
  })
})
