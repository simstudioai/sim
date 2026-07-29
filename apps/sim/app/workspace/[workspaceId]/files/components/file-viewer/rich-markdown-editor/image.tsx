import { useEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import { NodeSelection, Plugin } from '@tiptap/pm/state'
import type { ReactNodeViewProps } from '@tiptap/react'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { useFileContentSource } from '@/hooks/use-file-content-source'
import { MarkdownImage } from './image-schema'
import { normalizeLinkHref } from './markdown-fidelity'
import { useEditorEditable } from './use-editor-editable'

const MIN_WIDTH = 64

/**
 * Drag-to-resize image node view (handle at the bottom-right, revealed on selection). Dragging
 * commits the new pixel width to the `width` attribute, which serializes to `<img width>`.
 */
function ResizableImageView({ node, updateAttributes, selected, editor }: ReactNodeViewProps) {
  const source = useFileContentSource()
  const imageRef = useRef<HTMLImageElement>(null)
  const dragAbortRef = useRef<AbortController | null>(null)
  const dragWidthRef = useRef<number | null>(null)
  const [dragging, setDragging] = useState(false)
  /** Live width during a resize drag; kept out of the doc so the whole resize is one undo step. */
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  /** Whether the current src failed to load; reset on src change so a retried/edited src can load. */
  const [failed, setFailed] = useState(false)
  const attrs = node.attrs as {
    src?: string
    alt?: string
    title?: string
    width?: string | null
    href?: string | null
  }

  useEffect(() => () => dragAbortRef.current?.abort(), [])
  useEffect(() => setFailed(false), [attrs.src])

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
        dragWidthRef.current = next
        setDragWidth(next)
      },
      { signal }
    )
    const finish = () => {
      const finalWidth = dragWidthRef.current
      setDragging(false)
      setDragWidth(null)
      dragWidthRef.current = null
      controller.abort()
      if (finalWidth !== null) updateAttributes({ width: String(finalWidth) })
    }
    window.addEventListener('pointerup', finish, { signal })
    window.addEventListener('pointercancel', finish, { signal })
  }

  const committedWidth = attrs.width
    ? /^\d+$/.test(attrs.width)
      ? `${attrs.width}px`
      : attrs.width
    : undefined
  const widthStyle =
    dragWidth !== null
      ? { width: `${dragWidth}px` }
      : committedWidth
        ? { width: committedWidth }
        : undefined

  // Sanitize the linked-image target before rendering the anchor — a parsed markdown href is
  // untrusted and could be `javascript:`/`data:`; an unsafe value drops the link (image only).
  const safeHref = normalizeLinkHref(typeof attrs.href === 'string' ? attrs.href : '')

  // Read-only: no drag-to-reorder and no resize handle — both call updateAttributes / dispatch a move,
  // mutating a doc that must not change. The image still renders (and follows its link on click).
  const editable = useEditorEditable(editor)

  const image = (
    <img
      ref={imageRef}
      src={source.resolveImageSrc(attrs.src)}
      alt={attrs.alt ?? ''}
      title={attrs.title ?? undefined}
      // When editable, the image itself is the drag handle — grab anywhere on it to reorder. (The node
      // view's wrapper is forced `draggable=false` by the React renderer, so the handle must be a child;
      // the resize button sits outside this element, so it keeps its own pointer behavior.)
      draggable={editable}
      data-drag-handle={editable ? '' : undefined}
      style={widthStyle}
      onError={() => setFailed(true)}
      onLoad={() => setFailed(false)}
      className={cn(
        'block max-w-full rounded-lg border border-[var(--border)]',
        editable && 'cursor-grab',
        failed &&
          'min-h-[72px] min-w-[140px] bg-[var(--surface-5)] p-3 text-[var(--text-muted)] text-caption'
      )}
    />
  )

  return (
    <NodeViewWrapper className='relative my-4 inline-block leading-none'>
      {safeHref ? (
        // The editor's handleClick is the sole navigator (gated on editable/modifier, like text links
        // via openOnClick:false): prevent the anchor's own navigation so a plain click in edit mode
        // places the caret / selects the node instead of opening a tab.
        <a
          href={safeHref}
          target='_blank'
          rel='noopener noreferrer'
          className='block'
          onClick={(event) => event.preventDefault()}
        >
          {image}
        </a>
      ) : (
        image
      )}
      {editable && (selected || dragging) && (
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
  /**
   * Guarantee a plain click on the image forms a node selection. The image body is also a native drag
   * source (grab-anywhere reorder), and while prosemirror-view ≥1.32.4 no longer implicitly selects on
   * drag, the reverse — a click reliably selecting — is not guaranteed for an atom whose body competes
   * with the drag gesture (see the ProseMirror "Draggable and NodeViews" discussion and TipTap #4526).
   * Selecting here makes it deterministic while leaving drag-to-reorder intact. Read-only clicks and
   * modified clicks (Cmd/Ctrl to follow a linked badge, Shift/Alt to extend) fall through to the editor's
   * `handleClick` / default behavior.
   */
  addProseMirrorPlugins() {
    const nodeName = this.name
    return [
      new Plugin({
        props: {
          handleClickOn(view, _pos, node, nodePos, event) {
            if (!view.editable || node.type.name !== nodeName) return false
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)))
            return true
          },
        },
      }),
    ]
  },
})
