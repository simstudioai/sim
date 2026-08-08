import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import { NodeSelection, Plugin } from '@tiptap/pm/state'
import type { ReactNodeViewProps } from '@tiptap/react'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { type ImageDimensions, useFileContentSource } from '@/hooks/use-file-content-source'
import { MarkdownImage } from './image-schema'
import { normalizeLinkHref } from './markdown-fidelity'
import { useEditorEditable } from './use-editor-editable'

const MIN_WIDTH = 64

/** A bare pixel count (`"640"`) that needs a `px` suffix, vs. an already-unit'd width (`"50%"`). */
const BARE_PIXEL_WIDTH = /^\d+$/

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
  /**
   * Intrinsic dimensions measured from the loaded image — holds the aspect-ratio box for THIS view when
   * the content source has no stored dimensions yet (the first-ever view of an image). Reset on src change.
   */
  const [measuredDimensions, setMeasuredDimensions] = useState<ImageDimensions | null>(null)
  const attrs = node.attrs as {
    src?: string
    alt?: string
    title?: string
    width?: string | null
    href?: string | null
  }

  useEffect(() => () => dragAbortRef.current?.abort(), [])

  // Reset the load-failure flag and this-session measurement when the src changes — adjusted during
  // render (not in an effect) so the previous image's aspect-ratio box never paints for a frame. A `key`
  // remount isn't available here: TipTap owns this node view's instantiation.
  const [prevSrc, setPrevSrc] = useState(attrs.src)
  if (prevSrc !== attrs.src) {
    setPrevSrc(attrs.src)
    setFailed(false)
    setMeasuredDimensions(null)
  }

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
    ? BARE_PIXEL_WIDTH.test(attrs.width)
      ? `${attrs.width}px`
      : attrs.width
    : undefined
  // Stored intrinsic dimensions reserve the box on the very first render. Memoized on the src (not the
  // live drag width) so a resize drag never re-scans the file list. Falls back to what we measured on
  // load this session for a first-ever view the metadata hasn't caught up on.
  const storedDimensions = useMemo(
    () => source.getImageDimensions?.(attrs.src) ?? null,
    [source, attrs.src]
  )
  // The browser's post-load measurement is authoritative — EXIF-corrected, and correct even when the
  // stored value is stale (e.g. left over after the file's content was replaced) — so it wins once
  // available; stored metadata only reserves the box pre-load. Equal in the common case, so no shift.
  const intrinsicDimensions = measuredDimensions ?? storedDimensions
  const displayWidth =
    dragWidth !== null
      ? `${dragWidth}px`
      : (committedWidth ?? (intrinsicDimensions ? `${intrinsicDimensions.width}px` : undefined))
  // width + aspect-ratio (with `max-w-full`/`h-auto` from the class list) reserves a responsive box the
  // image can't reflow into, per the CLS-avoidance pattern for known-ratio responsive images. React drops
  // the undefined keys, so an unmeasured image simply gets no reservation (its prior behavior).
  const imageStyle: CSSProperties = {
    width: displayWidth,
    aspectRatio: intrinsicDimensions
      ? `${intrinsicDimensions.width} / ${intrinsicDimensions.height}`
      : undefined,
  }

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
      style={imageStyle}
      onError={() => setFailed(true)}
      onLoad={(event) => {
        setFailed(false)
        const { naturalWidth, naturalHeight } = event.currentTarget
        if (naturalWidth <= 0 || naturalHeight <= 0) return
        // The browser's measurement is authoritative. Reserve from it and persist whenever the stored
        // metadata is absent or disagrees (EXIF-rotated, or stale after a content swap), so a wrong value
        // self-corrects instead of sticking. Compare the memoized `storedDimensions` the render uses, NOT
        // a fresh cache read — the memo is non-reactive, and this keeps the guard consistent with render.
        if (
          storedDimensions &&
          storedDimensions.width === naturalWidth &&
          storedDimensions.height === naturalHeight
        ) {
          return
        }
        setMeasuredDimensions({ width: naturalWidth, height: naturalHeight })
        source.reportImageDimensions?.(attrs.src, { width: naturalWidth, height: naturalHeight })
      }}
      className={cn(
        'block h-auto max-w-full rounded-lg border border-[var(--border)]',
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
