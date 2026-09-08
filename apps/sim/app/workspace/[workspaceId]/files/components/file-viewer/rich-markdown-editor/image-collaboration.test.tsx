/** @vitest-environment jsdom */
import { act } from 'react'
import { Tooltip } from '@sim/emcn'
import Collaboration from '@tiptap/extension-collaboration'
import { Editor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { BlockMover } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/block-mover'
import { ResizableImage } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image'
import { moveDraggedImageNode } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-drag-move'
import { ImageBubbleMenu } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/image-menu'

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
  vi.spyOn(local.view, 'coordsAtPos').mockReturnValue({ top: 10, bottom: 30, left: 10, right: 50 })
  await act(async () => {
    root.render(
      <Tooltip.Provider>
        <ImageBubbleMenu editor={local} scrollContainerRef={{ current: host }} />
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

function imagePosition(editor: Editor, alt?: string): number {
  let position = -1
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image' && (alt === undefined || node.attrs.alt === alt)) position = pos
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

function changeDraft(value: string): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('[aria-label="Image editing"] input')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return input
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

describe('image interactions during real peer Yjs updates', () => {
  it.each(
    (['alt', 'href', 'resize'] as const).flatMap((interaction) =>
      [1, 2].flatMap((depth) =>
        [false, true].flatMap((queued) =>
          ['target', 'peer'].map((moved) => ({ interaction, depth, queued, moved }))
        )
      )
    )
  )(
    'cancels $interaction after moving the $moved containing block at depth $depth (queued: $queued)',
    async ({ interaction, depth, queued, moved }) => {
      await setNestedImages(depth)
      let input: HTMLInputElement | undefined
      if (interaction === 'resize') beginResize()
      else {
        const label = interaction === 'alt' ? 'alt text' : 'link'
        act(() =>
          host.querySelector<HTMLButtonElement>(`[aria-label="Edit image ${label}"]`)!.click()
        )
        input = changeDraft(
          interaction === 'alt' ? 'Draft for original' : 'https://sim.ai/for-original'
        )
      }
      peer.commands.setNodeSelection(
        imagePosition(peer, moved === 'target' ? 'Original' : 'Peer image')
      )
      expect(moved === 'target' ? peer.commands.moveBlockDown() : peer.commands.moveBlockUp()).toBe(
        true
      )
      const finish = () => {
        if (input)
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        else pointer(window, 'pointerup', 160)
      }
      if (queued) {
        await act(async () => {
          Y.applyUpdate(localDoc, Y.encodeStateAsUpdate(peerDoc))
          finish()
        })
      } else {
        await receivePeerUpdate()
        await act(async () => finish())
      }
      expect(host.querySelector('[aria-label="Image editing"] input')).toBeNull()
      expect(local.getJSON()).toEqual(peer.getJSON())
    }
  )

  it.each(['alt', 'href', 'resize'] as const)(
    'preserves %s alongside selected metadata and peer text inside nested image containers',
    async (interaction) => {
      await setNestedImages(2)
      let input: HTMLInputElement | undefined
      if (interaction === 'resize') beginResize()
      else {
        const label = interaction === 'alt' ? 'alt text' : 'link'
        act(() =>
          host.querySelector<HTMLButtonElement>(`[aria-label="Edit image ${label}"]`)!.click()
        )
        input = changeDraft(
          interaction === 'alt' ? 'Local corrected alt' : 'https://sim.ai/local-link'
        )
      }
      peer.commands.setNodeSelection(imagePosition(peer, 'Original'))
      peer.commands.updateAttributes(
        'image',
        interaction === 'alt' ? { href: 'https://sim.ai/peer-link' } : { alt: 'Peer corrected alt' }
      )
      peer.commands.insertContentAt('Earlier heading'.length + 1, ' PEER')
      peer.commands.insertContentAt(imagePosition(peer, 'Peer image') - 2, ' PEER')
      await receivePeerUpdate()
      if (input) {
        expect(host.querySelector('[aria-label="Image editing"] input')).toBe(input)
        await act(async () =>
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        )
      } else pointer(window, 'pointerup', 160)
      const alt = interaction === 'alt' ? 'Local corrected alt' : 'Peer corrected alt'
      expect(local.state.doc.nodeAt(imagePosition(local, alt))?.attrs).toMatchObject({
        alt,
        href:
          interaction === 'href'
            ? 'https://sim.ai/local-link'
            : interaction === 'alt'
              ? 'https://sim.ai/peer-link'
              : null,
        width: interaction === 'resize' ? '260' : '200',
      })
      await act(async () => Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc)))
      expect(local.getJSON()).toEqual(peer.getJSON())
    }
  )

  it.each(['delete', 'replace'] as const)(
    'rejects a queued draft after the peer %ss its containing block',
    async (action) => {
      await setNestedImages(2)
      act(() =>
        host.querySelector<HTMLButtonElement>('[aria-label="Edit image alt text"]')!.click()
      )
      const input = changeDraft('Uncommitted draft')
      const from = peer.state.doc.firstChild!.nodeSize
      const parent = peer.state.doc.child(1)
      peer.commands.deleteRange({ from, to: from + parent.nodeSize })
      if (action === 'replace') peer.commands.insertContentAt(from, parent.toJSON())
      await act(async () => {
        Y.applyUpdate(localDoc, Y.encodeStateAsUpdate(peerDoc))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      expect(host.querySelector('[aria-label="Image editing"] input')).toBeNull()
      expect(local.getJSON()).toEqual(peer.getJSON())
    }
  )

  it.each(['alt', 'href', 'resize'] as const)(
    'cancels %s conservatively when another container image changes',
    async (interaction) => {
      await setNestedImages(2)
      let input: HTMLInputElement | undefined
      if (interaction === 'resize') beginResize()
      else {
        const label = interaction === 'alt' ? 'alt text' : 'link'
        act(() =>
          host.querySelector<HTMLButtonElement>(`[aria-label="Edit image ${label}"]`)!.click()
        )
        input = changeDraft('https://sim.ai/uncommitted')
      }
      peer.commands.setNodeSelection(imagePosition(peer, 'Peer image'))
      peer.commands.updateAttributes('image', { alt: 'Peer corrected alt', width: '480' })
      await receivePeerUpdate()
      if (input) {
        expect(host.querySelector('[aria-label="Image editing"] input')).toBeNull()
        await act(async () =>
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        )
      } else pointer(window, 'pointerup', 160)
      expect(local.getJSON()).toEqual(peer.getJSON())
    }
  )

  it.each(
    (['alt', 'href', 'resize'] as const).flatMap((interaction) =>
      [false, true].flatMap((sameSource) =>
        ['target', 'sibling'].map((moved) => ({ interaction, sameSource, moved }))
      )
    )
  )(
    'cancels $interaction after a peer moves the $moved image (same source: $sameSource)',
    async ({ interaction, sameSource, moved }) => {
      const position = await addPeerSibling(sameSource)
      let input: HTMLInputElement | undefined
      if (interaction === 'resize') beginResize()
      else {
        const label = interaction === 'alt' ? 'alt text' : 'link'
        act(() =>
          host.querySelector<HTMLButtonElement>(`[aria-label="Edit image ${label}"]`)!.click()
        )
        input = changeDraft(
          interaction === 'alt' ? 'Draft for original' : 'https://sim.ai/for-original'
        )
      }
      if (moved === 'target') movePeerImage(position, position + 2)
      else movePeerImage(position + 1, position)
      await receivePeerUpdate()
      if (input) {
        expect(host.querySelector('[aria-label="Image editing"] input')).toBeNull()
        await act(async () => {
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        })
      } else pointer(window, 'pointerup', 160)
      expect(local.state.doc.nodeAt(position)?.attrs.alt).toBe('Peer image')
      expect(local.getJSON()).toEqual(peer.getJSON())
    }
  )

  it.each(['alt text', 'link'])(
    'rejects queued %s Apply before React renders a same-source reorder',
    async (field) => {
      const position = await addPeerSibling()
      act(() =>
        host.querySelector<HTMLButtonElement>(`[aria-label="Edit image ${field}"]`)!.click()
      )
      const input = changeDraft('https://sim.ai/stale-draft')
      movePeerImage(position + 1, position)
      await act(async () => {
        Y.applyUpdate(localDoc, Y.encodeStateAsUpdate(peerDoc))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      expect(local.getJSON()).toEqual(peer.getJSON())
      expect(host.querySelector('[aria-label="Image editing"] input')).toBeNull()
    }
  )

  it('does not revive a draft after images are reordered back', async () => {
    const position = await addPeerSibling()
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Edit image alt text"]')!.click())
    changeDraft('Stale draft')
    movePeerImage(position + 1, position)
    await receivePeerUpdate()
    expect(host.querySelector('[aria-label="Image editing"] input')).toBeNull()
    movePeerImage(position + 1, position)
    await receivePeerUpdate()
    expect(host.querySelector('[aria-label="Image editing"] input')).toBeNull()
    expect(local.getJSON()).toEqual(peer.getJSON())
  })

  it('preserves target metadata edits and text edits around an unchanged same-source sibling', async () => {
    const position = await addPeerSibling()
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Edit image link"]')!.click())
    const input = changeDraft('https://sim.ai/local-link')
    peer.commands.setNodeSelection(position)
    peer.commands.updateAttributes('image', { alt: 'Peer corrected alt' })
    peer.commands.insertContentAt('Earlier heading'.length + 1, ' PEER')
    await receivePeerUpdate()
    expect(host.querySelector('[aria-label="Image editing"] input')).toBe(input)
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    const currentPosition = local.state.doc.firstChild!.nodeSize
    expect(local.state.doc.nodeAt(currentPosition)?.attrs).toMatchObject({
      alt: 'Peer corrected alt',
      href: 'https://sim.ai/local-link',
    })
    expect(local.state.doc.nodeAt(currentPosition + 1)?.attrs.alt).toBe('Peer image')
    await act(async () => {
      Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc))
    })
    expect(local.getJSON()).toEqual(peer.getJSON())
  })

  it.each(['alt', 'width', 'src'])(
    'cancels conservatively when a sibling image changes its %s',
    async (field) => {
      const position = await addPeerSibling()
      act(() =>
        host.querySelector<HTMLButtonElement>('[aria-label="Edit image alt text"]')!.click()
      )
      const input = changeDraft('Stale draft')
      peer.commands.setNodeSelection(position + 1)
      peer.commands.updateAttributes('image', {
        [field]: field === 'width' ? '500' : 'https://sim.ai/peer-change',
      })
      await receivePeerUpdate()
      expect(host.querySelector('[aria-label="Image editing"] input')).toBeNull()
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      expect(local.getJSON()).toEqual(peer.getJSON())
    }
  )

  it.each(
    (['alt', 'href', 'resize'] as const).flatMap((interaction) =>
      [false, true].flatMap((identical) =>
        ['before', 'after'].map((side) => ({ interaction, identical, side }))
      )
    )
  )(
    'cancels $interaction after a peer inserts $side the image (identical: $identical)',
    async ({ interaction, identical, side }) => {
      let input: HTMLInputElement | undefined
      if (interaction === 'resize') beginResize()
      else {
        const label = interaction === 'alt' ? 'alt text' : 'link'
        act(() =>
          host.querySelector<HTMLButtonElement>(`[aria-label="Edit image ${label}"]`)!.click()
        )
        input = changeDraft(interaction === 'alt' ? 'Local draft' : 'https://sim.ai/local-draft')
      }
      const originalTarget = localDoc.getXmlFragment('default').get(1)
      peer.commands.insertContentAt(imagePosition(peer) + (side === 'after' ? 1 : 0), {
        type: 'image',
        attrs: identical
          ? imageAttributes(peer)
          : { src: 'https://sim.ai/inserted.png', alt: 'Inserted', width: '400' },
      })
      await receivePeerUpdate()
      expect(localDoc.getXmlFragment('default').get(1)).toBe(originalTarget)
      if (input) {
        expect(host.querySelector('[aria-label="Image editing"] input')).toBeNull()
        act(() =>
          input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        )
      } else pointer(window, 'pointerup', 160)
      expect(local.getJSON()).toEqual(peer.getJSON())
    }
  )

  it('rejects a queued Apply before React renders the peer insertion', async () => {
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Edit image alt text"]')!.click())
    const input = changeDraft('Stale draft')
    peer.commands.insertContentAt(imagePosition(peer), {
      type: 'image',
      attrs: imageAttributes(peer),
    })
    await act(async () => {
      Y.applyUpdate(localDoc, Y.encodeStateAsUpdate(peerDoc))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(local.getJSON()).toEqual(peer.getJSON())
    expect(host.querySelector('[aria-label="Image editing"] input')).toBeNull()
  })

  it('does not revive a canceled draft when the peer removes their inserted image', async () => {
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Edit image alt text"]')!.click())
    changeDraft('Stale draft')
    const position = imagePosition(peer)
    peer.commands.insertContentAt(position, { type: 'image', attrs: imageAttributes(peer) })
    await receivePeerUpdate()
    expect(host.querySelector('[aria-label="Image editing"] input')).toBeNull()
    peer.commands.deleteRange({ from: position, to: position + 1 })
    await receivePeerUpdate()
    expect(host.querySelector('[aria-label="Image editing"] input')).toBeNull()
    expect(local.getJSON()).toEqual(peer.getJSON())
  })

  it.each(['cancel', 'apply', 'unmount'] as const)(
    'removes the draft guard listener on %s',
    (finish) => {
      const subscribe = vi.spyOn(local, 'on')
      const unsubscribe = vi.spyOn(local, 'off')
      act(() =>
        host.querySelector<HTMLButtonElement>('[aria-label="Edit image alt text"]')!.click()
      )
      const listener = subscribe.mock.calls.find(([event]) => event === 'transaction')?.[1]
      expect(listener).toBeTypeOf('function')
      if (finish === 'unmount') act(() => root.unmount())
      else {
        const key = finish === 'cancel' ? 'Escape' : 'Enter'
        act(() =>
          host
            .querySelector('input')!
            .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
        )
      }
      expect(unsubscribe).toHaveBeenCalledWith('transaction', listener)
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

  it('preserves peer alt text when only the local link draft changes', async () => {
    act(() =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Edit image link"]')!.click()
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

  it.each(['alt', 'href', 'unchanged', 'reverted'] as const)(
    'preserves peer fields and follows the image through preceding edits: %s',
    async (change) => {
      const field = change === 'href' ? 'link' : 'alt text'
      act(() =>
        host.querySelector<HTMLButtonElement>(`button[aria-label="Edit image ${field}"]`)!.click()
      )
      const input = changeDraft(
        change === 'href'
          ? 'https://sim.ai/local'
          : change === 'unchanged'
            ? 'Original'
            : 'Local alt'
      )
      if (change === 'reverted') changeDraft('Original')
      peer.commands.insertContentAt('Earlier heading'.length + 1, ' PEER')
      peer.commands.setNodeSelection(imagePosition(peer))
      peer.commands.updateAttributes('image', { alt: 'Peer alt', href: 'https://sim.ai/peer' })
      await receivePeerUpdate()
      expect(host.querySelector('[aria-label="Image editing"] input')).toBe(input)
      await act(async () =>
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      )
      expect(imageAttributes(local)).toMatchObject({
        alt: change === 'alt' ? 'Local alt' : 'Peer alt',
        href: change === 'href' ? 'https://sim.ai/local' : 'https://sim.ai/peer',
      })
      expect(local.state.doc.firstChild?.textContent).toBe('Earlier heading PEER')
    }
  )

  it.each(['delete', 'replace', 'identical replacement'] as const)(
    'never applies an open draft to a peer replacement: %s',
    async (action) => {
      act(() =>
        host.querySelector<HTMLButtonElement>('[aria-label="Edit image alt text"]')!.click()
      )
      const input = changeDraft('Uncommitted draft')
      const position = imagePosition(peer)
      const originalAttributes = imageAttributes(peer)
      peer.commands.deleteRange({ from: position, to: position + 1 })
      if (action !== 'delete')
        peer.commands.insertContentAt(position, {
          type: 'image',
          attrs:
            action === 'replace'
              ? { ...originalAttributes, alt: 'Replacement' }
              : originalAttributes,
        })
      await receivePeerUpdate()
      act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
      expect(host.querySelector('[aria-label="Image editing"] input')).toBeNull()
      expect(imageAttributes(local)?.alt ?? null).toBe(
        action === 'delete' ? null : action === 'replace' ? 'Replacement' : 'Original'
      )
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
