/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMarkdownEditorExtensions } from '../editor-extensions'

// jsdom lacks elementFromPoint, which TipTap's Placeholder viewport tracking calls on mount.
beforeAll(() => {
  document.elementFromPoint = vi.fn(() => null)
})

let editor: Editor | null = null

function editorWith(content: string, embeds = true): Editor {
  editor = new Editor({
    extensions: createMarkdownEditorExtensions({ placeholder: '', embeds }),
    content,
  })
  return editor
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

const YOUTUBE_LINK = '<p><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">watch</a></p>'

describe('LinkEmbed', () => {
  it('keeps the underlying document a plain markdown link (lossless round-trip)', () => {
    const markdown = editorWith(YOUTUBE_LINK).getMarkdown()
    expect(markdown).toContain('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(markdown).not.toContain('<iframe')
  })
})
