/**
 * @vitest-environment jsdom
 *
 * The rich editor uses TipTap's initial-content model: opening a file loads its markdown as the
 * editor's initial `content`, which must NOT emit an update — so a freshly opened file is never
 * marked dirty (no spurious autosave / "unsaved changes"). Only a genuine edit emits, which is what
 * flips the dirty/autosave state on. These two cases guard exactly that contract.
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from './extensions'

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

function mount(content: string, onUpdate: () => void): Editor {
  return new Editor({
    extensions: createMarkdownContentExtensions(),
    content,
    contentType: 'markdown',
    onUpdate,
  })
}

describe('rich markdown editor — dirty signal', () => {
  it('opening a file emits no update (never dirty on open), including markdown that normalizes', () => {
    // A trailing newline and `_emphasis_` both normalize on serialization; opening must still be clean.
    let updates = 0
    editor = mount('# Title\n\nsome _emphasis_ here\n', () => {
      updates++
    })
    expect(updates).toBe(0)
    expect(editor.isEmpty).toBe(false)
  })

  it('opening an empty file emits no update and is editable', () => {
    let updates = 0
    editor = mount('', () => {
      updates++
    })
    expect(updates).toBe(0)
  })

  it('a genuine edit emits an update (marks dirty → triggers autosave)', () => {
    let updates = 0
    editor = mount('hello', () => {
      updates++
    })
    editor.commands.insertContent(' world')
    expect(updates).toBeGreaterThan(0)
  })
})
