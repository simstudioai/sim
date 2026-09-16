/** @vitest-environment jsdom */
import { act } from 'react'
import { Editor } from '@tiptap/core'
import type { ReactNodeViewProps } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tiptap/react', () => ({
  NodeViewWrapper: 'div',
  ReactNodeViewRenderer: vi.fn(),
}))

vi.mock('@tiptap/y-tiptap', () => ({
  ySyncPluginKey: { getState: vi.fn() },
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

import { ResizableImageView } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image'
import { MarkdownImage } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-schema'

let host: HTMLDivElement
let root: Root
let editor: Editor

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  editor = new Editor({ extensions: [StarterKit, MarkdownImage] })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  editor.destroy()
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

function renderImage(
  onUpdate: ReturnType<typeof vi.fn>,
  dimensions: { width?: string | null; height?: string | null } = {},
  getPos: ReactNodeViewProps['getPos'] = () => 0
): HTMLButtonElement {
  editor.commands.setContent({
    type: 'doc',
    content: [
      {
        type: 'image',
        attrs: {
          src: '/image.png',
          alt: '',
          title: null,
          width: null,
          height: '100',
          ...dimensions,
          href: null,
        },
      },
    ],
  })
  editor.on('update', onUpdate)
  const props = {
    node: editor.state.doc.firstChild,
    getPos,
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
  it('renders a height-only image proportionally without fixing its responsive height', () => {
    renderImage(vi.fn())
    const image = host.querySelector<HTMLImageElement>('img')
    if (!image) throw new Error('Missing image')
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 400 },
      naturalHeight: { configurable: true, value: 200 },
    })
    act(() => image.dispatchEvent(new Event('load')))

    expect(image.style.height).toBe('')
    expect(image.style.width).toBe('calc(200px)')
    expect(image.style.aspectRatio).toBe('400 / 200')
  })

  it.each([
    { width: '600', height: '400' },
    { width: '600px', height: '400px' },
    { width: '600', height: '400px' },
  ])('uses the authored ratio for responsive pixel dimensions: %j', (dimensions) => {
    renderImage(vi.fn(), dimensions)
    const image = host.querySelector<HTMLImageElement>('img')!
    expect(image.style.width).toBe('600px')
    expect(image.style.height).toBe('')
    expect(image.style.aspectRatio).toBe('600 / 400')
  })

  it('preserves relative dimensions instead of assuming they are pixel ratios', () => {
    renderImage(vi.fn(), { width: '50%', height: '100px' })
    const image = host.querySelector<HTMLImageElement>('img')!
    expect(image.style.width).toBe('50%')
    expect(image.style.height).toBe('100px')
  })

  it.each(['50%', 'auto', '10em', 'calc(50% - 10px)', 'min-content', 'inherit'])(
    'preserves the native height-only CSS value %s before and after loading',
    (height) => {
      renderImage(vi.fn(), { height })
      const image = host.querySelector<HTMLImageElement>('img')!
      expect(image.style.width).toBe('')
      expect(image.style.height).toBe(height)
      expect(image.style.maxHeight).toBe('')

      Object.defineProperties(image, {
        naturalWidth: { configurable: true, value: 400 },
        naturalHeight: { configurable: true, value: 200 },
      })
      act(() => image.dispatchEvent(new Event('load')))

      expect(image.style.width).toBe('')
      expect(image.style.height).toBe(height)
      expect(image.style.maxHeight).toBe('')
    }
  )

  it('commits one proportional width change and clears a stale explicit height', () => {
    const onUpdate = vi.fn()
    const handle = renderImage(onUpdate)

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 7, clientX: 100 })))
    act(() => window.dispatchEvent(pointerEvent('pointermove', { pointerId: 7, clientX: 160 })))
    act(() => window.dispatchEvent(pointerEvent('pointerup', { pointerId: 7, clientX: 160 })))

    expect(onUpdate).toHaveBeenCalledOnce()
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ width: '260', height: null })
  })

  it('ignores unrelated pointers and cancels without mutating document attributes', () => {
    const onUpdate = vi.fn()
    const handle = renderImage(onUpdate)

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 7, clientX: 100 })))
    act(() => window.dispatchEvent(pointerEvent('pointermove', { pointerId: 8, clientX: 180 })))
    act(() => window.dispatchEvent(pointerEvent('pointerup', { pointerId: 8, clientX: 180 })))
    act(() => window.dispatchEvent(pointerEvent('pointercancel', { pointerId: 7 })))
    expect(onUpdate).not.toHaveBeenCalled()

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 9, clientX: 100 })))
    act(() => window.dispatchEvent(pointerEvent('pointermove', { pointerId: 9, clientX: 140 })))
    act(() => window.dispatchEvent(new Event('blur')))
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('does not commit a resize after live editing becomes unavailable', () => {
    const onUpdate = vi.fn()
    const handle = renderImage(onUpdate)

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 7, clientX: 100 })))
    act(() => window.dispatchEvent(pointerEvent('pointermove', { pointerId: 7, clientX: 160 })))
    editor.setEditable(false, false)
    act(() => window.dispatchEvent(pointerEvent('pointerup', { pointerId: 7, clientX: 160 })))

    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('does not commit a resize when the node view no longer has a position', () => {
    const onUpdate = vi.fn()
    const getPos = vi.fn<ReactNodeViewProps['getPos']>(() => 0)
    const handle = renderImage(onUpdate, {}, getPos)

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 7, clientX: 100 })))
    act(() => window.dispatchEvent(pointerEvent('pointermove', { pointerId: 7, clientX: 160 })))
    getPos.mockReturnValue(undefined)
    act(() => window.dispatchEvent(pointerEvent('pointerup', { pointerId: 7, clientX: 160 })))

    expect(onUpdate).not.toHaveBeenCalled()
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ width: null, height: '100' })
  })
})
