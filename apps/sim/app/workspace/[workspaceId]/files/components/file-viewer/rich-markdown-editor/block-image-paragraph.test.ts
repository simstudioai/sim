/** @vitest-environment jsdom */
import { getSchema, type JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { splitBlockImageParagraph } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/block-image-paragraph'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import {
  parseMarkdownToDoc,
  serializeMarkdownBody,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'

const schema = getSchema(createMarkdownContentExtensions())

describe('block images within Markdown paragraphs', () => {
  it('retains a whitespace-only code span beside an image', () => {
    const paragraph: JSONContent = {
      type: 'paragraph',
      content: [
        { type: 'image', attrs: { src: '/image.png' } },
        { type: 'text', text: '   ', marks: [{ type: 'code' }] },
      ],
    }
    expect(splitBlockImageParagraph(paragraph)).toEqual([
      {
        ...paragraph,
        content: [{ type: 'inlineImage', attrs: { src: '/image.png' } }, paragraph.content![1]],
      },
    ])
  })

  it('does not mutate parsed nodes or trim meaningful code-span whitespace', () => {
    const paragraph: JSONContent = {
      type: 'paragraph',
      content: [
        { type: 'text', text: ' Before ', marks: [{ type: 'bold' }] },
        { type: 'image', attrs: { src: 'https://example.test/a.png' } },
        { type: 'text', text: '   ' },
        { type: 'text', text: ' code ', marks: [{ type: 'code' }] },
        { type: 'text', text: '   ' },
      ],
    }
    const original = structuredClone(paragraph)
    const blocks = splitBlockImageParagraph(paragraph)
    expect(paragraph).toEqual(original)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].content).toEqual(
      paragraph.content?.map((child) =>
        child.type === 'image' ? { ...child, type: 'inlineImage' } : child
      )
    )
  })

  it('preserves source order, text marks, and linked image dimensions and titles', () => {
    const markdown =
      '**Before** [<img src="https://example.test/sized.png" alt="Sized preview" width="320" height="180" title="Image title">](https://example.test/target "Link title") *after* ![Second](https://example.test/second.png) ` done `'
    const root = schema.nodeFromJSON(parseMarkdownToDoc(markdown))
    expect(root.childCount).toBe(1)
    const doc = root.child(0)
    expect(() => doc.check()).not.toThrow()
    expect(
      Array.from({ length: doc.childCount }, (_, index) => doc.child(index).type.name)
    ).toEqual([
      'text',
      'text',
      'inlineImage',
      'text',
      'text',
      'text',
      'inlineImage',
      'text',
      'text',
    ])
    expect(doc.child(0).textContent).toBe('Before')
    expect(doc.child(0).marks.map((mark) => mark.type.name)).toEqual(['bold'])
    expect(doc.child(2).attrs).toMatchObject({
      src: 'https://example.test/sized.png',
      alt: 'Sized preview',
      width: '320',
      height: '180',
      title: 'Image title',
      href: 'https://example.test/target',
      hrefTitle: 'Link title',
    })
    expect(doc.child(4).textContent).toBe('after')
    expect(doc.child(4).marks.map((mark) => mark.type.name)).toEqual(['italic'])
    expect(doc.child(6).attrs.src).toBe('https://example.test/second.png')
    expect(doc.child(8).textContent).toBe('done')
    expect(doc.child(8).marks.map((mark) => mark.type.name)).toEqual(['code'])
    const serialized = serializeMarkdownBody(markdown)
    expect(schema.nodeFromJSON(parseMarkdownToDoc(serialized)).toJSON()).toEqual(root.toJSON())
    expect(serializeMarkdownBody(serialized)).toBe(serialized)
  })
})
