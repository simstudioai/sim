/**
 * @vitest-environment jsdom
 */
import { Editor, type JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import { postProcessSerializedMarkdown } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import { parseMarkdownToDoc } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'

describe('Markdown serialization boundaries', () => {
  it.each([
    '<pre>[https://example.com](https://example.com)</pre>\n',
    '<details>\n> \\[!NOTE\\]\nparent\n  - \n</details>\n',
    '````\n```\n- \n```\n````\n',
    '> \\[!NOTE\\]\n> quoted source\n',
  ])('does not rewrite syntax in assembled output: %s', (source) => {
    expect(postProcessSerializedMarkdown(source)).toBe(source)
  })

  it('normalizes only the final separator', () => {
    expect(postProcessSerializedMarkdown('\nfirst\n\n\n\nsecond\n\n\n')).toBe(
      '\nfirst\n\n\n\nsecond\n'
    )
  })

  it.each(['bulletList', 'orderedList', 'taskList'])(
    'preserves empty nested %s items and their siblings across reload',
    (listType) => {
      const itemType = listType === 'taskList' ? 'taskItem' : 'listItem'
      const paragraph = (text = ''): JSONContent => ({
        type: 'paragraph',
        content: text ? [{ type: 'text', text }] : [],
      })
      const item = (content: JSONContent[]): JSONContent => ({ type: itemType, content })
      const editor = new Editor({
        extensions: createMarkdownContentExtensions(),
        content: {
          type: 'doc',
          content: [
            {
              type: listType,
              content: [
                item([
                  paragraph('Parent'),
                  { type: listType, content: [item([paragraph()]), item([paragraph('Child')])] },
                ]),
              ],
            },
          ],
        },
      })
      try {
        editor.commands.setContent(editor.getJSON())
        const before = editor.getJSON().content?.[0]
        const saved = postProcessSerializedMarkdown(editor.getMarkdown())
        editor.commands.setContent(parseMarkdownToDoc(saved))
        expect(editor.getJSON().content?.[0]).toEqual(before)
        expect(postProcessSerializedMarkdown(editor.getMarkdown())).toBe(saved)
      } finally {
        editor.destroy()
      }
    }
  )
})
