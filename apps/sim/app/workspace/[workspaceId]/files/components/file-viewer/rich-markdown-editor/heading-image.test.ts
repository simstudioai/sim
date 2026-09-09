/** @vitest-environment jsdom */
import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import { Editor, getSchema } from '@tiptap/core'
import { DOMParser, DOMSerializer } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { markdownToYDoc, yDocToFileMarkdown, yDocToMarkdown } from '@/lib/collab-doc/converter'
import {
  applyAgentStreamFrame,
  beginAgentStream,
  endAgentStream,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/apply-streamed-markdown'
import { FileCollaboration } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/file-collaboration'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import { dispatchEditorDrop } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-drop.test-helpers'
import { isImageNode } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-node'
import {
  beginImageUploads,
  finishImageUpload,
  ImageUploadPlaceholders,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-upload'
import { splitFrontmatter } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import {
  editorNormalForm,
  parseMarkdownToDoc,
  serializeMarkdownBody,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'
import { isRoundTripSafe } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/round-trip-safety'

const IMAGE = '![Logo](/logo.png "Title")'
const CASES = [
  ...[1, 2, 3, 4, 5, 6].map((level) => `${'#'.repeat(level)} Before ${IMAGE} after`),
  `# ${IMAGE}`,
  `# ${IMAGE} ${IMAGE}`,
  `# **Before** ${IMAGE} *after*`,
  '# Before <img src="/logo.png" alt="Logo" width="320" height="180"> after',
  `# [${IMAGE}](/destination "Link title")`,
  '# Before [<img src="/logo.png" alt="Logo" width="320">](/destination) after',
  '# Before ![Logo][logo] after\n\n[logo]: /logo.png "Title"',
  `Before ${IMAGE} after\n===`,
  `> # Before ${IMAGE} after`,
  `- # Before ${IMAGE} after`,
] as const
const schema = getSchema(createMarkdownContentExtensions())
const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

function peer(seed: Y.Doc) {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed))
  const editor = new Editor({
    extensions: [
      ...createMarkdownContentExtensions({}, { disableHistory: true }),
      ImageUploadPlaceholders,
      FileCollaboration.configure({ document: doc }),
    ],
    editorProps: { handleScrollToSelection: () => true },
  })
  cleanups.push(() => {
    editor.destroy()
    doc.destroy()
  })
  return { doc, editor }
}

function imagePositions(editor: Editor) {
  const positions: number[] = []
  editor.state.doc.descendants((node, position) => {
    if (isImageNode(node)) positions.push(position)
  })
  return positions
}

describe('heading images', () => {
  it.each(CASES)(
    'preserves heading structure through Markdown and collaboration: %s',
    (markdown) => {
      const parsed = schema.nodeFromJSON(parseMarkdownToDoc(markdown))
      expect(() => parsed.check()).not.toThrow()
      let images = 0
      parsed.descendants((node, _pos, parent) => {
        if (isImageNode(node)) {
          images++
          expect(node.type.name).toBe('inlineImage')
          expect(parent?.type.name).toBe('heading')
          expect(node.attrs.src).toBe('/logo.png')
        }
      })
      expect(images).toBeGreaterThan(0)
      expect(isRoundTripSafe(markdown)).toBe(true)
      const serialized = serializeMarkdownBody(markdown)
      expect(serializeMarkdownBody(serialized)).toBe(serialized)
      const seed = markdownToYDoc(markdown)
      const a = peer(seed)
      seed.destroy()
      expect(a.editor.getJSON()).toEqual(schema.nodeFromJSON(editorNormalForm(markdown)).toJSON())
      expect(imagePositions(a.editor)).toHaveLength(images)
      expect(yDocToMarkdown(a.doc)).toBe(serialized)
    }
  )

  it('retains existing block images and their attributes', () => {
    const doc = schema.nodeFromJSON(parseMarkdownToDoc(`# Heading ${IMAGE}\n\n${IMAGE}`))
    expect(doc.child(0).lastChild?.type.name).toBe('inlineImage')
    expect(doc.child(1).type.name).toBe('image')
    expect(doc.child(0).lastChild?.attrs).toEqual(doc.child(1).attrs)
  })

  it('keeps a mixed document editable without changing frontmatter, links, or image code examples', () => {
    const markdown = [
      '---\ntitle: Image support\n---',
      '# Heading ![Heading image](/logo.png)',
      '![Block image](/logo.png)',
      '[Ordinary link](/logo.png)',
      '`![Code example](/logo.png)`',
      '![Reference image][shared]',
      '[Ordinary reference][shared]',
      '[shared]: /logo.png',
    ].join('\n\n')
    expect(isRoundTripSafe(markdown)).toBe(true)
    const { frontmatter, body } = splitFrontmatter(markdown)
    const seed = markdownToYDoc(body)
    seed.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.frontmatterKey, frontmatter)
    const { doc, editor } = peer(seed)
    seed.destroy()
    expect(imagePositions(editor)).toHaveLength(3)
    editor.commands.insertContentAt(1, 'Edited ')
    const saved = yDocToFileMarkdown(doc)
    expect(saved).toContain('---\ntitle: Image support\n---')
    expect(saved).toContain('# Edited Heading ![Heading image](/logo.png)')
    expect(saved).toContain('[Ordinary link](/logo.png)')
    expect(saved).toContain('[Ordinary reference](/logo.png)')
    expect(saved).toContain('`![Code example](/logo.png)`')
    expect(isRoundTripSafe(saved)).toBe(true)
    const reopened = peer(doc)
    expect(reopened.editor.getJSON()).toEqual(editor.getJSON())
  })

  it('preserves copied heading HTML without introducing block elements inside it', () => {
    const container = document.createElement('div')
    container.innerHTML = '<h2>Before <img src="/logo.png" alt="Logo" width="320"> after</h2>'
    const doc = DOMParser.fromSchema(schema).parse(container)
    expect(() => doc.check()).not.toThrow()
    expect(doc.firstChild?.child(1).type.name).toBe('inlineImage')
    expect(doc.firstChild?.child(1).attrs.width).toBe('320')
  })

  it.each([
    ['<h2>Before <a href="/target"><img src="/logo.png"></a> after</h2>', 'heading', 'inlineImage'],
    ['<p>Before <a href="/target"><img src="/logo.png"></a> after</p>', 'paragraph', 'inlineImage'],
    ['<p><a href="/target"><img src="/logo.png"></a></p>', 'paragraph', 'image'],
  ])('keeps pasted image layout for %s', (html, parentType, imageType) => {
    const container = document.createElement('div')
    container.innerHTML = html
    const parsed = DOMParser.fromSchema(schema).parse(container)
    expect(() => parsed.check()).not.toThrow()
    expect(parsed.firstChild?.type.name).toBe(parentType)
    const images: string[] = []
    parsed.descendants((node) => {
      if (isImageNode(node)) images.push(node.type.name)
    })
    expect(images).toEqual([imageType])
    const editor = new Editor({
      extensions: createMarkdownContentExtensions(),
      content: parsed.toJSON(),
      editorProps: { handleScrollToSelection: () => true },
    })
    cleanups.push(() => editor.destroy())
    editor.commands.setNodeSelection(imagePositions(editor)[0])
    editor.commands.updateAttributes(imageType, { width: '360' })
    const saved = editor.getMarkdown()
    expect(saved).toContain('](/target)')
    const reopened = schema.nodeFromJSON(editorNormalForm(saved))
    reopened.descendants((node) => {
      if (isImageNode(node)) expect(node.attrs).toMatchObject({ href: '/target', width: '360' })
    })
  })

  it.each(['h2', 'p'])('preserves pasted linked images in %s across peers and reload', (tag) => {
    const seed = markdownToYDoc('Start')
    const a = peer(seed)
    const b = peer(seed)
    seed.destroy()
    a.editor.commands.selectAll()
    a.editor.view.pasteHTML(
      `<${tag}><a href="/target" title="Destination">Before <img src="/logo.png" alt="Logo" width="217"> after</a></${tag}>`,
      new Event('paste') as ClipboardEvent
    )
    const position = imagePositions(a.editor)[0]
    const pastedImage = a.editor.state.doc.nodeAt(position)
    expect(pastedImage?.attrs).toMatchObject({ href: '/target', hrefTitle: 'Destination' })
    expect(pastedImage?.marks.some((mark) => mark.type.name === 'link')).toBe(false)
    expect(a.editor.state.doc.firstChild?.firstChild?.marks[0]?.attrs.href).toBe('/target')
    a.editor.commands.setNodeSelection(position)
    a.editor.commands.updateAttributes('inlineImage', { width: '287' })
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc))
    expect(b.editor.getJSON()).toEqual(a.editor.getJSON())
    const saved = yDocToFileMarkdown(b.doc)
    expect(saved).toContain('](/target "Destination")')
    expect(isRoundTripSafe(saved)).toBe(true)
    const reopened = peer(b.doc)
    expect(reopened.editor.getJSON()).toEqual(b.editor.getJSON())
    expect(
      reopened.editor.state.doc.nodeAt(imagePositions(reopened.editor)[0])?.attrs
    ).toMatchObject({
      href: '/target',
      hrefTitle: 'Destination',
      width: '287',
    })
  })

  it.each(['', '# Before ', 'Before '])(
    'keeps linked image metadata through the HTML clipboard: %s',
    (prefix) => {
      const seed = markdownToYDoc(
        `${prefix}[<img src="/logo.png" alt="Logo" width="287">](/target "Destination")`
      )
      const a = peer(seed)
      seed.destroy()
      a.editor.commands.setNodeSelection(imagePositions(a.editor)[0])
      const clipboard = a.editor.view.serializeForClipboard(a.editor.state.selection.content())
      expect(clipboard.dom.querySelector('a')?.getAttribute('href')).toBe('/target')
      expect(clipboard.dom.querySelector('a')?.getAttribute('title')).toBe('Destination')
      const targetSeed = markdownToYDoc(prefix ? '# Target' : 'Target')
      const target = peer(targetSeed)
      targetSeed.destroy()
      target.editor.commands.setTextSelection(1)
      target.editor.view.pasteHTML(clipboard.dom.innerHTML, new Event('paste') as ClipboardEvent)
      expect(target.editor.state.doc.nodeAt(imagePositions(target.editor)[0])?.attrs).toMatchObject(
        {
          href: '/target',
          hrefTitle: 'Destination',
          width: '287',
          alt: 'Logo',
        }
      )
      const reopened = peer(target.doc)
      expect(reopened.editor.getJSON()).toEqual(target.editor.getJSON())
    }
  )

  it.each(['image', 'inlineImage'])('omits unsafe %s links from copied HTML', (type) => {
    const node = schema.nodes[type].create({ src: '/logo.png', href: 'javascript:alert(1)' })
    const container = document.createElement('div')
    container.append(DOMSerializer.fromSchema(schema).serializeNode(node))
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/logo.png')
  })

  it('does not nest a stored image link inside an existing link mark', () => {
    const node = schema.nodes.inlineImage.create({ src: '/logo.png', href: '/stored' }, null, [
      schema.marks.link.create({ href: '/current' }),
    ])
    const container = document.createElement('div')
    container.append(DOMSerializer.fromSchema(schema).serializeNode(node))
    expect(container.querySelectorAll('a')).toHaveLength(1)
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/current')
  })

  it('streams partial heading images to a peer without duplicating content or recording user undo', () => {
    const seed = markdownToYDoc('# Start')
    const a = peer(seed)
    const b = peer(seed)
    seed.destroy()
    const session = beginAgentStream(a.editor)
    expect(session).not.toBeNull()
    try {
      for (const frame of [
        '# Before ![Logo](',
        '# Before ![Logo](/logo.png)',
        `# Before ${IMAGE} after`,
      ]) {
        expect(applyAgentStreamFrame(a.editor, session!, frame)).toBe(true)
        Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc))
        expect(() => b.editor.state.doc.check()).not.toThrow()
        expect(b.editor.getJSON()).toEqual(a.editor.getJSON())
      }
      expect(imagePositions(b.editor)).toHaveLength(1)
      expect(yDocToFileMarkdown(b.doc)).toBe(`# Before ${IMAGE} after\n`)
      expect(a.editor.can().undo()).toBe(false)
    } finally {
      endAgentStream(session!)
    }
  })

  it('retains heading images when converting to a paragraph and back', () => {
    const seed = markdownToYDoc(`# Before ${IMAGE} after`)
    const { editor } = peer(seed)
    seed.destroy()
    editor.commands.setTextSelection(1)
    expect(editor.commands.setParagraph()).toBe(true)
    const paragraph = editor.getMarkdown()
    expect(isRoundTripSafe(paragraph)).toBe(true)
    const reopened = schema.nodeFromJSON(editorNormalForm(paragraph))
    expect(reopened.firstChild?.type.name).toBe('paragraph')
    expect(reopened.firstChild?.child(1).attrs.src).toBe('/logo.png')
    expect(editor.commands.setHeading({ level: 2 })).toBe(true)
    expect(imagePositions(editor)).toHaveLength(1)
  })

  it('merges concurrent text and resize edits, including undo and fresh hydration', () => {
    const seed = markdownToYDoc(`# Before ${IMAGE} after`)
    const a = peer(seed)
    const b = peer(seed)
    seed.destroy()
    a.editor.commands.setNodeSelection(imagePositions(a.editor)[0])
    a.editor.commands.updateAttributes('inlineImage', { width: '320', height: null })
    b.editor.commands.insertContentAt(1, 'Peer ')
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc))
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc))
    expect(a.editor.getJSON()).toEqual(b.editor.getJSON())
    expect(a.editor.state.doc.textContent).toContain('Peer Before')
    expect(yDocToMarkdown(a.doc)).toContain('width="320"')
    expect(isRoundTripSafe(yDocToMarkdown(a.doc))).toBe(true)
    a.editor.commands.undo()
    expect(a.editor.state.doc.textContent).toContain('Peer Before')
    expect(a.editor.state.doc.nodeAt(imagePositions(a.editor)[0])?.attrs.width).toBeNull()
    a.editor.commands.redo()
    const reopened = peer(a.doc)
    expect(reopened.editor.getJSON()).toEqual(a.editor.getJSON())
    expect(imagePositions(reopened.editor)).toHaveLength(1)
  })

  it.each(['# ', ''])(
    'preserves a block-to-inline move, peer text, and undo through collaboration: %s',
    (prefix) => {
      const seed = markdownToYDoc(
        `${prefix}Before after\n\n[<img src="/logo.png" alt="Logo" width="287">](/target "Destination")\n\nPeer text`
      )
      const a = peer(seed)
      const b = peer(seed)
      seed.destroy()
      const originalAttrs = a.editor.state.doc.nodeAt(imagePositions(a.editor)[0])?.attrs
      a.editor.commands.setNodeSelection(imagePositions(a.editor)[0])
      expect(dispatchEditorDrop(a.editor, 8).defaultPrevented).toBe(true)
      expect(a.editor.state.doc.nodeAt(8)?.type.name).toBe('inlineImage')
      expect(a.editor.state.doc.nodeAt(8)?.attrs).toEqual(originalAttrs)
      b.editor.commands.insertContentAt(b.editor.state.doc.content.size - 1, ' preserved')
      Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc))
      Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc))
      expect(a.editor.getJSON()).toEqual(b.editor.getJSON())
      expect(imagePositions(b.editor)).toHaveLength(1)
      expect(a.editor.commands.undo()).toBe(true)
      if (a.editor.state.selection instanceof NodeSelection) {
        expect(NodeSelection.isSelectable(a.editor.state.selection.node)).toBe(true)
      }
      expect(a.editor.state.doc.textContent).toContain('Peer text preserved')
      expect(a.editor.state.doc.nodeAt(imagePositions(a.editor)[0])?.type.name).toBe('image')
      expect(a.editor.commands.redo()).toBe(true)
      Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc))
      expect(a.editor.getJSON()).toEqual(b.editor.getJSON())
      const reopened = peer(b.doc)
      expect(reopened.editor.getJSON()).toEqual(a.editor.getJSON())
      expect(reopened.editor.state.doc.nodeAt(8)?.attrs).toEqual(originalAttrs)
      expect(isRoundTripSafe(yDocToFileMarkdown(b.doc))).toBe(true)
    }
  )

  it('inserts uploaded images into the heading without splitting its text', () => {
    const seed = markdownToYDoc('# Before after')
    const { editor } = peer(seed)
    seed.destroy()
    const [id] = beginImageUploads(editor, { from: 8, to: 8 }, ['Logo'])
    expect(finishImageUpload(editor, id, '/logo.png', 'Logo')).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).toBe('heading')
    expect(editor.state.doc.firstChild?.child(1).type.name).toBe('inlineImage')
    expect(editor.state.doc.firstChild?.textContent).toBe('Before after')
  })
})
