import { useEffect, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'
import type { ReactNodeViewProps } from '@tiptap/react'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'

const MIN_WIDTH = 64

/** Escape a value for safe interpolation into a double-quoted HTML attribute. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Serialize an image to markdown when it has no explicit size, and to an HTML `<img>` tag when
 * it does — standard markdown has no width syntax, so a resized image must round-trip as HTML
 * (the same convention GitHub uses). Unsized images stay clean `![alt](src)`.
 */
function imageMarkdown(node: JSONContent): string {
  const attrs = node.attrs ?? {}
  const src = typeof attrs.src === 'string' ? attrs.src : ''
  const alt = typeof attrs.alt === 'string' ? attrs.alt : ''
  const title = typeof attrs.title === 'string' ? attrs.title : ''
  const width = attrs.width
  const height = attrs.height
  if (width || height) {
    const parts = [`src="${escapeAttr(src)}"`]
    if (alt) parts.push(`alt="${escapeAttr(alt)}"`)
    if (title) parts.push(`title="${escapeAttr(title)}"`)
    if (width) parts.push(`width="${escapeAttr(String(width))}"`)
    if (height) parts.push(`height="${escapeAttr(String(height))}"`)
    return `<img ${parts.join(' ')}>`
  }
  const titlePart = title ? ` "${title}"` : ''
  return `![${alt}](${src}${titlePart})`
}

const widthAttr = {
  default: null,
  parseHTML: (element: HTMLElement) => element.getAttribute('width'),
  renderHTML: (attributes: Record<string, unknown>) =>
    attributes.width ? { width: String(attributes.width) } : {},
}

const heightAttr = {
  default: null,
  parseHTML: (element: HTMLElement) => element.getAttribute('height'),
  renderHTML: (attributes: Record<string, unknown>) =>
    attributes.height ? { height: String(attributes.height) } : {},
}

/**
 * Image node that carries optional `width`/`height` and serializes them as an HTML `<img>` tag.
 * Shared by the headless round-trip path (no node view) and the live {@link ResizableImage}.
 */
export const MarkdownImage = Image.extend({
  addAttributes() {
    return { ...this.parent?.(), width: widthAttr, height: heightAttr }
  },
  renderMarkdown: imageMarkdown,
})

/**
 * Drag-to-resize image node view (handle at the bottom-right, revealed on selection). Dragging
 * commits the new pixel width to the `width` attribute, which serializes to `<img width>`.
 */
function ResizableImageView({ node, updateAttributes, selected }: ReactNodeViewProps) {
  const imageRef = useRef<HTMLImageElement>(null)
  const dragAbortRef = useRef<AbortController | null>(null)
  const [dragging, setDragging] = useState(false)
  const attrs = node.attrs as { src?: string; alt?: string; title?: string; width?: string | null }

  useEffect(() => () => dragAbortRef.current?.abort(), [])

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault()
    const image = imageRef.current
    if (!image) return
    const startX = event.clientX
    const startWidth = image.offsetWidth
    setDragging(true)
    dragAbortRef.current?.abort()
    const controller = new AbortController()
    dragAbortRef.current = controller
    const { signal } = controller

    window.addEventListener(
      'pointermove',
      (move) => {
        const next = Math.max(MIN_WIDTH, Math.round(startWidth + (move.clientX - startX)))
        updateAttributes({ width: String(next) })
      },
      { signal }
    )
    window.addEventListener(
      'pointerup',
      () => {
        setDragging(false)
        controller.abort()
      },
      { signal }
    )
  }

  const widthStyle = attrs.width
    ? { width: /^\d+$/.test(attrs.width) ? `${attrs.width}px` : attrs.width }
    : undefined

  return (
    <NodeViewWrapper className='relative my-4 inline-block leading-none'>
      <img
        ref={imageRef}
        src={attrs.src}
        alt={attrs.alt ?? ''}
        title={attrs.title ?? undefined}
        draggable={false}
        style={widthStyle}
        className='block max-w-full rounded-lg border border-[var(--border)]'
      />
      {(selected || dragging) && (
        <button
          type='button'
          aria-label='Resize image'
          onPointerDown={startResize}
          className='absolute right-1 bottom-1 size-3 cursor-nwse-resize rounded-[3px] border border-[var(--bg)] bg-[var(--brand-secondary)]'
        />
      )}
    </NodeViewWrapper>
  )
}

/** Live image node with the drag-to-resize view; same schema + markdown output as the headless one. */
export const ResizableImage = MarkdownImage.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView)
  },
})
