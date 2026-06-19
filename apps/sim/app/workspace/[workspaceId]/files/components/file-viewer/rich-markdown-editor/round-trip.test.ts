/**
 * @vitest-environment jsdom
 *
 * Round-trip fidelity: markdown → editor → markdown must preserve meaning and, critically,
 * be idempotent (a second pass changes nothing) so autosave never churns. Mirrors the exact
 * pipeline the editor uses: split frontmatter out, serialize the body, re-attach + clean up.
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from './extensions'
import {
  applyFrontmatter,
  normalizeLinkHref,
  postProcessSerializedMarkdown,
  splitFrontmatter,
} from './markdown-fidelity'

let editor: Editor | null = null

function roundTrip(input: string): string {
  const { frontmatter, body } = splitFrontmatter(input)
  editor = new Editor({ extensions: createMarkdownContentExtensions() })
  editor.commands.setContent(body, { contentType: 'markdown' })
  const out = applyFrontmatter(frontmatter, postProcessSerializedMarkdown(editor.getMarkdown()))
  editor.destroy()
  editor = null
  return out
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('markdown-fidelity utils', () => {
  it('splits a frontmatter block and its trailing whitespace from the body', () => {
    const fm = '---\ntitle: Hello\ntags: [a, b]\n---'
    const { frontmatter, body } = splitFrontmatter(`${fm}\n\n# Body`)
    expect(frontmatter).toBe(`${fm}\n\n`)
    expect(body).toBe('# Body')
    expect(applyFrontmatter(frontmatter, body)).toBe(`${fm}\n\n# Body`)
  })

  it('preserves the exact frontmatter/body separator (no whitespace churn)', () => {
    for (const original of [
      '---\na: 1\n---\nbody',
      '---\na: 1\n---\n\nbody',
      '---\na: 1\n---\n\n\n\nbody',
      '---\na: 1\n---\r\n\r\nbody',
    ]) {
      const { frontmatter, body } = splitFrontmatter(original)
      expect(frontmatter + body).toBe(original)
    }
  })

  it('recognizes empty and minimal frontmatter blocks', () => {
    const empty = splitFrontmatter('---\n---\n\n# Title')
    expect(empty.frontmatter).toBe('---\n---\n\n')
    expect(empty.body).toBe('# Title')

    const onlyFm = splitFrontmatter('---\ntitle: x\n---')
    expect(onlyFm.frontmatter).toBe('---\ntitle: x\n---')
    expect(onlyFm.body).toBe('')

    const crlf = splitFrontmatter('---\r\n---\r\nbody')
    expect(crlf.frontmatter + crlf.body).toBe('---\r\n---\r\nbody')
    expect(crlf.body).toBe('body')
  })

  it('treats content with no frontmatter as all body', () => {
    expect(splitFrontmatter('# Just a heading')).toEqual({
      frontmatter: '',
      body: '# Just a heading',
    })
    expect(applyFrontmatter('', '# Body')).toBe('# Body')
  })

  it('does not treat a horizontal rule as frontmatter', () => {
    const md = 'above\n\n---\n\nbelow'
    expect(splitFrontmatter(md)).toEqual({ frontmatter: '', body: md })
  })

  it('holds a UTF-8 BOM out of band so frontmatter survives', () => {
    const input = '\uFEFF---\ntitle: x\n---\n\nbody'
    const { frontmatter, body } = splitFrontmatter(input)
    expect(frontmatter.startsWith('\uFEFF')).toBe(true)
    expect(body).toBe('body')
    expect(applyFrontmatter(frontmatter, body)).toBe(input)
  })

  it('restores escaped callout markers', () => {
    expect(postProcessSerializedMarkdown('> \\[!NOTE\\]\n> hi')).toBe('> [!NOTE]\n> hi')
  })

  it('restores escaped callout markers in nested blockquotes', () => {
    expect(postProcessSerializedMarkdown('> > \\[!WARNING\\]\n> > hi')).toBe(
      '> > [!WARNING]\n> > hi'
    )
  })

  it('normalizes link hrefs', () => {
    expect(normalizeLinkHref('')).toBe('')
    expect(normalizeLinkHref('sim.ai')).toBe('https://sim.ai')
    expect(normalizeLinkHref('example.com/path')).toBe('https://example.com/path')
    expect(normalizeLinkHref('https://x.com')).toBe('https://x.com')
    expect(normalizeLinkHref('HTTP://x.com')).toBe('HTTP://x.com')
    expect(normalizeLinkHref('mailto:a@b.com')).toBe('mailto:a@b.com')
    expect(normalizeLinkHref('#anchor')).toBe('#anchor')
    expect(normalizeLinkHref('/relative')).toBe('/relative')
    expect(normalizeLinkHref('  https://x.com  ')).toBe('https://x.com')
    expect(normalizeLinkHref('javascript:alert(1)')).toBe('')
    expect(normalizeLinkHref('data:text/html,<script>')).toBe('')
    expect(normalizeLinkHref('//cdn.example.com/a.js')).toBe('https://cdn.example.com/a.js')
    expect(normalizeLinkHref('ftp://host/file')).toBe('ftp://host/file')
  })

  it('trims a leading blank line and collapses trailing newlines', () => {
    expect(postProcessSerializedMarkdown('\n| a |\n| --- |\n\n\n')).toBe('| a |\n| --- |\n')
  })
})

describe('editor markdown round-trip', () => {
  const cases: Record<string, string> = {
    headings: '# H1\n\n## H2\n\n### H3',
    bold: 'a **bold** word',
    link: 'see [Sim](https://sim.ai)',
    'nested bullets': '- one\n- two\n  - nested',
    ordered: '1. one\n2. two',
    'task list': '- [ ] todo\n- [x] done',
    quote: '> a quote',
    'code block': '```js\nconst x = 1\n```',
    'code block then paragraph': '```\ncode\n```\n\ntext after',
    'code block then image':
      '```markdown\n\n```\n\n![shot](/api/files/serve/x.png?context=workspace)',
    'paragraph then code block': 'text before\n\n```\ncode\n```',
    'two code blocks': '```\na\n```\n\n```\nb\n```',
    mermaid: '```mermaid\ngraph TD\n  A --> B\n```',
    'horizontal rule': 'above\n\n---\n\nbelow',
    table: '| a | b |\n| --- | --- |\n| 1 | 2 |',
    'strike code': '~~`x`~~',
    'bold code': '**`x`**',
    'heading strike code': '# ~~`x`~~',
    'table with pipe': '| x \\| y | 2 |\n| --- | --- |\n| a | b |',
  }

  for (const [name, input] of Object.entries(cases)) {
    it(`is idempotent for ${name}`, () => {
      const once = roundTrip(input)
      const twice = roundTrip(once)
      expect(twice).toBe(once)
    })
  }

  it('preserves frontmatter through a full round-trip', () => {
    const input = '---\ntitle: Hello\ntags: [a, b]\n---\n\n# Body\n\ntext'
    const out = roundTrip(input)
    expect(out).toContain('---\ntitle: Hello\ntags: [a, b]\n---')
    expect(out).toContain('# Body')
    expect(out).toBe(roundTrip(out))
  })

  it('keeps GFM callout markers unescaped', () => {
    expect(roundTrip('> [!NOTE]\n> Heads up')).toContain('[!NOTE]')
  })

  it('preserves an image url (does not drop the src)', () => {
    const out = roundTrip('![alt](https://example.com/i.png)')
    expect(out).toContain('![alt](https://example.com/i.png)')
  })

  it('round-trips a sized image as an HTML <img>, plain images as markdown', () => {
    const sized = roundTrip('<img src="https://e.com/i.png" alt="d" width="320">')
    expect(sized).toContain('<img src="https://e.com/i.png" alt="d" width="320">')
    expect(roundTrip(sized)).toBe(sized)
    expect(roundTrip('![a](https://e.com/i.png)')).toContain('![a](https://e.com/i.png)')
  })

  it('preserves a sized base64 image and escapes quotes in attributes', () => {
    const dataUrl = '<img src="data:image/png;base64,iVBORw0KGgo=" width="200">'
    expect(roundTrip(dataUrl)).toContain('data:image/png;base64,iVBORw0KGgo=')
    expect(roundTrip(dataUrl)).toBe(roundTrip(roundTrip(dataUrl)))
    const quoted = roundTrip('<img src="/x.png" alt=\'a"b\' width="320">')
    expect(quoted).toContain('alt="a&quot;b"')
    expect(roundTrip(quoted)).toBe(quoted)
  })

  it('round-trips a code block that contains a fence line (sized fence)', () => {
    const out = roundTrip('````md\n```\ncode\n```\n````')
    expect(out).toContain('```\ncode\n```')
    expect(roundTrip(out)).toBe(out)
  })

  it('keeps a mermaid block as a fenced code block', () => {
    expect(roundTrip('```mermaid\ngraph TD\n  A --> B\n```')).toContain('```mermaid')
  })

  it('keeps task list checkbox state', () => {
    const out = roundTrip('- [ ] todo\n- [x] done')
    expect(out).toContain('- [ ] todo')
    expect(out).toContain('- [x] done')
  })

  it('keeps a table as a GFM pipe table with no leading blank line', () => {
    const out = roundTrip('| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(out.startsWith('|')).toBe(true)
    expect(out).toContain('| --- |')
  })

  it('combines strikethrough with inline code (relaxed code mark)', () => {
    expect(roundTrip('~~`x`~~')).toContain('~~`x`~~')
    expect(roundTrip('# ~~`x`~~')).toContain('# ~~`x`~~')
  })

  it('escapes interior pipes in table cells (no phantom column split)', () => {
    const out = roundTrip('| x \\| y | 2 |\n| --- | --- |\n| a | b |')
    expect(out).toContain('x \\| y')
  })
})
