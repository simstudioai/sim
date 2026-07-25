/**
 * @vitest-environment jsdom
 *
 * Pasting markdown source should render as rich content (links, images, badges) rather than literal
 * `[text](url)` text — except inside a code block, where it must stay literal.
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from './extensions'
import { MarkdownPaste } from './markdown-paste'

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

function mount(editable = true): Editor {
  return new Editor({ extensions: [...createMarkdownContentExtensions(), MarkdownPaste], editable })
}

/** Run the plugin paste handlers the way ProseMirror would, with a mocked clipboard. */
function paste(ed: Editor, text: string, html = '', extra: Record<string, string> = {}): boolean {
  const event = {
    clipboardData: {
      getData: (type: string) =>
        type === 'text/plain' ? text : type === 'text/html' ? html : (extra[type] ?? ''),
    },
  } as unknown as ClipboardEvent
  for (const plugin of ed.view.state.plugins) {
    if (plugin.props?.handlePaste?.(ed.view, event, ed.view.state.selection.content())) {
      return true
    }
  }
  return false
}

/** Run the plugin `transformPastedHTML` chain the way ProseMirror would. */
function transformHtml(ed: Editor, html: string): string {
  let out = html
  for (const plugin of ed.view.state.plugins) {
    const fn = plugin.props?.transformPastedHTML
    if (fn) out = fn.call(plugin.props, out, ed.view)
  }
  return out
}

describe('markdown paste', () => {
  it('renders a pasted inline link as a link mark', () => {
    editor = mount()
    expect(paste(editor, '[inline link](https://example.com)')).toBe(true)
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"type":"link"')
    expect(json).toContain('https://example.com')
    expect(json).not.toContain('[inline link]')
  })

  it('renders a pasted badge as a linked image', () => {
    editor = mount()
    expect(paste(editor, '[![build](https://e.com/i.png)](https://ci.example.com)')).toBe(true)
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"type":"image"')
    expect(json).toContain('"href":"https://ci.example.com"')
  })

  it('leaves plain (non-markdown) text to the default handler', () => {
    editor = mount()
    expect(paste(editor, 'just a normal sentence with no syntax')).toBe(false)
  })

  it("prefers the markdown parser over DOM mapping when the HTML sibling's plain-text side also looks like markdown", () => {
    editor = mount()
    expect(paste(editor, '# heading', '<h1>heading</h1>')).toBe(true)
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"type":"heading"')
  })

  it('preserves GFM table alignment on a paste that carries both text/plain and text/html', () => {
    editor = mount()
    const table = '| a | b |\n| :-- | --: |\n| 1 | 2 |'
    const html = '<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>'
    expect(paste(editor, table, html)).toBe(true)
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"align":"left"')
    expect(json).toContain('"align":"right"')
  })

  it('still defers to DOM mapping when the HTML sibling has no markdown-shaped plain-text counterpart', () => {
    editor = mount()
    expect(
      paste(
        editor,
        'just a normal sentence with no syntax',
        '<p>just a normal sentence with no syntax</p>'
      )
    ).toBe(false)
  })

  it('keeps pasted markdown literal inside a code block', () => {
    editor = mount()
    editor.commands.setContent('```js\ncode here\n```', { contentType: 'markdown' })
    editor.commands.setTextSelection(5)
    expect(editor.isActive('codeBlock')).toBe(true)
    expect(paste(editor, '[link](https://example.com)')).toBe(false)
  })

  it('keeps pasted markdown literal inside inline code', () => {
    editor = mount()
    editor.commands.setContent('a `codehere` b', { contentType: 'markdown' })
    editor.commands.setTextSelection(6)
    expect(editor.isActive('code')).toBe(true)
    expect(paste(editor, '*italic*')).toBe(false)
  })

  it('rejects the paste entirely in a read-only editor', () => {
    editor = mount(false)
    expect(paste(editor, '# heading\n\n- one\n- two')).toBe(false)
    expect(editor.getText()).toBe('')
  })

  it.each([
    ['empty string', ''],
    ['whitespace only', '   \n\n  '],
    ['a bare thematic break (ambiguous — needs another markdown signal)', '---'],
  ])('leaves %s to the default handler', (_label, text) => {
    editor = mount()
    expect(paste(editor, text)).toBe(false)
  })

  it.each([
    ['heading', '# Heading', 'heading'],
    ['bold', 'a **bold** word', 'bold'],
    ['italic', 'an *italic* word', 'italic'],
    ['underscore italic', 'an _italic_ word', 'italic'],
    ['underscore bold', 'a __bold__ word', 'bold'],
    ['strikethrough', 'a ~~struck~~ word', 'strike'],
    ['highlight', 'a ==marked== word', 'highlight'],
    ['highlight with interior equals', 'x ==a=b== y', 'highlight'],
    ['inline code', 'some `code` here', 'code'],
    ['bullet list', '- one\n- two', 'bulletList'],
    ['ordered list', '1. one\n2. two', 'orderedList'],
    ['task list', '- [x] done\n- [ ] todo', 'taskList'],
    ['blockquote', '> a quote', 'blockquote'],
    ['fenced code block', '```ts\nconst x = 1\n```', 'codeBlock'],
    ['standalone image', '![alt](https://e.com/i.png)', 'image'],
    ['thematic break within a document', '# Title\n\n---\n\nbody', 'horizontalRule'],
  ])('renders pasted %s as rich content', (_label, md, nodeType) => {
    editor = mount()
    expect(paste(editor, md)).toBe(true)
    expect(JSON.stringify(editor.getJSON())).toContain(`"type":"${nodeType}"`)
  })

  it.each([
    ['italic', 'an *italic* word', '<p>an <em>italic</em> word</p>'],
    ['strikethrough', 'a ~~struck~~ word', '<p>a <del>struck</del> word</p>'],
    ['inline code', 'some `code` here', '<p>some <code>code</code> here</p>'],
  ])('defers inline-only %s to a rich HTML sibling (keeps its structure)', (_label, text, html) => {
    editor = mount()
    expect(paste(editor, text, html)).toBe(false)
  })

  it.each([
    ['space-flanked asterisks', 'area = 5 * width * height'],
    ['python args and kwargs', 'def foo(*args, **kwargs): pass'],
    ['snake_case identifiers', 'call user_name and file_path_here'],
  ])('claims %s but leaves it byte-for-byte literal (strict CommonMark)', (_label, text) => {
    editor = mount()
    expect(paste(editor, text)).toBe(true)
    const json = JSON.stringify(editor.getJSON())
    expect(json).not.toContain('"type":"italic"')
    expect(json).not.toContain('"type":"bold"')
    expect(editor.getText()).toBe(text)
  })

  it('parses markdown-shaped plain text even when an HTML sibling is present', () => {
    editor = mount()
    const html = '<h1>Title</h1><ul><li>a</li><li>b</li></ul>'
    expect(paste(editor, '# Title\n\n- a\n- b', html)).toBe(true)
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"type":"heading"')
    expect(json).toContain('"type":"bulletList"')
    expect(json).not.toContain('# Title')
  })

  it('preserves the structural blocks of a multi-block document, in order, on paste', () => {
    editor = mount()
    expect(paste(editor, '# Title\n\nA paragraph.\n\n- a\n- b\n\n> quote')).toBe(true)
    const structural = (editor.getJSON().content ?? [])
      .map((node) => node.type)
      .filter((type) => type !== 'paragraph')
    expect(structural).toEqual(['heading', 'bulletList', 'blockquote'])
  })

  it('pastes VSCode code (vscode-editor-data) as a fenced code block with its language', () => {
    editor = mount()
    const code = 'const x: number = 1\nreturn x'
    const handled = paste(editor, code, '<div><span>const</span></div>', {
      'vscode-editor-data': JSON.stringify({ mode: 'typescript' }),
    })
    expect(handled).toBe(true)
    const block = (editor.getJSON().content ?? []).find((n) => n.type === 'codeBlock')
    expect(block).toBeDefined()
    expect(block?.attrs?.language).toBe('typescript')
    expect(block?.content?.[0]?.text).toBe(code)
  })

  it.each([
    ['html', 'markup'],
    ['shellscript', 'bash'],
  ])('maps VSCode language id %s to our code-block value %s', (mode, expected) => {
    editor = mount()
    paste(editor, 'code', '', { 'vscode-editor-data': JSON.stringify({ mode }) })
    const block = (editor.getJSON().content ?? []).find((n) => n.type === 'codeBlock')
    expect(block?.attrs?.language).toBe(expected)
  })

  it.each(['markdown', 'md', 'mdx', 'plaintext'])(
    'does NOT force a code block for VSCode %s copies (parses as markdown instead)',
    (mode) => {
      editor = mount()
      const handled = paste(editor, '# Title\n\n- item', '', {
        'vscode-editor-data': JSON.stringify({ mode }),
      })
      expect(handled).toBe(true)
      const types = (editor.getJSON().content ?? []).map((n) => n.type)
      expect(types).not.toContain('codeBlock')
      expect(types).toContain('heading')
      expect(types).toContain('bulletList')
    }
  )

  it('strips <style>/<script> from pasted HTML so their text never leaks into the doc', () => {
    editor = mount()
    const gsheets =
      '<google-sheets-html-origin><style>td{mso-1:2}</style><table><tr><td>a</td></tr></table></google-sheets-html-origin>'
    const cleaned = transformHtml(editor, gsheets)
    expect(cleaned).not.toContain('<style>')
    expect(cleaned).not.toContain('mso-1')
    expect(cleaned).toContain('<td>a</td>')
    expect(transformHtml(editor, 'a<script>alert(1)</script>b')).toBe('ab')
  })

  it('strips nested/repeated <script> tags in a single pass, even deeply nested', () => {
    editor = mount()
    expect(transformHtml(editor, 'a<script>x<script>y</script></script>b')).toBe('ab')
    const deeplyNested = `a${'<script>'.repeat(50)}x${'</script>'.repeat(50)}b`
    expect(transformHtml(editor, deeplyNested)).toBe('ab')
  })

  it('drops an unterminated <script>/<style> and everything after it, without duplicating the prefix', () => {
    editor = mount()
    expect(transformHtml(editor, 'abc<script>never-closes')).toBe('abc')
    expect(transformHtml(editor, 'abc<style>never-closes')).toBe('abc')
    expect(transformHtml(editor, '<script>x<script>y</script>')).toBe('')
  })
})

describe('linkify a selection on URL paste', () => {
  function linkify(
    pasted: string,
    from = 1,
    to = 10
  ): { handled: boolean; href?: string; text: string } {
    editor = mount()
    editor.commands.setContent('select me here', { contentType: 'markdown' })
    editor.commands.setTextSelection({ from, to })
    const handled = paste(editor, pasted)
    return {
      handled,
      href: JSON.stringify(editor.getJSON()).match(/"href":"([^"]+)"/)?.[1],
      text: editor.getText(),
    }
  }

  it('wraps a non-empty text selection in a link when a URL is pasted (keeping the text)', () => {
    const r = linkify('https://sim.ai')
    expect(r.handled).toBe(true)
    expect(r.href).toBe('https://sim.ai')
    expect(r.text).toBe('select me here')
  })

  it('prepends https:// to a bare www host and mailto: to a bare email', () => {
    expect(linkify('www.sim.ai').href).toBe('https://www.sim.ai')
    expect(linkify('a@b.com').href).toBe('mailto:a@b.com')
  })

  it('does not linkify a collapsed caret (empty selection)', () => {
    const r = linkify('https://sim.ai', 5, 5)
    expect(r.handled).toBe(false)
  })

  it('does not linkify a multi-word paste over a selection', () => {
    expect(linkify('not a url just words').handled).toBe(false)
  })

  it('does not linkify an unsafe javascript: url', () => {
    const r = linkify('javascript:alert(1)')
    expect(r.handled).toBe(false)
    expect(r.href).toBeUndefined()
  })

  it('links a real mailto: but not a crafted mailto: payload', () => {
    expect(linkify('mailto:a@b.com').href).toBe('mailto:a@b.com')
    const crafted = linkify('mailto:javascript:alert(1)')
    expect(crafted.handled).toBe(false)
    expect(crafted.href).toBeUndefined()
  })

  it('does not linkify a selection spanning multiple blocks', () => {
    editor = mount()
    editor.commands.setContent('alpha\n\nbeta', { contentType: 'markdown' })
    editor.commands.setTextSelection({ from: 3, to: 9 })
    expect(paste(editor, 'https://sim.ai')).toBe(false)
    expect(JSON.stringify(editor.getJSON())).not.toContain('"type":"link"')
  })
})
