/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from './extensions'
import { findHeadingPos } from './heading-anchors'

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

/** A ProseMirror doc parsed from markdown, for the position-resolution tests. */
function docOf(markdown: string) {
  editor = new Editor({ extensions: createMarkdownContentExtensions() })
  editor.commands.setContent(markdown, { contentType: 'markdown' })
  return editor.state.doc
}

describe('findHeadingPos', () => {
  it('disambiguates duplicate slugs GitHub-style (foo, foo-1, foo-2)', () => {
    const doc = docOf('# Notes\n\na\n\n# Notes\n\nb\n\n# Notes\n\nc')
    const first = findHeadingPos(doc, 'notes')
    const second = findHeadingPos(doc, 'notes-1')
    const third = findHeadingPos(doc, 'notes-2')
    expect(first).toBeGreaterThanOrEqual(0)
    expect(second).toBeGreaterThan(first)
    expect(third).toBeGreaterThan(second)
  })
})
