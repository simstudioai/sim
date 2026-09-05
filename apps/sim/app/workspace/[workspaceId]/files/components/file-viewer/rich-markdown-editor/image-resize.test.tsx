/** @vitest-environment jsdom */
import { act } from 'react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tiptap/react', () => ({
  NodeViewWrapper: 'div',
  ReactNodeViewRenderer: vi.fn(),
}))

vi.mock('@/hooks/use-file-content-source', () => ({
  useFileContentSource: () => ({
    resolveImageSrc: (src: string) => src,
    getImageDimensions: () => null,
  }),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/use-editor-editable',
  () => ({ useEditorEditable: () => true })
)

vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-inspector',
  () => ({ ImageInspector: () => null })
)

import { ResizableImageView } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image'

let host: HTMLDivElement
let root: Root
const editor = { isEditable: true, isDestroyed: false, commands: { focus: vi.fn() } }

beforeEach(() => {
  editor.isEditable = true
  editor.isDestroyed = false
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function pointerEvent(
  type: string,
  { pointerId, clientX = 0, button = 0 }: { pointerId: number; clientX?: number; button?: number }
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    button: { value: button },
    pointerType: { value: 'touch' },
  })
  return event
}

function renderImage(updateAttributes: ReturnType<typeof vi.fn>): HTMLButtonElement {
  const props = {
    node: {
      attrs: {
        src: '/image.png',
        alt: '',
        title: null,
        width: null,
        height: '100',
        href: null,
      },
    },
    updateAttributes,
    selected: true,
    editor,
  } as unknown as ReactNodeViewProps
  act(() => root.render(<ResizableImageView {...props} />))
  const image = host.querySelector<HTMLImageElement>('img')
  const handle = host.querySelector<HTMLButtonElement>('button[aria-label="Resize image"]')
  if (!image || !handle) throw new Error('Resizable image did not render')
  Object.defineProperty(image, 'offsetWidth', { configurable: true, value: 200 })
  Object.assign(handle, {
    setPointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn(),
  })
  return handle
}

describe('ResizableImageView', () => {
  it('keeps the width automatic when only an explicit height is stored', () => {
    renderImage(vi.fn())
    const image = host.querySelector<HTMLImageElement>('img')
    if (!image) throw new Error('Missing image')
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 400 },
      naturalHeight: { configurable: true, value: 200 },
    })
    act(() => image.dispatchEvent(new Event('load')))

    expect(image.style.height).toBe('100px')
    expect(image.style.width).toBe('')
  })

  it('commits one proportional width change and clears a stale explicit height', () => {
    const updateAttributes = vi.fn()
    const handle = renderImage(updateAttributes)

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 7, clientX: 100 })))
    act(() => window.dispatchEvent(pointerEvent('pointermove', { pointerId: 7, clientX: 160 })))
    act(() => window.dispatchEvent(pointerEvent('pointerup', { pointerId: 7, clientX: 160 })))

    expect(updateAttributes).toHaveBeenCalledOnce()
    expect(updateAttributes).toHaveBeenCalledWith({ width: '260', height: null })
  })

  it('ignores unrelated pointers and cancels without mutating document attributes', () => {
    const updateAttributes = vi.fn()
    const handle = renderImage(updateAttributes)

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 7, clientX: 100 })))
    act(() => window.dispatchEvent(pointerEvent('pointermove', { pointerId: 8, clientX: 180 })))
    act(() => window.dispatchEvent(pointerEvent('pointerup', { pointerId: 8, clientX: 180 })))
    act(() => window.dispatchEvent(pointerEvent('pointercancel', { pointerId: 7 })))
    expect(updateAttributes).not.toHaveBeenCalled()

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 9, clientX: 100 })))
    act(() => window.dispatchEvent(pointerEvent('pointermove', { pointerId: 9, clientX: 140 })))
    act(() => window.dispatchEvent(new Event('blur')))
    expect(updateAttributes).not.toHaveBeenCalled()
  })

  it('does not commit a resize after live editing becomes unavailable', () => {
    const updateAttributes = vi.fn()
    const handle = renderImage(updateAttributes)

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 7, clientX: 100 })))
    act(() => window.dispatchEvent(pointerEvent('pointermove', { pointerId: 7, clientX: 160 })))
    editor.isEditable = false
    act(() => window.dispatchEvent(pointerEvent('pointerup', { pointerId: 7, clientX: 160 })))

    expect(updateAttributes).not.toHaveBeenCalled()
  })
})
