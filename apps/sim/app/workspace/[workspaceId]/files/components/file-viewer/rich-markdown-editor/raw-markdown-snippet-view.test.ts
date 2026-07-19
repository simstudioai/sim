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

import { sleep } from '@sim/utils/helpers'
import { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownEditorExtensions } from './editor-extensions'

let editor: Editor | null = null

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
  editor?.destroy()
  editor = null
})

function mount(markdown: string): Editor {
  return new Editor({
    extensions: createMarkdownEditorExtensions({ placeholder: '' }),
    content: markdown,
    contentType: 'markdown',
  })
}

function posOf(ed: Editor, typeName: string): number {
  let pos = -1
  ed.state.doc.descendants((node, p) => {
    if (pos < 0 && node.type.name === typeName) pos = p
  })
  return pos
}

/** React node views flush on a microtask after mount, so DOM assertions need one tick. */
function nextTick(): Promise<void> {
  return sleep(0)
}

// The hover "Raw HTML"/"Footnote" badge is rendered by `RawBlockView` through
// `ReactNodeViewRenderer`, which only flushes its React portal once `@tiptap/react`'s
// `contentComponent` is set — that requires mounting through `<EditorContent>` (a real React render
// tree), which this repo's tests don't do for this directory (no `@testing-library/react` installed
// here) and constructing a plain `new Editor()` doesn't provide. What IS verifiable and matters more
// at this level — the node renders with the correct wrapper class and holds the exact raw source
// text — is covered below; the badge itself is decorative chrome, checked manually.
describe('raw markdown snippet node views (live editor)', () => {
  it('renders a raw HTML block with the correct wrapper class and exact raw source', async () => {
    editor = mount('<details><summary>More</summary>\n\nbody\n\n</details>')
    await nextTick()
    const el = editor.view.dom
    const block = el.querySelector('.raw-markdown-block')
    expect(block).not.toBeNull()
    expect(block?.textContent).toContain('<details><summary>More</summary>')
  })

  it('renders a footnote definition block with the correct wrapper class and exact raw source', async () => {
    editor = mount('a claim[^1]\n\n[^1]: the source')
    await nextTick()
    const el = editor.view.dom
    const block = el.querySelector('.raw-markdown-block')
    expect(block).not.toBeNull()
    expect(block?.textContent).toContain('[^1]: the source')
  })

  it('renders inline raw HTML as a distinct inline chip, not a plain paragraph', async () => {
    editor = mount('a <kbd>Ctrl</kbd> b')
    await nextTick()
    const el = editor.view.dom
    const inline = el.querySelector('.raw-markdown-inline')
    expect(inline).not.toBeNull()
    expect(inline?.textContent).toBe('<kbd>Ctrl</kbd>')
  })

  it('the raw HTML block text is genuinely editable — a text edit round-trips into the markdown', () => {
    editor = mount('<div align="center">\n\ncentered\n\n</div>')
    const pos = posOf(editor, 'rawHtmlBlock')
    expect(pos).toBeGreaterThanOrEqual(0)
    // Insert text right after the opening tag, simulating a user fixing the raw source in place.
    const insertAt = pos + '<div align="center">'.length + 1
    editor.commands.insertContentAt(insertAt, '!')
    expect(editor.getMarkdown()).toContain('<div align="center">!')
  })

  it('the footnote definition text is genuinely editable', () => {
    editor = mount('a claim[^1]\n\n[^1]: old text')
    const pos = posOf(editor, 'footnoteDef')
    expect(pos).toBeGreaterThanOrEqual(0)
    const node = editor.state.doc.nodeAt(pos)
    const insertAt = pos + (node?.nodeSize ?? 1) - 1
    editor.commands.insertContentAt(insertAt, ' EDITED')
    expect(editor.getMarkdown()).toContain('[^1]: old text EDITED')
  })

  it('a table, a raw HTML block, and a code block all coexist with working node views', async () => {
    editor = mount(
      '<!-- note -->\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst x = 1\n```'
    )
    await nextTick()
    const el = editor.view.dom
    expect(el.querySelector('.raw-markdown-block')).not.toBeNull()
    expect(el.querySelector('table')).not.toBeNull()
    expect(el.querySelector('pre.code-editor-theme')).not.toBeNull()
  })
})
