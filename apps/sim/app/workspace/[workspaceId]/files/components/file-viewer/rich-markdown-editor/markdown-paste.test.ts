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

function mount(): Editor {
  return new Editor({ extensions: [...createMarkdownContentExtensions(), MarkdownPaste] })
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

  it('does not markdown-parse a paste that carries richer HTML', () => {
    editor = mount()
    expect(paste(editor, '# heading', '<h1>heading</h1>')).toBe(false)
  })

  it('keeps pasted markdown literal inside a code block', () => {
    editor = mount()
    editor.commands.setContent('```js\ncode here\n```', { contentType: 'markdown' })
    editor.commands.setTextSelection(5)
    expect(editor.isActive('codeBlock')).toBe(true)
    expect(paste(editor, '[link](https://example.com)')).toBe(false)
  })
})
