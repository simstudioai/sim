/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import { scrollToHeading } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/heading-anchors'

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

function editorOf(markdown: string) {
  editor = new Editor({ extensions: createMarkdownContentExtensions() })
  editor.commands.setContent(markdown, { contentType: 'markdown' })
  return editor
}

describe('Markdown heading navigation', () => {
  it.each([
    ['Unicode headings', '# Café 你好', 'café-你好', 0],
    ['punctuation spacing', '# Network & data', 'network--data', 0],
    ['existing suffixes', '# Notes\n\n# Notes-1\n\n# Notes', 'notes-2', 2],
  ] as const)('scrolls to GitHub fragments for %s', (_name, markdown, slug, index) => {
    const editor = editorOf(markdown)
    const headings = editor.view.dom.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')
    let scrolledTo: HTMLElement | null = null
    for (const heading of headings) {
      heading.scrollIntoView = () => {
        scrolledTo = heading
      }
    }
    expect(scrollToHeading(editor.view, `#${encodeURIComponent(slug)}`)).toBe(true)
    expect(scrolledTo).toBe(headings[index])
  })

  it('scrolls to duplicate headings in document order', () => {
    const editor = editorOf('# Notes\n\na\n\n# Notes\n\nb\n\n# Notes\n\nc')
    const headings = editor.view.dom.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')
    let scrolledTo: HTMLElement | null = null
    for (const heading of headings) {
      heading.scrollIntoView = () => {
        scrolledTo = heading
      }
    }
    for (const [index, fragment] of ['#notes', '#notes-1', '#notes-2'].entries()) {
      expect(scrollToHeading(editor.view, fragment)).toBe(true)
      expect(scrolledTo).toBe(headings[index])
    }
  })
})
