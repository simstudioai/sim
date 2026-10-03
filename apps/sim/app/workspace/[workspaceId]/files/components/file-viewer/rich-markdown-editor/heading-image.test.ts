/** @vitest-environment jsdom */
import { Editor, getSchema } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
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
import { ImageUploadPlaceholders } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-upload'
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

  it.each(['image', 'inlineImage'])('omits unsafe %s links from copied HTML', (type) => {
    const node = schema.nodes[type].create({ src: '/logo.png', href: 'javascript:alert(1)' })
    const container = document.createElement('div')
    container.append(DOMSerializer.fromSchema(schema).serializeNode(node))
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/logo.png')
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
})
