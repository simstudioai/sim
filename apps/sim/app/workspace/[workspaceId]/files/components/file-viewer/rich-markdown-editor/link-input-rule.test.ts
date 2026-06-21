/**
 * @vitest-environment jsdom
 *
 * Typing a markdown link `[text](url)` should convert to a real link mark on the closing `)`.
 * Input rules only fire on real text input, so these drive the editor's `handleTextInput` path
 * (NOT `insertContent`, which bypasses input rules).
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from './extensions'

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

function mount(): Editor {
  return new Editor({ extensions: createMarkdownContentExtensions() })
}

/** Type `prefix` (no input rules), then simulate typing the final char so the input rule fires. */
function typeWithFinalChar(ed: Editor, prefix: string, finalChar: string): boolean {
  ed.commands.setContent('', { contentType: 'markdown' })
  ed.commands.insertContent(prefix)
  const pos = ed.state.selection.from
  return ed.view.someProp('handleTextInput', (fn) => fn(ed.view, pos, pos, finalChar)) === true
}

describe('typed markdown link input rule', () => {
  it('converts [text](url) to a link mark on the closing paren', () => {
    editor = mount()
    typeWithFinalChar(editor, '[hi](https://example.com', ')')
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"type":"link"')
    expect(json).toContain('"href":"https://example.com"')
    expect(editor.getText()).toBe('hi')
  })

  it('normalizes a bare domain to https (parity with paste)', () => {
    editor = mount()
    typeWithFinalChar(editor, '[site](www.example.com', ')')
    expect(JSON.stringify(editor.getJSON())).toContain('"href":"https://www.example.com"')
  })

  it('preserves a link title', () => {
    editor = mount()
    typeWithFinalChar(editor, '[t](https://e.com "the title"', ')')
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"href":"https://e.com"')
    expect(json).toContain('"title":"the title"')
  })

  it('refuses an unsafe scheme (leaves it literal)', () => {
    editor = mount()
    typeWithFinalChar(editor, '[x](javascript:alert(1)', ')')
    expect(JSON.stringify(editor.getJSON())).not.toContain('"type":"link"')
  })

  it('does not fire inside a code block', () => {
    editor = mount()
    editor.commands.setContent('```\n\n```', { contentType: 'markdown' })
    editor.commands.setTextSelection(2)
    const pos = editor.state.selection.from
    editor.commands.insertContent('[x](https://e.com')
    editor.view.someProp('handleTextInput', (fn) => fn(editor!.view, pos, pos, ')'))
    expect(JSON.stringify(editor.getJSON())).not.toContain('"type":"link"')
  })
})
