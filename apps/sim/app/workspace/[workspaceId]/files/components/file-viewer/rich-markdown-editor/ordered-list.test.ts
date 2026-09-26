/** @vitest-environment jsdom */
import { Editor, type JSONContent } from '@tiptap/core'
import { OrderedList } from '@tiptap/extension-list'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import {
  editorNormalForm,
  parseMarkdownToDoc,
  serializeMarkdownDocument,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'

const editors: Editor[] = []

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
})

function mount(content: string | JSONContent = '<p></p>', stock = false): Editor {
  const extensions = createMarkdownContentExtensions().map((extension) =>
    stock && extension.name === 'orderedList' ? OrderedList : extension
  )
  const editor = new Editor({ extensions, content })
  editors.push(editor)
  return editor
}

function starts(doc: JSONContent): number[] {
  const result: number[] = []
  const visit = (node: JSONContent): void => {
    if (node.type === 'orderedList') result.push(node.attrs?.start ?? 1)
    node.content?.forEach(visit)
  }
  visit(doc)
  return result
}

const LIST_RUN =
  '<ol><li><p><strong>first</strong></p></li></ol><ol start="7"><li><p>restart</p></li></ol><ol start="3"><li><p>another</p></li></ol>'

describe('ordered-list Markdown boundaries', () => {
  it.each([
    ['top-level', LIST_RUN],
    ['nested', `<ul><li><p>parent</p>${LIST_RUN}</li></ul>`],
    ['blockquote', `<blockquote>${LIST_RUN}</blockquote>`],
  ])('preserves three adjacent %s lists across repeated saves', (_name, html) => {
    const editor = mount(html)
    editor.commands.setContent(editor.getJSON())
    const original = editor.getJSON()
    const markdown = editor.getMarkdown()
    expect(starts(original)).toEqual([1, 7, 3])
    expect(markdown).toContain('7) restart')

    for (let cycle = 0; cycle < 3; cycle++) {
      editor.commands.setContent(editorNormalForm(editor.getMarkdown()))
      expect(editor.getJSON()).toEqual(original)
      expect(editor.getMarkdown()).toBe(markdown)
    }
  })

  it.each([
    '1. first\n\n7) restart\n\n3. another',
    '- parent\n  1. first\n  7) restart\n  3. another',
    '1. outer\n  4. child\n  7) child restart\n2. other',
    '> 1. first\n>\n> 7) restart\n>\n> 3. another',
  ])('preserves delimiter boundaries on first parse: %s', (markdown) => {
    const editor = mount()
    editor.commands.setContent(markdown, { contentType: 'markdown' })
    const original = editor.getJSON()
    const expected = markdown.startsWith('1. outer') ? [1, 4, 7] : [1, 7, 3]
    expect(starts(original)).toEqual(expected)
    expect(starts(parseMarkdownToDoc(markdown))).toEqual(expected)
    expect(starts(parseMarkdownToDoc(`${markdown}\n\n<!-- retained -->`))).toEqual(expected)
    expect(serializeMarkdownDocument(serializeMarkdownDocument(markdown))).toBe(
      serializeMarkdownDocument(markdown)
    )
  })

  it('preserves an ordered restart when references require whole-document parsing', () => {
    const markdown =
      '1. [first](https://example.com)\n\n7) restart\n\nOutside [reference][ref].\n\n[ref]: https://example.com'
    const original = parseMarkdownToDoc(markdown)
    expect(starts(original)).toEqual([1, 7])
    const editor = mount(editorNormalForm(markdown))
    const normalized = editor.getJSON()
    editor.commands.setContent(editorNormalForm(editor.getMarkdown()))
    expect(editor.getJSON()).toEqual(normalized)
    expect(editor.getMarkdown()).toContain('[first](https://example.com)')
    expect(editor.getMarkdown()).toContain('[reference](https://example.com)')
  })

  it('changes only item prefixes, not marker-shaped text inside multiline code', () => {
    const editor = mount({
      type: 'doc',
      content: [
        { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
        {
          type: 'orderedList',
          attrs: { start: 7 },
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'prefix\n9. literal', marks: [{ type: 'code' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
    expect(editor.getMarkdown()).toContain('7) `prefix\n9. literal`')
  })
})
