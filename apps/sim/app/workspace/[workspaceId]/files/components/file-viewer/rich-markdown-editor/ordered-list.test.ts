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
import { isRoundTripSafe } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/round-trip-safety'

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
  it.each([0, 9, 10, 123])('retains start %s and following item numbers', (start) => {
    const editor = mount(`<ol start="${start}"><li><p>one</p></li><li><p>two</p></li></ol>`)
    expect(editor.getMarkdown()).toContain(`${start}. one\n${start + 1}. two`)
    editor.commands.setContent(editorNormalForm(editor.getMarkdown()))
    expect(starts(editor.getJSON())).toEqual([start])
  })

  it.each(['a', 'A', 'i', 'I'])('retains stock %s list rendering and parsing', (type) => {
    const html = `<ol type="${type}" start="3"><li><p>one</p></li><li><p>two</p></li></ol>`
    const editor = mount(html)
    const original = mount(html, true)
    expect(editor.getMarkdown()).toBe(original.getMarkdown())
    const markdown = original.getMarkdown()
    editor.commands.setContent(markdown, { contentType: 'markdown' })
    original.commands.setContent(markdown, { contentType: 'markdown' })
    expect(editor.getJSON()).toEqual(original.getJSON())
  })

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

  it.each([
    '1. First\n  - sub bullet\n  - another\n  1. deep ordered\n  2. item\n2. Second',
    '1. first\n\n  second paragraph in item one\n\n2. second item',
    '1. outer\n  1. child\n    1. grandchild\n  2. another child\n2. other',
    '4. outer\n  a. alphabetic child\n  b. another child\n5. other',
  ])('retains stock first-parse semantics for legacy indentation: %s', (markdown) => {
    const editor = mount()
    const original = mount('<p></p>', true)
    editor.commands.setContent(markdown, { contentType: 'markdown' })
    original.commands.setContent(markdown, { contentType: 'markdown' })
    expect(editor.getJSON()).toEqual(original.getJSON())
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

  it.each([
    '1. [first][ref]',
    '1. [ref]',
    '1. [ref][]',
    '1. **[first][ref]**',
    '1. outer\n  1. [first][ref]',
    '1. outer\n\n  [first][ref]',
    '1. first\n\n7) [first][ref]',
    'a. [first][ref]',
    'iii. [first][ref]',
  ])('resolves ordered reference links with whole-document context: %s', (body) => {
    const markdown = `${body}\n\n[ref]: https://example.com "Title"`
    const editor = mount(editorNormalForm(markdown))
    const original = editor.getJSON()
    let linkCount = 0
    editor.state.doc.descendants((node) => {
      linkCount += node.marks.filter(
        (mark) => mark.type.name === 'link' && mark.attrs.href === 'https://example.com'
      ).length
    })
    expect(linkCount).toBe(1)
    expect(editor.getMarkdown()).toContain('(https://example.com "Title")')
    editor.commands.setContent(editorNormalForm(editor.getMarkdown()))
    expect(editor.getJSON()).toEqual(original)
    expect(isRoundTripSafe(markdown)).toBe(true)
  })

  it('resolves reference images without changing escaped or code reference syntax', () => {
    const markdown =
      '1. ![photo][img] and \\[ref] and `[ref]`\n\nOutside [ref].\n\n[img]: https://example.com/photo.png\n[ref]: https://example.com'
    const editor = mount(editorNormalForm(markdown))
    const original = editor.getJSON()
    let imageSource: string | undefined
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'image' || node.type.name === 'inlineImage')
        imageSource = node.attrs.src
    })
    expect(imageSource).toBe('https://example.com/photo.png')
    expect(editor.getMarkdown()).toContain('\\[ref\\] and `[ref]`')
    editor.commands.setContent(editorNormalForm(editor.getMarkdown()))
    expect(editor.getJSON()).toEqual(original)
    expect(isRoundTripSafe(markdown)).toBe(true)
  })

  it.each([
    ['blockquote', '1. outer\n\n  > [first][ref]', true],
    ['table', '1. outer\n\n  | Header |\n  | --- |\n  | [first][ref] |', false],
  ] as const)(
    'preserves nested %s references and verifies edit eligibility',
    (type, body, editable) => {
      const markdown = `${body}\n\n[ref]: https://example.com "Title"`
      const editor = mount(editorNormalForm(markdown))
      const original = editor.getJSON()
      let found = false
      let linkCount = 0
      editor.state.doc.descendants((node) => {
        if (node.type.name === type) found = true
        linkCount += node.marks.filter(
          (mark) => mark.type.name === 'link' && mark.attrs.href === 'https://example.com'
        ).length
      })
      expect(found).toBe(true)
      expect(linkCount).toBe(1)
      expect(isRoundTripSafe(markdown)).toBe(editable)
      if (!editable) {
        const once = serializeMarkdownDocument(markdown)
        expect(serializeMarkdownDocument(once)).not.toBe(once)
        return
      }
      editor.commands.setContent(editorNormalForm(editor.getMarkdown()))
      expect(editor.getJSON()).toEqual(original)
    }
  )

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
