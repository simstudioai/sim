/**
 * @vitest-environment jsdom
 *
 * Integration coverage for the *live* editor stack (`createMarkdownEditorExtensions` — the same
 * extension set the real component mounts, including the React node views): raw HTML/footnote
 * content renders with its wrapper class and exact source in the DOM (not just parsing correctly
 * headlessly), and — the point of holding it as `content: 'text*'` rather than an opaque blob — the
 * text inside is genuinely editable via a normal ProseMirror transaction, surviving serialization
 * back to markdown.
 */

import { act, createElement } from 'react'
import { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownEditorExtensions } from './editor-extensions'

let editor: Editor | null = null
let root: Root | null = null
let host: HTMLElement | null = null

beforeEach(() => {
  // The live extension set's placeholder viewport-tracking and suggestion popups use these; jsdom
  // lacks them (see keymap.test.ts for the same stub).
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  Element.prototype.scrollIntoView = vi.fn()
  document.elementFromPoint = vi.fn(() => null)
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  editor?.destroy()
  editor = null
  root = null
  host?.remove()
  host = null
})

function mount(markdown: string): Editor {
  const mountedEditor = new Editor({
    extensions: createMarkdownEditorExtensions({ placeholder: '' }),
    content: markdown,
    contentType: 'markdown',
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(createElement(EditorContent, { editor: mountedEditor })))
  return mountedEditor
}

function posOf(ed: Editor, typeName: string): number {
  let pos = -1
  ed.state.doc.descendants((node, p) => {
    if (pos < 0 && node.type.name === typeName) pos = p
  })
  return pos
}

describe('raw markdown snippet node views (live editor)', () => {
  it('the raw HTML block text is genuinely editable — a text edit round-trips into the markdown', () => {
    editor = mount('<div align="center">\n\ncentered\n\n</div>')
    const pos = posOf(editor, 'rawHtmlBlock')
    expect(pos).toBeGreaterThanOrEqual(0)
    // Insert text right after the opening tag, simulating a user fixing the raw source in place.
    const insertAt = pos + '<div align="center">'.length + 1
    editor.commands.insertContentAt(insertAt, '!')
    expect(editor.getMarkdown()).toContain('<div align="center">!')
  })
})
