/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { buildDecorations, changeTouchesCodeBlock } from './code-highlight'
import { createMarkdownContentExtensions } from './extensions'

let editor: Editor | null = null

/** Position just inside the first code block in the current editor doc. */
function codeBlockPos(ed: Editor): number {
  let pos = -1
  ed.state.doc.descendants((node, p) => {
    if (pos === -1 && node.type.name === 'codeBlock') pos = p
    return pos === -1
  })
  if (pos === -1) throw new Error('no code block')
  return pos
}

function decorationClassesFor(markdown: string): string[] {
  editor = new Editor({ extensions: createMarkdownContentExtensions() })
  editor.commands.setContent(markdown, { contentType: 'markdown' })
  const decorations = buildDecorations(editor.state.doc).find()
  editor.destroy()
  editor = null
  return decorations.map(
    (decoration) =>
      (decoration as unknown as { type: { attrs: { class: string } } }).type.attrs.class
  )
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('code block syntax highlighting', () => {
  it('emits Prism token decorations for a known language', () => {
    const classes = decorationClassesFor('```js\nconst x = 1\n```')
    expect(classes.length).toBeGreaterThan(0)
    expect(classes.every((c) => c.startsWith('token'))).toBe(true)
    expect(classes.some((c) => c.includes('keyword'))).toBe(true)
  })

  it('does not decorate plain prose', () => {
    expect(decorationClassesFor('just some text')).toHaveLength(0)
  })

  it('does not decorate an unregistered language', () => {
    expect(decorationClassesFor('```unregistered-lang\n+++ foo\n```')).toHaveLength(0)
  })
})

describe('changeTouchesCodeBlock (incremental re-tokenization gate)', () => {
  function mount(markdown: string): Editor {
    editor = new Editor({ extensions: createMarkdownContentExtensions() })
    editor.commands.setContent(markdown, { contentType: 'markdown' })
    return editor
  }

  it('is false when an edit lands only in prose (decorations are mapped, not rebuilt)', () => {
    const ed = mount('intro text\n\n```js\nconst x = 1\n```')
    const tr = ed.state.tr.insertText('Z', 1) // inside the leading paragraph
    expect(changeTouchesCodeBlock(tr, tr.doc)).toBe(false)
  })

  it('is true when an edit lands inside a code block (forces a re-tokenize)', () => {
    const ed = mount('intro\n\n```js\nconst x = 1\n```')
    const tr = ed.state.tr.insertText('y', codeBlockPos(ed) + 1)
    expect(changeTouchesCodeBlock(tr, tr.doc)).toBe(true)
  })

  it('is true when the code block language changes via setNodeMarkup', () => {
    const ed = mount('```js\nconst x = 1\n```')
    const pos = codeBlockPos(ed)
    const tr = ed.state.tr.setNodeMarkup(pos, undefined, { language: 'python' })
    expect(changeTouchesCodeBlock(tr, tr.doc)).toBe(true)
  })
})
