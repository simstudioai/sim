/** @vitest-environment jsdom */
import { act } from 'react'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
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
import { moveDraggedImageNode } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-drag-move'
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
  vi.unstubAllGlobals()
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
  const image = peer.state.doc.nodeAt(from)!
  peer.commands.setNodeSelection(from)
  vi.spyOn(peer.view, 'posAtCoords').mockReturnValue({ pos: to, inside: 0 })
  expect(
    moveDraggedImageNode(
      peer.view,
      new MouseEvent('drop', { clientX: 0, clientY: 0, cancelable: true }) as DragEvent,
      { images: [], html: `<img src="${image.attrs.src}">` }
    )
  ).toBe(true)
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
  it.each(['heading', 'paragraph'])(
    'renders and scrolls a valid selection when undoing a move into a %s',
    async (target) => {
      local.setOptions({ editorProps: { handleScrollToSelection: () => false } })
      yUndoPluginKey.getState(local.state).undoManager.clear()
      const dropPosition = target === 'heading' ? 8 : imagePosition(local) + 5
      vi.spyOn(local.view, 'posAtCoords').mockReturnValue({ pos: dropPosition, inside: 0 })
      await act(async () => {
        local.view.focus()
        expect(
          moveDraggedImageNode(local.view, new MouseEvent('drop') as DragEvent, {
            images: [],
            html: '<img src="https://sim.ai/image.png">',
          })
        ).toBe(true)
      })
      expect(local.state.selection).toBeInstanceOf(NodeSelection)
      expect(host.querySelector(`${target === 'heading' ? 'h2' : 'p'} img`)).not.toBeNull()
      peer.commands.insertContentAt(peer.state.doc.content.size - 1, ' preserved')
      await receivePeerUpdate()
      await act(async () => {
        expect(local.commands.undo()).toBe(true)
      })
      expect(local.state.doc.nodeAt(imagePosition(local))?.type.name).toBe('image')
      if (local.state.selection instanceof NodeSelection) {
        expect(NodeSelection.isSelectable(local.state.selection.node)).toBe(true)
      }
      expect(local.state.doc.textContent).toContain('After image preserved')
      await act(async () => {
        expect(local.commands.redo()).toBe(true)
        Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc))
      })
      expect(local.getJSON()).toEqual(peer.getJSON())
      expect(host.querySelector(`${target === 'heading' ? 'h2' : 'p'} img`)).not.toBeNull()
    }
  )

  it('normalizes an invalid node selection without changing the document or Yjs history', async () => {
    const original = local.getJSON()
    const onUpdate = vi.fn()
    localDoc.on('update', onUpdate)
    yUndoPluginKey.getState(local.state).undoManager.clear()
    await act(async () => {
      local.view.dispatch(local.state.tr.setSelection(NodeSelection.create(local.state.doc, 3)))
    })
    expect(local.state.selection).toBeInstanceOf(TextSelection)
    expect(local.state.selection.from).toBe(3)
    expect(local.getJSON()).toEqual(original)
    expect(onUpdate).not.toHaveBeenCalled()
    expect(local.can().undo()).toBe(false)
    await act(async () => local.commands.setNodeSelection(imagePosition(local)))
    expect(local.state.selection).toBeInstanceOf(NodeSelection)
    expect(local.state.selection.from).toBe(imagePosition(local))
  })

  it.each(['image', 'inlineImage'])(
    'copies a linked %s with exactly one link wrapper',
    async (type) => {
      const image = {
        type,
        attrs: {
          src: '/logo.png',
          alt: 'Logo',
          href: '/target',
          hrefTitle: 'Destination',
          width: '217',
        },
      }
      await act(async () => {
        local.commands.setContent({
          type: 'doc',
          content: type === 'inlineImage' ? [{ type: 'heading', content: [image] }] : [image],
        })
        local.commands.setNodeSelection(imagePosition(local))
      })
      const clipboard = local.view.serializeForClipboard(local.state.selection.content())
      expect(clipboard.dom.querySelectorAll('a')).toHaveLength(1)
      expect(clipboard.dom.querySelector('a')?.getAttribute('href')).toBe('/target')
      expect(clipboard.dom.querySelector('a')?.getAttribute('title')).toBe('Destination')
      expect(clipboard.dom.querySelector('img')?.getAttribute('width')).toBe('217')
    }
  )

  it('resizes an inline image alongside peer heading text', async () => {
    await act(async () => {
      local.commands.setContent(
        '<h2>Before <img src="https://sim.ai/image.png" alt="Original" width="200" height="100"> after</h2>'
      )
      Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc))
      local.commands.setNodeSelection(imagePosition(local))
    })
    expect(host.querySelector('h2 img')).not.toBeNull()
    expect(host.querySelector('h2 div')).toBeNull()
    beginResize()
    peer.commands.insertContentAt(1, 'Peer ')
    await receivePeerUpdate()
    pointer(window, 'pointerup', 160)
    expect(imageAttributes(local)).toMatchObject({ alt: 'Original', href: null, width: '260' })
    expect(local.state.doc.firstChild?.textContent).toBe('Peer Before  after')
    await act(async () => Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc)))
    expect(peer.getJSON()).toEqual(local.getJSON())
  })

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

  it('preserves metadata and peer text while resizing inside nested image containers', async () => {
    await setNestedImages(2)
    beginResize()
    peer.commands.setNodeSelection(imagePosition(peer, 'Original'))
    peer.commands.updateAttributes('image', {
      alt: 'Peer corrected alt',
      href: 'https://sim.ai/peer-link',
    })
    peer.commands.insertContentAt('Earlier heading'.length + 1, ' PEER')
    peer.commands.insertContentAt(imagePosition(peer, 'Peer image') - 2, ' PEER')
    await receivePeerUpdate()
    pointer(window, 'pointerup', 160)
    expect(local.state.doc.nodeAt(imagePosition(local, 'Peer corrected alt'))?.attrs).toMatchObject(
      {
        alt: 'Peer corrected alt',
        href: 'https://sim.ai/peer-link',
        width: '260',
      }
    )
    await act(async () => Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc)))
    expect(local.getJSON()).toEqual(peer.getJSON())
  })

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

  it('cancels resizing conservatively when another container image changes', async () => {
    await setNestedImages(2)
    beginResize()
    peer.commands.setNodeSelection(imagePosition(peer, 'Peer image'))
    peer.commands.updateAttributes('image', { alt: 'Peer corrected alt', width: '480' })
    await receivePeerUpdate()
    pointer(window, 'pointerup', 160)
    expect(local.getJSON()).toEqual(peer.getJSON())
  })

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

  it('preserves target metadata and text edits around an unchanged same-source sibling', async () => {
    const position = await addPeerSibling()
    beginResize()
    peer.commands.setNodeSelection(position)
    peer.commands.updateAttributes('image', {
      alt: 'Peer corrected alt',
      href: 'https://sim.ai/peer-link',
    })
    peer.commands.insertContentAt('Earlier heading'.length + 1, ' PEER')
    await receivePeerUpdate()
    pointer(window, 'pointerup', 160)
    const currentPosition = local.state.doc.firstChild!.nodeSize
    expect(local.state.doc.nodeAt(currentPosition)?.attrs).toMatchObject({
      alt: 'Peer corrected alt',
      href: 'https://sim.ai/peer-link',
      width: '260',
    })
    expect(local.state.doc.nodeAt(currentPosition + 1)?.attrs.alt).toBe('Peer image')
    await act(async () => Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc)))
    expect(local.getJSON()).toEqual(peer.getJSON())
  })

  it.each(['alt', 'width', 'src'])(
    'cancels resizing conservatively when a sibling image changes its %s',
    async (field) => {
      const position = await addPeerSibling()
      beginResize()
      peer.commands.setNodeSelection(position + 1)
      peer.commands.updateAttributes('image', {
        [field]: field === 'width' ? '500' : 'https://sim.ai/peer-change',
      })
      await receivePeerUpdate()
      pointer(window, 'pointerup', 160)
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

  it.each(['pointerup', 'pointercancel', 'blur', 'unmount'])(
    'removes the resize transaction listener after %s',
    (finish) => {
      const subscribe = vi.spyOn(local, 'on')
      const unsubscribe = vi.spyOn(local, 'off')
      beginResize()
      const listener = subscribe.mock.calls.find(([event]) => event === 'transaction')?.[1]
      expect(listener).toBeTypeOf('function')

      if (finish === 'unmount') act(() => root.unmount())
      else pointer(window, finish, 160)

      expect(unsubscribe).toHaveBeenCalledWith('transaction', listener)
    }
  )

  it('keeps resizing the same image after a peer heading and metadata edit', async () => {
    const originalImage = localDoc.getXmlFragment('default').get(1)
    beginResize()
    peer.commands.insertContentAt('Earlier heading'.length + 1, ' PEER')
    peer.commands.setNodeSelection(imagePosition(peer))
    peer.commands.updateAttributes('image', { alt: 'Peer corrected alt' })
    await receivePeerUpdate()

    expect(localDoc.getXmlFragment('default').get(1)).toBe(originalImage)
    pointer(window, 'pointerup', 160)
    expect(imageAttributes(local)).toMatchObject({
      alt: 'Peer corrected alt',
      width: '260',
      height: null,
    })
    expect(local.state.doc.firstChild?.textContent).toBe('Earlier heading PEER')
  })

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

  it('cancels a resize when the peer deletes the image', async () => {
    beginResize()
    const position = imagePosition(peer)
    peer.commands.deleteRange({ from: position, to: position + 1 })
    await receivePeerUpdate()
    pointer(window, 'pointerup', 160)

    expect(host.querySelector('img')).toBeNull()
    expect(local.getHTML()).toBe('<h2>Earlier heading</h2><p>After image</p>')
  })
})
