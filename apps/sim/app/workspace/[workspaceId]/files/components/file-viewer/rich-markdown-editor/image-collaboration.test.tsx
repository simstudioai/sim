/** @vitest-environment jsdom */
import { act } from 'react'
import { Tooltip } from '@sim/emcn'
import Collaboration from '@tiptap/extension-collaboration'
import { Editor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { ResizableImage } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image'

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
        ResizableImage,
        Collaboration.configure({ document }),
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
  await act(async () => {
    root.render(
      <Tooltip.Provider>
        <EditorContent editor={local} />
      </Tooltip.Provider>
    )
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

function imagePosition(editor: Editor): number {
  let position = -1
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image') position = pos
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
  expect(image.style.width).toBe('260px')
}

describe('image interactions during real peer Yjs updates', () => {
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

  it('preserves peer alt text when only the local link draft changes', async () => {
    act(() =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Edit image details"]')!.click()
    )
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Image link URL"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        'https://sim.ai/local-link'
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    peer.commands.setNodeSelection(imagePosition(peer))
    peer.commands.updateAttributes('image', { alt: 'Peer corrected alt' })
    await receivePeerUpdate()
    expect(imageAttributes(local)?.alt).toBe('Peer corrected alt')
    expect(host.querySelector('input[aria-label="Image link URL"]')).toBe(input)
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(imageAttributes(local)).toMatchObject({
      alt: 'Peer corrected alt',
      href: 'https://sim.ai/local-link',
    })
  })

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
