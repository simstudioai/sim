/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { changeTouchesCodeBlock } from './code-highlight'
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

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('changeTouchesCodeBlock (incremental re-tokenization gate)', () => {
  function mount(markdown: string): Editor {
    editor = new Editor({ extensions: createMarkdownContentExtensions() })
    editor.commands.setContent(markdown, { contentType: 'markdown' })
    return editor
  }

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
