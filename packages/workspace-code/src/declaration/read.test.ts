/**
 * The reader keeps a span for every value of a declaration of up to the byte cap, so locating a
 * value must not rescan the file: each scan of the whole text is counted here (`splitLines`, and a
 * `codeFrame` handed the raw text, which splits it again), and a large file may scan it once.
 */
import * as workflowCode from '@sim/workflow-code'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tableCodec } from '../kinds/table'
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

  it('frames thousands of findings in one file without rescanning it per finding', () => {
    const count = 20_000
    const text = `${HEADER}export default defineTable({ x: [${Array(count).fill('a').join(',\n')}] })\n`

    const read = readDeclaration('tables/big.ts', text, { callee: 'defineTable' })

    expect(read.diagnostics).toHaveLength(count)
    expect(read.diagnostics[count - 1]).toMatchObject({
      code: 'E_DECL_UNSUPPORTED',
      span: { line: count + 2, column: 1 },
    })
    expect(fullTextScans()).toBeLessThanOrEqual(1)
  })

  it('reports field findings across a large file with one scan of it', () => {
    const count = 2_000
    const columns = Array.from({ length: count }, (_, i) => `c${i}: column.select({})`).join(',\n')
    const text = `// @sim-sdk 1\nimport { column, defineTable } from '@sim/workflow-sdk/workspace'\nexport default defineTable({ name: 't', columns: {\n${columns}\n} })\n`

    const parsed = tableCodec.parse('big', { 'tables/big.ts': text }, [])

    const options = parsed.diagnostics.filter((finding) => finding.code === 'E_TABLE_OPTIONS')
    expect(options).toHaveLength(count)
    expect(options[count - 1].span).toMatchObject({ line: count + 3 })
    expect(fullTextScans()).toBeLessThanOrEqual(2)
  })

  it('counts lines at CRLF, CR, LF and U+2028 as Babel does', () => {
    const text = `${HEADER.replace('\n', '\r\n')}export default defineTable({\r  a: 1,   b: 'x',\n  c: true })\n`

    const read = readDeclaration('tables/t.ts', text, { callee: 'defineTable' })

    expect(read.spans.get('/a')).toMatchObject({ line: 4, column: 6, endLine: 4, endColumn: 7 })
    expect(read.spans.get('/b')).toMatchObject({ line: 5, column: 6 })
    expect(read.spans.get('/c')).toMatchObject({ line: 6, column: 6 })
  })
})
