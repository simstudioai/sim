/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  collectSimPageDiagnostics,
  compileSimPage,
  isSimPageSource,
} from '@/lib/workspace-files/page-compile'

/**
 * A `sim:table` payload whose cell count is the PRODUCT of two alias lists while
 * its source length is their SUM: `columns` is anchored once and every row is an
 * alias to it, so `n` rows over `n` columns cost ~13n source bytes and render
 * n² cells. This is the shape that makes the fence renderers amplify — a deeply
 * nested alias chain does not, because every payload schema is at most
 * `array of array of scalar` and rejects depth 3 without descending.
 */
function aliasedTable(n: number): string {
  const columns = Array.from({ length: n }, () => '  - x').join('\n')
  const rows = Array.from({ length: n }, () => '  - *c').join('\n')
  return `columns: &c\n${columns}\nrows:\n${rows}\n`
}

/** A `sim:steps` payload that aliases one large markdown body `n` times. */
function aliasedSteps(n: number, markdownBytes: number): string {
  const markdown = 'lorem ipsum dolor sit amet '.repeat(Math.ceil(markdownBytes / 27))
  const repeats = Array.from({ length: n - 1 }, () => '- *s').join('\n')
  return `- &s\n  title: T\n  markdown: "${markdown.slice(0, markdownBytes)}"\n${repeats}\n`
}

function page(kind: string, payload: string): string {
  return `---\ntitle: T\n---\n\`\`\`sim:${kind}\n${payload}\`\`\`\n`
}

describe('page compile YAML expansion limits', () => {
  it('renders a table whose expanded size is within the budget', () => {
    const html = compileSimPage(page('table', aliasedTable(40)))
    expect(html).toContain('<table>')
    expect(collectSimPageDiagnostics(page('table', aliasedTable(40)))).toEqual([])
  })

  it('skips a table whose aliases expand past the budget', () => {
    const source = page('table', aliasedTable(400))
    const html = compileSimPage(source)

    expect(html).not.toContain('<table>')
    expect(collectSimPageDiagnostics(source)).toEqual([
      expect.stringContaining('sim:table block starting "columns: &c" skipped:'),
    ])
    expect(collectSimPageDiagnostics(source)[0]).toContain('too large to render')
  })

  it('bounds the compile cost of an alias bomb that would otherwise be quadratic', () => {
    // 2000 x 2000 renders 4M cells through marked.parseInline — seconds of CPU
    // and tens of MB of HTML per request, from 25 KB of source.
    const source = page('table', aliasedTable(2000))

    const started = performance.now()
    const html = compileSimPage(source)
    const elapsed = performance.now() - started

    expect(html).not.toContain('<td>')
    expect(html.length).toBeLessThan(64 * 1024)
    expect(elapsed).toBeLessThan(1000)
  })

  it('charges aliased strings by their expanded bytes, not their node count', () => {
    // Only ~2000 nodes, but 2000 x 4 KB of markdown reaches the renderer.
    const source = page('steps', aliasedSteps(2000, 4096))
    const html = compileSimPage(source)

    expect(html).not.toContain('<ol class="steps">')
    expect(collectSimPageDiagnostics(source)[0]).toContain('maximum serialized size')
  })

  it('shares one budget across every block, so splitting buys no extra rendering', () => {
    const oneBlock = page('table', aliasedTable(150))
    expect(collectSimPageDiagnostics(oneBlock)).toEqual([])

    const manyBlocks = `---\ntitle: T\n---\n${Array.from(
      { length: 6 },
      () => `\`\`\`sim:table\n${aliasedTable(150)}\`\`\`\n`
    ).join('\n')}`
    const diagnostics = collectSimPageDiagnostics(manyBlocks)

    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics.length).toBeLessThan(6)
    expect(diagnostics.at(-1)).toContain('spent its whole structured-block budget')
  })

  it('refuses to recognize page source whose frontmatter expands past the budget', () => {
    const nav = Array.from({ length: 400 }, () => '  - *g').join('\n')
    const pages = Array.from({ length: 400 }, () => '    - "[A](sim:file/a)"').join('\n')
    const source = `---\ntitle: T\nnav:\n  - &g\n    pages:\n${pages}\n${nav}\n---\nBody.\n`

    expect(isSimPageSource(source)).toBe(false)
  })

  it('leaves an ordinary page and its diagnostics untouched', () => {
    const source = [
      '---',
      'title: Report',
      '---',
      'Intro prose.',
      '```sim:table',
      'columns: [Name, Count:num]',
      'rows:',
      '  - [alpha, 1]',
      '  - [beta, 2]',
      '```',
      '```sim:kv',
      '- key: Owner',
      '  value: Ops',
      '```',
      '```sim:table',
      'columns: nope',
      '```',
    ].join('\n')

    const html = compileSimPage(source)
    expect(html).toContain('<td>alpha</td>')
    expect(html).toContain('<ul class="rows">')
    expect(collectSimPageDiagnostics(source)).toEqual([
      'sim:table block starting "columns: nope" skipped: its payload did not match the expected shape',
    ])
  })

  it('still reports a malformed payload as a syntax error, not a size error', () => {
    const source = '---\ntitle: T\n---\n```sim:table\ncolumns: [a\n```'
    expect(collectSimPageDiagnostics(source)).toEqual([
      expect.stringContaining('its payload is not valid YAML/JSON —'),
    ])
  })
})
