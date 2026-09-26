/** @vitest-environment jsdom */
import { act } from 'react'
import { NodeSelection } from '@tiptap/pm/state'
import { Editor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { BlockMover } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/block-mover'
import { FileCollaboration } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/file-collaboration'
import {
  ResizableImage,
  ResizableInlineImage,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image'
import { dispatchEditorDrop } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-drop.test-helpers'
import { isImageNode } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-node'

let host: HTMLDivElement
let root: Root
let local: Editor
let peer: Editor
let localDoc: Y.Doc
let peerDoc: Y.Doc

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  localDoc = new Y.Doc()
  peerDoc = new Y.Doc()
  const createEditor = (document: Y.Doc) =>
    new Editor({
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        BlockMover,
        ResizableImage,
        ResizableInlineImage,
        FileCollaboration.configure({ document }),
      ],
      editorProps: { handleScrollToSelection: () => true },
    })
  local = createEditor(localDoc)
  local.commands.setContent(
    '<h2>Earlier heading</h2><img src="https://sim.ai/image.png" alt="Original" width="200" height="100"><p>After image</p>'
  )
  Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc))
  peer = createEditor(peerDoc)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.spyOn(local.view, 'coordsAtPos').mockReturnValue({ top: 10, bottom: 30, left: 10, right: 50 })
  await act(async () => {
    root.render(<EditorContent editor={local} />)
  })
  await act(async () => local.commands.setNodeSelection(imagePosition(local)))
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
    local.destroy()
    peer.destroy()
  })
  localDoc.destroy()
  peerDoc.destroy()
  host.remove()
  vi.clearAllTimers()
  vi.useRealTimers()
})

function imagePosition(editor: Editor, alt?: string): number {
  let position = -1
  editor.state.doc.descendants((node, pos) => {
    if (isImageNode(node) && (alt === undefined || node.attrs.alt === alt)) position = pos
  })
  return position
}

function imageAttributes(editor: Editor) {
  const position = imagePosition(editor)
  return position < 0 ? null : editor.state.doc.nodeAt(position)?.attrs
}

async function receivePeerUpdate(): Promise<void> {
  await act(async () => Y.applyUpdate(localDoc, Y.encodeStateAsUpdate(peerDoc)))
}

function pointer(target: EventTarget, type: string, clientX: number): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX })
  Object.defineProperty(event, 'pointerId', { value: 7 })
  act(() => target.dispatchEvent(event))
}

function beginResize(): void {
  const image = host.querySelector<HTMLImageElement>('img')!
  const handle = host.querySelector<HTMLButtonElement>('button[aria-label="Resize image"]')!
  Object.defineProperty(image, 'offsetWidth', { value: 200, configurable: true })
  Object.assign(handle, {
    setPointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn(),
  })
  pointer(handle, 'pointerdown', 100)
  pointer(window, 'pointermove', 160)
  expect(host.querySelector('img')).toBe(image)
  expect(handle.setPointerCapture).toHaveBeenCalledWith(7)
  expect(image.style.width).toBe('260px')
}

async function addPeerSibling(sameSource = true): Promise<number> {
  const position = local.state.doc.firstChild!.nodeSize
  peer.commands.insertContentAt(position + 1, {
    type: 'image',
    attrs: {
      src: sameSource ? 'https://sim.ai/image.png' : 'https://sim.ai/second.png',
      alt: 'Peer image',
      title: 'Sibling identity',
      width: '400',
      height: '300',
    },
  })
  await receivePeerUpdate()
  act(() => local.commands.setNodeSelection(position))
  return position
}

function movePeerImage(from: number, to: number): void {
  peer.commands.setNodeSelection(from)
  expect(dispatchEditorDrop(peer, to).defaultPrevented).toBe(true)
}

async function setNestedImages(depth: number): Promise<void> {
  const wrap = (content: string) =>
    `${'<blockquote>'.repeat(depth)}${content}${'</blockquote>'.repeat(depth)}`
  peer.commands.setContent(
    '<h2>Earlier heading</h2>' +
      wrap(
        '<p>Original group</p><img src="https://sim.ai/image.png" alt="Original" width="200" height="100">'
      ) +
      wrap(
        '<p>Peer group</p><img src="https://sim.ai/image.png" alt="Peer image" width="400" height="300">'
      ) +
      '<p>After image</p>'
  )
  await receivePeerUpdate()
  await act(async () => local.commands.setNodeSelection(imagePosition(local, 'Original')))
}

describe('image resizing during real peer Yjs updates', () => {
  it.each(['block', 'heading', 'paragraph'])(
    'keeps the resized %s image selected for deletion and undo without changing peer text',
    async (placement) => {
      const image = '<img src="/logo.png" alt="Original" width="200" height="100">'
      await act(async () => {
        local.commands.setContent(
          placement === 'block'
            ? `<h2>Before</h2>${image}<p>After</p>`
            : `<${placement === 'heading' ? 'h2' : 'p'}>Before ${image} after</${placement === 'heading' ? 'h2' : 'p'}>`
        )
        Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc))
        local.commands.setNodeSelection(imagePosition(local))
      })
      const undoManager = yUndoPluginKey.getState(local.state).undoManager
      undoManager.clear()
      beginResize()
      peer.commands.insertContentAt(1, 'Peer ')
      await receivePeerUpdate()
      const text = local.state.doc.textContent
      const onUpdate = vi.fn()
      local.on('update', onUpdate)

      pointer(window, 'pointerup', 160)

      expect(onUpdate).toHaveBeenCalledOnce()
      expect(local.state.selection).toBeInstanceOf(NodeSelection)
      expect(local.state.selection.from).toBe(imagePosition(local))
      expect(host.querySelector('.ProseMirror-selectednode img')).not.toBeNull()
      expect(imageAttributes(local)).toMatchObject({ width: '260', height: null })
      expect(local.state.doc.textContent).toBe(text)
      await act(async () => {
        Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc))
        expect(local.commands.undo()).toBe(true)
      })
      expect(imageAttributes(local)).toMatchObject({ width: '200', height: '100' })
      expect(local.state.doc.textContent).toBe(text)
      expect(local.can().undo()).toBe(false)
      await act(async () => {
        expect(local.commands.redo()).toBe(true)
      })
      expect(imageAttributes(local)).toMatchObject({ width: '260', height: null })

      undoManager.stopCapturing()
      await act(async () => {
        expect(local.commands.keyboardShortcut('Backspace')).toBe(true)
      })
      expect(imageAttributes(local)).toBeNull()
      expect(local.state.doc.textContent).toBe(text)
      await act(async () => {
        expect(local.commands.undo()).toBe(true)
        Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc))
      })
      expect(imageAttributes(local)).toMatchObject({ width: '260', height: null })
      expect(local.getJSON()).toEqual(peer.getJSON())
      expect(local.state.doc.textContent).toBe(text)
    }
  )

  it('cancels an inline image resize when a peer deletes it', async () => {
    await act(async () => {
      local.commands.setContent(
        '<h2>Before <img src="https://sim.ai/image.png" alt="Original" width="200" height="100"> after</h2>'
      )
      Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc))
      local.commands.setNodeSelection(imagePosition(local))
    })
    beginResize()
    peer.commands.setNodeSelection(imagePosition(peer))
    peer.commands.deleteSelection()
    await receivePeerUpdate()
    pointer(window, 'pointerup', 160)
    expect(host.querySelector('img')).toBeNull()
    expect(local.getJSON()).toEqual(peer.getJSON())
  })

  it.each(
    [1, 2].flatMap((depth) =>
      [false, true].flatMap((queued) =>
        ['target', 'peer'].map((moved) => ({ depth, queued, moved }))
      )
    )
  )(
    'cancels resizing after moving the $moved containing block at depth $depth (queued: $queued)',
    async ({ depth, queued, moved }) => {
      await setNestedImages(depth)
      beginResize()
      peer.commands.setNodeSelection(
        imagePosition(peer, moved === 'target' ? 'Original' : 'Peer image')
      )
      expect(moved === 'target' ? peer.commands.moveBlockDown() : peer.commands.moveBlockUp()).toBe(
        true
      )
      if (queued) {
        await act(async () => {
          Y.applyUpdate(localDoc, Y.encodeStateAsUpdate(peerDoc))
          pointer(window, 'pointerup', 160)
        })
      } else {
        await receivePeerUpdate()
        pointer(window, 'pointerup', 160)
      }
      expect(local.getJSON()).toEqual(peer.getJSON())
    }
  )

  it.each(['delete', 'replace'] as const)(
    'rejects a queued resize after the peer %ss its containing block',
    async (action) => {
      await setNestedImages(2)
      beginResize()
      const from = peer.state.doc.firstChild!.nodeSize
      const parent = peer.state.doc.child(1)
      peer.commands.deleteRange({ from, to: from + parent.nodeSize })
      if (action === 'replace') peer.commands.insertContentAt(from, parent.toJSON())
      await act(async () => {
        Y.applyUpdate(localDoc, Y.encodeStateAsUpdate(peerDoc))
        pointer(window, 'pointerup', 160)
      })
      expect(local.getJSON()).toEqual(peer.getJSON())
    }
  )

  it.each(
    [false, true].flatMap((sameSource) =>
      ['target', 'sibling'].map((moved) => ({ sameSource, moved }))
    )
  )(
    'cancels resizing after a peer moves the $moved image (same source: $sameSource)',
    async ({ sameSource, moved }) => {
      const position = await addPeerSibling(sameSource)
      beginResize()
      if (moved === 'target') movePeerImage(position, position + 2)
      else movePeerImage(position + 1, position)
      await receivePeerUpdate()
      pointer(window, 'pointerup', 160)
      expect(local.state.doc.nodeAt(position)?.attrs.alt).toBe('Peer image')
      expect(local.getJSON()).toEqual(peer.getJSON())
    }
  )

  it.each(
    [false, true].flatMap((identical) => ['before', 'after'].map((side) => ({ identical, side })))
  )(
    'cancels resizing after a peer inserts $side the image (identical: $identical)',
    async ({ identical, side }) => {
      beginResize()
      const originalTarget = localDoc.getXmlFragment('default').get(1)
      peer.commands.insertContentAt(imagePosition(peer) + (side === 'after' ? 1 : 0), {
        type: 'image',
        attrs: identical
          ? imageAttributes(peer)
          : { src: 'https://sim.ai/inserted.png', alt: 'Inserted', width: '400' },
      })
      await receivePeerUpdate()
      expect(localDoc.getXmlFragment('default').get(1)).toBe(originalTarget)
      pointer(window, 'pointerup', 160)
      expect(local.getJSON()).toEqual(peer.getJSON())
    }
  )

  it.each([false, true])(
    'cancels a resize when the peer replaces the actual image node (identical attributes: %s)',
    async (identicalAttributes) => {
      const originalImage = localDoc.getXmlFragment('default').get(1)
      const replacement = identicalAttributes
        ? { ...imageAttributes(peer) }
        : { src: 'https://sim.ai/replacement.png', alt: 'Replacement', width: '400', height: '300' }
      beginResize()
      const position = imagePosition(peer)
      peer.commands.deleteRange({ from: position, to: position + 1 })
      peer.commands.insertContentAt(position, { type: 'image', attrs: replacement })
      await receivePeerUpdate()

      expect(localDoc.getXmlFragment('default').get(1)).not.toBe(originalImage)
      expect(host.querySelector<HTMLImageElement>('img')?.style.width).toBe(
        identicalAttributes ? '200px' : '400px'
      )
      pointer(window, 'pointerup', 160)
      expect(imageAttributes(local)).toMatchObject(replacement)
    }
  )
})
