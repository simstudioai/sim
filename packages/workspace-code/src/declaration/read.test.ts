/**
 * The reader keeps a span for every value of a declaration of up to the byte cap, so locating a
 * value must not rescan the file: each scan of the whole text is counted here (`splitLines`, and a
 * `codeFrame` handed the raw text, which splits it again), and a large file may scan it once.
 */
import * as workflowCode from '@sim/workflow-code'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_FINDINGS_PER_FILE } from '../diagnostics'
import { testTableCodec } from '../kinds/table.test-helpers'
import { readDeclaration } from './read'

vi.mock('@sim/workflow-code', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sim/workflow-code')>()
  return {
    ...actual,
    splitLines: vi.fn(actual.splitLines),
    codeFrame: vi.fn(actual.codeFrame),
  }
})

const HEADER = "// @sim-sdk 1\nimport { defineTable } from '@sim/workflow-sdk/workspace'\n"

/** Full scans of a file's text: line splits, plus frames built from the raw text. */
function fullTextScans(): number {
  const frames = vi.mocked(workflowCode.codeFrame).mock.calls
  return (
    vi.mocked(workflowCode.splitLines).mock.calls.length +
    frames.filter(([text]) => typeof text === 'string').length
  )
}

beforeEach(() => {
  vi.mocked(workflowCode.splitLines).mockClear()
  vi.mocked(workflowCode.codeFrame).mockClear()
})

describe('readDeclaration on large files', () => {
  it('spans every value of a 1 MB declaration with one scan of the text', () => {
    const count = 350_000
    const text = `${HEADER}export default defineTable({ x: [${Array(count).fill('1').join(',\n')}] })\n`
    expect(text.length).toBeGreaterThan(1_000_000)

    const read = readDeclaration('tables/big.ts', text, { callee: 'defineTable' })

    expect(read.diagnostics).toEqual([])
    expect(read.spans.size).toBe(count + 2)
    expect(read.spans.get(`/x/${count - 1}`)).toMatchObject({ line: count + 2, column: 1 })
    expect(fullTextScans()).toBeLessThanOrEqual(1)
  })

  it('stops a file of thousands of bad values after the finding cap', () => {
    const count = 20_000
    const text = `${HEADER}export default defineTable({ x: [${Array(count).fill('a').join(',\n')}] })\n`

    const read = readDeclaration('tables/big.ts', text, { callee: 'defineTable' })

    expect(read.diagnostics).toHaveLength(MAX_FINDINGS_PER_FILE + 1)
    expect(read.diagnostics[MAX_FINDINGS_PER_FILE - 1]).toMatchObject({
      code: 'E_DECL_UNSUPPORTED',
      span: { line: MAX_FINDINGS_PER_FILE + 2, column: 1 },
    })
    expect(read.diagnostics[MAX_FINDINGS_PER_FILE]).toMatchObject({
      code: 'I_FINDINGS_TRUNCATED',
      severity: 'info',
    })
    expect(fullTextScans()).toBeLessThanOrEqual(1)
  })

  it('cuts a finding message that quotes a long key', () => {
    const key = 'k'.repeat(50_000)
    const text = `${HEADER}export default defineTable({ ${key}: 1, ${key}: 2 })\n`

    const read = readDeclaration('tables/t.ts', text, { callee: 'defineTable' })

    expect(read.diagnostics).toHaveLength(1)
    expect(read.diagnostics[0].code).toBe('E_DECL_DUPLICATE_KEY')
    expect(read.diagnostics[0].message.length).toBeLessThan(2_000)
  })

  it('caps field findings across a large file, with one scan of it', () => {
    const count = 2_000
    const columns = Array.from({ length: count }, (_, i) => `c${i}: column.select({})`).join(',\n')
    const text = `// @sim-sdk 1\nimport { column, defineTable } from '@sim/workflow-sdk/workspace'\nexport default defineTable({ name: 't', columns: {\n${columns}\n} })\n`

    const parsed = testTableCodec.parse('big', { 'tables/big.ts': text }, [])

    expect(parsed.diagnostics).toHaveLength(MAX_FINDINGS_PER_FILE + 1)
    const options = parsed.diagnostics.filter((finding) => finding.code === 'E_TABLE_OPTIONS')
    expect(options.at(-1)?.span).toMatchObject({ line: options.length + 3 })
    expect(parsed.diagnostics.at(-1)).toMatchObject({ code: 'I_FINDINGS_TRUNCATED' })
    expect(fullTextScans()).toBeLessThanOrEqual(2)
  })

  it('counts lines at CRLF, CR, LF and U+2028 as Babel does', () => {
    const text = `${HEADER.replace('\n', '\r\n')}export default defineTable({\r  a: 1,\u2028  b: 'x',\n  c: true })\n`

    const read = readDeclaration('tables/t.ts', text, { callee: 'defineTable' })

    expect(read.spans.get('/a')).toMatchObject({ line: 4, column: 6, endLine: 4, endColumn: 7 })
    expect(read.spans.get('/b')).toMatchObject({ line: 5, column: 6 })
    expect(read.spans.get('/c')).toMatchObject({ line: 6, column: 6 })
  })

  it('reads a file saved with a byte order mark as one without it, located alike', () => {
    const text = `${HEADER}export default defineTable({ a: 1 })\n`

    const plain = readDeclaration('tables/t.ts', text, { callee: 'defineTable' })
    const marked = readDeclaration('tables/t.ts', `\uFEFF${text}`, { callee: 'defineTable' })

    expect(marked.diagnostics).toEqual([])
    expect(marked.value).toEqual(plain.value)
    expect(marked.spans.get('/a')).toEqual(plain.spans.get('/a'))
  })
})
