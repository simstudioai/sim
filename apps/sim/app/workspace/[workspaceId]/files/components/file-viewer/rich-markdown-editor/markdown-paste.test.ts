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
function paste(ed: Editor, text: string, html = ''): boolean {
  const event = {
    clipboardData: {
      getData: (type: string) => (type === 'text/plain' ? text : type === 'text/html' ? html : ''),
    },
  } as unknown as ClipboardEvent
  for (const plugin of ed.view.state.plugins) {
    if (plugin.props?.handlePaste?.(ed.view, event, ed.view.state.selection.content())) {
      return true
    }
  }
  return false
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
    ['strikethrough', 'a ~~struck~~ word', 'strike'],
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
})
