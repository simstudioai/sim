/** @vitest-environment jsdom */
import { Editor, getSchema, type JSONContent } from '@tiptap/core'
import { Collaboration } from '@tiptap/extension-collaboration'
import { afterEach, describe, expect, it } from 'vitest'
import { markdownToYDoc, yDocToMarkdown } from '@/lib/collab-doc/converter'
import { splitBlockImageParagraph } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/block-image-paragraph'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import {
  editorNormalForm,
  parseMarkdownToDoc,
  serializeMarkdownBody,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'
import { isRoundTripSafe } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/round-trip-safety'

const IMAGE = '![Preview](https://example.test/image.png "Image title")'
const MIXED = `Before ${IMAGE} after`
const CASES = [
  ['text before', `Before ${IMAGE}`],
  ['text after', `${IMAGE} after`],
  ['text on both sides', MIXED],
  ['multiple images', `${MIXED} ${IMAGE} final`],
  ['adjacent images', `${IMAGE} ${IMAGE}`],
  ['bold and italic', `**Before** ${IMAGE} *after*`],
  ['marks spanning an image', `**${MIXED}**`],
  ['bullet list', `- ${MIXED}\n- Following`],
  ['image-first bullet', `- ${IMAGE} after\n- Following`],
  ['ordered list', `7. ${MIXED}\n8. Following`],
  ['task list', `- [x] ${MIXED}\n- [ ] Following`],
  ['image-first task', `- [x] ${IMAGE} after\n- [ ] Following`],
  ['nested list', `- Parent\n  - ${MIXED}\n- Following`],
  ['blockquote', `> ${MIXED}`],
] as const

const schema = getSchema(createMarkdownContentExtensions())
const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

describe('block images within Markdown paragraphs', () => {
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
    expect(blocks[0].content).toEqual([{ type: 'text', text: 'Before', marks: [{ type: 'bold' }] }])
    expect(blocks[1]).toBe(paragraph.content?.[1])
    expect(blocks[2].content).toEqual([{ type: 'text', text: ' code ', marks: [{ type: 'code' }] }])
  })

  it('preserves source order, text marks, and linked image dimensions and titles', () => {
    const markdown =
      '**Before** [<img src="https://example.test/sized.png" alt="Sized preview" width="320" height="180" title="Image title">](https://example.test/target "Link title") *after* ![Second](https://example.test/second.png) ` done `'
    const doc = schema.nodeFromJSON(parseMarkdownToDoc(markdown))
    expect(() => doc.check()).not.toThrow()
    expect(
      Array.from({ length: doc.childCount }, (_, index) => doc.child(index).type.name)
    ).toEqual(['paragraph', 'image', 'paragraph', 'image', 'paragraph'])
    expect(doc.child(0).textContent).toBe('Before')
    expect(doc.child(0).firstChild?.marks.map((mark) => mark.type.name)).toEqual(['bold'])
    expect(doc.child(1).attrs).toMatchObject({
      src: 'https://example.test/sized.png',
      alt: 'Sized preview',
      width: '320',
      height: '180',
      title: 'Image title',
      href: 'https://example.test/target',
      hrefTitle: 'Link title',
    })
    expect(doc.child(2).textContent).toBe('after')
    expect(doc.child(2).firstChild?.marks.map((mark) => mark.type.name)).toEqual(['italic'])
    expect(doc.child(3).attrs.src).toBe('https://example.test/second.png')
    expect(doc.child(4).textContent).toBe('done')
    expect(doc.child(4).firstChild?.marks.map((mark) => mark.type.name)).toEqual(['code'])
    const serialized = serializeMarkdownBody(markdown)
    expect(schema.nodeFromJSON(parseMarkdownToDoc(serialized)).toJSON()).toEqual(doc.toJSON())
    expect(serializeMarkdownBody(serialized)).toBe(serialized)
  })

  it.each(CASES)('keeps %s schema-valid and stable through save and reopen', (_label, markdown) => {
    const parsed = schema.nodeFromJSON(parseMarkdownToDoc(markdown))
    expect(() => parsed.check()).not.toThrow()
    const serialized = serializeMarkdownBody(markdown)
    const reparsed = schema.nodeFromJSON(parseMarkdownToDoc(serialized))
    expect(() => reparsed.check()).not.toThrow()
    expect(reparsed.toJSON()).toEqual(parsed.toJSON())
    expect(serializeMarkdownBody(serialized)).toBe(serialized)
    expect(isRoundTripSafe(markdown)).toBe(true)
  })

  it.each(CASES)('retains %s through collaborative hydration', (_label, markdown) => {
    const doc = markdownToYDoc(markdown)
    const editor = new Editor({
      extensions: [
        ...createMarkdownContentExtensions({}, { disableHistory: true }),
        Collaboration.configure({ document: doc }),
      ],
    })
    cleanups.push(() => {
      editor.destroy()
      doc.destroy()
    })
    expect(() => editor.state.doc.check()).not.toThrow()
    expect(editor.getJSON()).toEqual(schema.nodeFromJSON(editorNormalForm(markdown)).toJSON())
    expect(yDocToMarkdown(doc)).toBe(serializeMarkdownBody(markdown))
  })
})
