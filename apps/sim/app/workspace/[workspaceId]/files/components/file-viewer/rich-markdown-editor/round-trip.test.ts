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

  it('does not treat a leading `---` thematic break as frontmatter (keeps the top section visible)', () => {
    // A changelog whose second `---` would close the regex: the `## v2.0` section must stay in body.
    const md = '---\n\n## v2.0\n\nnotes\n\n---\n\n## v1.0'
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
    // Relative paths stay relative (not prefixed into `https://./…`).
    expect(normalizeLinkHref('./other.md')).toBe('./other.md')
    expect(normalizeLinkHref('../doc.md')).toBe('../doc.md')
    expect(normalizeLinkHref('  https://x.com  ')).toBe('https://x.com')
    expect(normalizeLinkHref('javascript:alert(1)')).toBe('')
    expect(normalizeLinkHref('data:text/html,<script>')).toBe('')
    expect(normalizeLinkHref('//cdn.example.com/a.js')).toBe('https://cdn.example.com/a.js')
    expect(normalizeLinkHref('ftp://host/file')).toBe('ftp://host/file')
    // Dangerous schemes rejected; a bare host:port is still treated as a domain.
    expect(normalizeLinkHref('file:///etc/passwd')).toBe('')
    expect(normalizeLinkHref('blob:https://x.com/uuid')).toBe('')
    expect(normalizeLinkHref('vbscript:msgbox(1)')).toBe('')
    expect(normalizeLinkHref('localhost:3000/path')).toBe('https://localhost:3000/path')
  })

  it('collapses trailing blank lines and preserves leading whitespace', () => {
    expect(postProcessSerializedMarkdown('| a |\n| --- |\n\n\n')).toBe('| a |\n| --- |\n')
    // No global leading-newline strip (the table trims its own at the source), so content that
    // legitimately begins with a blank line is no longer clobbered on save.
    expect(postProcessSerializedMarkdown('\nbody\n')).toBe('\nbody\n')
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

  // The `@`-mention link scheme must survive the schema, or the mention is silently stripped to
  // plain text (which idempotency above can't detect). See the `sim` protocol in extensions.ts.
  it('preserves a @-mention sim: link', () => {
    const input = 'see [my-skill](sim:skill/abc123) and [Spec](sim:file/xyz-789)'
    expect(roundTrip(input)).toBe(input)
  })

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

  it('round-trips an image whose alt/title contain delimiter characters (idempotent)', () => {
    const input = '![a [b] c](https://example.com/i.png "ti\\"tle")'
    const out = roundTrip(input)
    expect(roundTrip(out)).toBe(out)
    expect(out).toContain('https://example.com/i.png')
  })

  it('round-trips a linked image / badge (keeps the wrapping link)', () => {
    const out = roundTrip(
      '[![build](https://img.shields.io/badge/x-green)](https://ci.example.com)'
    )
    expect(out).toContain(
      '[![build](https://img.shields.io/badge/x-green)](https://ci.example.com)'
    )
    expect(roundTrip(out)).toBe(out)
  })

  it('keeps a plain image plain (no spurious link wrapper)', () => {
    const out = roundTrip('![alt](https://example.com/i.png)')
    expect(out).not.toContain('](https://example.com/i.png)](')
    expect(out.trim()).toBe('![alt](https://example.com/i.png)')
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

  it('escapes only interior cell pipes, not the structural delimiters', () => {
    const out = roundTrip('| a | b |\n| --- | --- |\n| one \\| two | three |')
    expect(out).toContain('one \\| two')
    expect(out).toContain('| three |')
    // Every row keeps exactly its two structural columns (3 pipes per line).
    for (const line of out.trim().split('\n')) {
      expect((line.match(/(?<!\\)\|/g) ?? []).length).toBe(3)
    }
    expect(roundTrip(out)).toBe(out)
  })

  it('combines strikethrough with inline code (relaxed code mark)', () => {
    expect(roundTrip('~~`x`~~')).toContain('~~`x`~~')
    expect(roundTrip('# ~~`x`~~')).toContain('# ~~`x`~~')
  })

  it('escapes interior pipes in table cells (no phantom column split)', () => {
    const out = roundTrip('| x \\| y | 2 |\n| --- | --- |\n| a | b |')
    expect(out).toContain('x \\| y')
  })

  it('does not churn blank lines around an interior table', () => {
    const out = roundTrip('before\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter')
    expect(out).not.toContain('\n\n\n')
    expect(out).toContain('before')
    expect(out).toContain('after')
    expect(roundTrip(out)).toBe(out)
  })

  it('does not churn blank lines between two adjacent tables', () => {
    const out = roundTrip('| a |\n| --- |\n| 1 |\n\n| b |\n| --- |\n| 2 |')
    expect(out).not.toContain('\n\n\n')
    expect(roundTrip(out)).toBe(out)
  })

  it('preserves blank lines inside a fenced code block (table trim must not touch code)', () => {
    const out = roundTrip('```js\na\n\n\nb\n```')
    expect(out).toContain('a\n\n\nb')
    expect(roundTrip(out)).toBe(out)
  })
})

/**
 * Links come from arbitrary file content (a README the editor opens, agent-written markdown), not
 * just user-typed text — so the rendered anchor must never carry a dangerous scheme. This locks the
 * guarantee in our own test rather than trusting a transitive TipTap default to keep neutralizing
 * `javascript:`/`data:`/`vbscript:` across version bumps.
 */
describe('link href sanitization — dangerous schemes from file content are neutralized', () => {
  function renderedHrefs(markdown: string): Array<string | null> {
    editor = new Editor({ extensions: createMarkdownContentExtensions() })
    editor.commands.setContent(markdown, { contentType: 'markdown' })
    const html = editor.getHTML()
    editor.destroy()
    editor = null
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return Array.from(doc.querySelectorAll('a')).map((a) => a.getAttribute('href'))
  }

  it.each([
    'javascript:alert(document.cookie)',
    'JaVaScRiPt:alert(1)',
    '  javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
  ])('does not render %s as a clickable href', (scheme) => {
    for (const href of renderedHrefs(`[click me](${scheme})`)) {
      expect((href ?? '').replace(/\s/g, '')).not.toMatch(/^(javascript|data|vbscript):/i)
    }
  })

  it('preserves safe http/https/mailto links', () => {
    const hrefs = renderedHrefs('[a](https://ok.example.com)\n\n[b](mailto:x@y.com)')
    expect(hrefs).toContain('https://ok.example.com')
    expect(hrefs).toContain('mailto:x@y.com')
  })
})

describe('paragraph leading guard (marker escaping + indent stripping)', () => {
  /** Serialize a doc whose first paragraph literally starts with `text`, then re-parse its first node. */
  function serializeParagraph(text: string): {
    md: string
    reparsedType: string
    idempotent: boolean
  } {
    editor = new Editor({ extensions: createMarkdownContentExtensions() })
    editor.commands.setContent(
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
      { contentType: 'json' }
    )
    const md = postProcessSerializedMarkdown(editor.getMarkdown())
    editor.commands.setContent(md, { contentType: 'markdown' })
    const reparsedType = editor.getJSON().content?.[0]?.type ?? ''
    const idempotent = postProcessSerializedMarkdown(editor.getMarkdown()) === md
    editor.destroy()
    editor = null
    return { md, reparsedType, idempotent }
  }

  it.each([
    ['# note', '\\# note'],
    ['###### note', '\\###### note'],
    ['#', '\\#'],
    ['- item', '\\- item'],
    ['+ item', '\\+ item'],
    ['1. step', '1\\. step'],
    ['1) step', '1\\) step'],
    ['---', '\\---'],
    ['- - -', '\\- - -'],
  ])('escapes a paragraph starting with %j so it stays a paragraph', (text, expectedMd) => {
    const { md, reparsedType, idempotent } = serializeParagraph(text)
    expect(md.trim()).toBe(expectedMd)
    expect(reparsedType).toBe('paragraph')
    expect(idempotent).toBe(true)
  })

  it.each([
    ['#hashtag'], // no space after # → not a heading
    ['-5 degrees'], // no space after - → not a bullet
    ['plain text'],
  ])('does not over-escape %j', (text) => {
    const { md, reparsedType, idempotent } = serializeParagraph(text)
    expect(md.trim()).toBe(text)
    expect(reparsedType).toBe('paragraph')
    expect(idempotent).toBe(true)
  })

  it.each([
    ['    four spaces', 'four spaces'],
    ['\ttab indent', 'tab indent'],
    ['        eight spaces', 'eight spaces'],
    ['   # indented marker', '\\# indented marker'],
  ])(
    'strips leading indent so %j stays a paragraph instead of an indented code block',
    (text, expectedMd) => {
      const { md, reparsedType, idempotent } = serializeParagraph(text)
      expect(md.trim()).toBe(expectedMd)
      expect(reparsedType).toBe('paragraph')
      expect(idempotent).toBe(true)
    }
  )
})

describe('consecutive empty paragraphs', () => {
  /** Doc with `a`, then `count` empty paragraphs, then `b`; serialized and round-tripped. */
  function serializeEmpties(count: number) {
    editor = new Editor({ extensions: createMarkdownContentExtensions() })
    const emptyParas = Array.from({ length: count }, () => ({ type: 'paragraph', content: [] }))
    editor.commands.setContent(
      {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
          ...emptyParas,
          { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
        ],
      },
      { contentType: 'json' }
    )
    const md = postProcessSerializedMarkdown(editor.getMarkdown())
    editor.commands.setContent(md, { contentType: 'markdown' })
    const emptyCount = (editor.getJSON().content ?? []).filter(
      (n) => n.type === 'paragraph' && !n.content?.length
    ).length
    const idempotent = postProcessSerializedMarkdown(editor.getMarkdown()) === md
    editor.destroy()
    editor = null
    return { md, emptyCount, idempotent }
  }

  it.each([[1], [2], [3], [4]])(
    'preserves %i empty paragraph(s) via blank lines (no &nbsp;, idempotent, no read-only trigger)',
    (count) => {
      const { md, emptyCount, idempotent } = serializeEmpties(count)
      expect(md).not.toContain('&nbsp;')
      expect(md).not.toContain(String.fromCharCode(0x00a0))
      expect(emptyCount).toBe(count)
      expect(idempotent).toBe(true)
    }
  )
})
