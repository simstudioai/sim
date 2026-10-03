/**
 * @vitest-environment jsdom
 *
 * Round-trip fidelity: markdown → editor → markdown must preserve meaning and, critically,
 * be idempotent (a second pass changes nothing) so autosave never churns. Mirrors the exact
 * pipeline the editor uses: split frontmatter out, serialize the body, re-attach + clean up.
 */
import type { JSONContent } from '@tiptap/core'
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from './extensions'
import {
  applyFrontmatter,
  normalizeLinkHref,
  postProcessSerializedMarkdown,
  splitFrontmatter,
} from './markdown-fidelity'
import { parseMarkdownToDoc } from './markdown-parse'

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

  it('holds a UTF-8 BOM out of band so frontmatter survives', () => {
    const input = '\uFEFF---\ntitle: x\n---\n\nbody'
    const { frontmatter, body } = splitFrontmatter(input)
    expect(frontmatter.startsWith('\uFEFF')).toBe(true)
    expect(body).toBe('body')
    expect(applyFrontmatter(frontmatter, body)).toBe(input)
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
    // Adding `//` doesn't make a scheme safe, and an unknown scheme is dropped rather than trusted —
    // the allowlist is the whole rule.
    expect(normalizeLinkHref('javascript://%0aalert(1)')).toBe('')
    expect(normalizeLinkHref('customproto://host/path')).toBe('')
  })

  /**
   * The property that matters, stated over the spellings a browser collapses before it resolves a
   * scheme: whatever comes back must not be executable. Padding and interior tabs/newlines are the
   * usual way a blocked scheme is smuggled past a matcher that only reads the literal text.
   */
  it('never returns a target that resolves to an executable scheme', () => {
    const tab = String.fromCharCode(9)
    const lf = String.fromCharCode(10)
    const nbsp = String.fromCharCode(160)
    const inputs = [
      'javascript://%0aalert(1)',
      'javascript:alert(1)',
      'JAVASCRIPT://x',
      ' javascript:alert(1) ',
      `${nbsp}javascript:alert(1)`,
      `java${tab}script://alert(1)`,
      `java${lf}script:alert(1)`,
      'data://text/html,<script>',
      'vbscript://x',
      'blob://x',
      'file://x',
    ]

    const executable = inputs.filter((input) =>
      /^(?:javascript|data|vbscript|blob|file):/.test(
        normalizeLinkHref(input)
          .replace(/[\t\n\r]/g, '')
          .toLowerCase()
      )
    )
    expect(executable).toEqual([])
  })

  /**
   * A linked image carries its target in a node attribute rather than a link mark, so the mark's own
   * URI validation never sees it and the raw target survives parsing — which is correct, since the
   * document must serialize back verbatim. `image.tsx` builds its anchor from
   * `normalizeLinkHref(attrs.href)` and omits the anchor entirely when that is empty, so this is the
   * step that decides whether the target ever reaches the DOM.
   */
  it('drops a dangerous linked-image target before it can reach an anchor', () => {
    const doc = parseMarkdownToDoc('[![a](https://x.example/i.png)](javascript://%0aalert(1))')
    const hrefs: string[] = []
    const walk = (node: JSONContent) => {
      if (node.type === 'image' && typeof node.attrs?.href === 'string') hrefs.push(node.attrs.href)
      node.content?.forEach(walk)
    }
    walk(doc)

    // The parser preserves the authored target — serialization round-trips it verbatim.
    expect(hrefs).toHaveLength(1)
    expect(hrefs[0]).toContain('javascript://')
    // …and the renderer refuses to build an anchor out of it.
    expect(normalizeLinkHref(hrefs[0])).toBe('')
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
    'bold italic nested': '**bold _italic_ word**',
    'strike bold nested': '~~**struck bold**~~',
    'bold code inline': '**bold `code` here**',
    'triple nested marks': '*i **b ~~s~~** i*',
    'all marks in heading': '# **b** ~~s~~ *i* `c`',
    'marks in bullet': '- **a** ~~b~~ `c`',
    'marks in quote': '> **a** ~~b~~ *c*',
    'nested list marks': '- **a**\n  - ~~b~~\n    - *c*',
    'bold link': '[**bold link**](https://x.com)',
    'link inside bold': '**see [x](https://x.com)**',
    'table with marks': '| **b** | ~~s~~ | `c` |\n| --- | --- | --- |\n| *i* | a | b |',
    'bold across code boundary': '**a** `b` **c**',
    highlight: 'a ==marked== word',
    'highlight in heading': '# a ==mark== b',
    'highlight nested in bold': '**bold ==mark== here**',
    'highlight in list': '- ==a== item',
    'highlight with interior equals': 'x ==a=b== y',
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

  it('round-trips a sized image as an HTML <img>, plain images as markdown', () => {
    const sized = roundTrip('<img src="https://e.com/i.png" alt="d" width="320">')
    expect(sized).toContain('<img src="https://e.com/i.png" alt="d" width="320">')
    expect(roundTrip(sized)).toBe(sized)
    expect(roundTrip('![a](https://e.com/i.png)')).toContain('![a](https://e.com/i.png)')
  })

  it('round-trips every sized linked-image attribute without dropping dimensions', () => {
    const source =
      '[<img src="https://e.com/i.png" alt="" title="Diagram" width="320" height="180">](https://e.com "Details")'
    const out = roundTrip(source)

    expect(out).toContain('alt=""')
    expect(out).toContain('width="320" height="180"')
    expect(out).toContain('](https://e.com "Details")')
    expect(roundTrip(out)).toBe(out)
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

describe('highlight ==mark==', () => {
  it('strips a highlight whose text contains `==` (unrepresentable), keeping the text', () => {
    editor = new Editor({ extensions: createMarkdownContentExtensions() })
    editor.commands.setContent('x a==b y', { contentType: 'markdown' })
    let from = -1
    let to = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.isText) {
        const i = node.text?.indexOf('a==b') ?? -1
        if (i >= 0) {
          from = pos + i
          to = from + 4
        }
      }
    })
    editor.commands.setTextSelection({ from, to })
    editor.commands.toggleMark('highlight')
    const md = postProcessSerializedMarkdown(editor.getMarkdown())
    expect(JSON.stringify(editor.getJSON())).not.toContain('"type":"highlight"')
    expect(md).not.toContain('==a==b==')
    expect(editor.getText().trim()).toBe('x a==b y')
    editor.destroy()
    editor = null
  })
})
