import { describe, expect, it } from 'vitest'
import { findViolations } from './check-comment-hygiene'

function rules(source: string, file = 'example.ts') {
  return findViolations(file, source).map(({ rule, line }) => `${rule}@${line}`)
}

describe('banner', () => {
  it('flags decorated separators in line and single-line block comments', () => {
    const source = [
      '// ==========',
      '// --- Helpers ---',
      '  // ─── Runs ───',
      '/* ------ v2 grammar ------ */',
      'const a = 1',
    ].join('\n')
    expect(rules(source)).toEqual(['banner@1', 'banner@2', 'banner@3', 'banner@4'])
  })

  it('ignores separators inside strings and multi-line TSDoc', () => {
    const source = [
      'const frontmatter = `',
      '// ---',
      '`',
      '/**',
      ' * ---',
      ' * name: skill',
      ' * ---',
      ' */',
      'export const b = frontmatter',
    ].join('\n')
    expect(rules(source)).toEqual([])
  })
})

describe('commented-out-code', () => {
  it('flags a commented-out object under a prose heading', () => {
    const source = [
      'const blocks = [',
      '  // Disabled until the endpoint is back',
      '  // {',
      "  //   id: 'query',",
      "  //   condition: { field: 'operation', value: 'search' },",
      '  // },',
      ']',
    ].join('\n')
    expect(rules(source)).toEqual(['commented-out-code@3'])
  })

  it('flags snippets that only parse separately', () => {
    const source = [
      '// {',
      "//   id: 'x',",
      '// },',
      "// export type Mode = 'raw' | 'pretty'",
    ].join('\n')
    expect(rules(source)).toEqual(['commented-out-code@1'])
  })

  it('flags single commented-out statements', () => {
    expect(rules("// export type Mode = 'raw' | 'pretty'")).toEqual(['commented-out-code@1'])
    expect(rules('// await flushQueue(queue);')).toEqual(['commented-out-code@1'])
  })

  it('ignores prose that happens to look like code', () => {
    const source = [
      '// firstRow: text=bg1, bold, fill=accent',
      '// Total = 22',
      '// limit=3 → [3,3,1]',
      '// Shows (Podcasts)',
      '// Title (for issue creation)',
      '// Example: [{ fields: { "Field 1": "Value1" } }]',
      '// return early when nothing changed.',
      '',
      '// cos(wd2, 2160000)',
      '',
      '// settings.get(key).value',
      '',
      '// Total: { count: 1 }',
      '// Shape: { id: 2 }',
      'const c = 1',
    ].join('\n')
    expect(rules(source)).toEqual([])
  })

  it('ignores trailing comments, tool directives and allowed samples', () => {
    const source = [
      'run() // await retry(run);',
      '// biome-ignore lint/suspicious/noExplicitAny: external payload',
      'const d: any = 1',
      '// comment-hygiene-allow: documents the call shape the worker expects',
      '// await worker.run({ id });',
    ].join('\n')
    expect(rules(source)).toEqual([])
  })

  it('parses JSX in tsx files', () => {
    expect(rules('// return <Panel open={open} />;', 'view.tsx')).toEqual(['commented-out-code@1'])
  })
})
