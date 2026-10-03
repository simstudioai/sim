import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { Button, cn } from '@sim/emcn'
import type { Node } from '@tiptap/core'
import { NodeSelection, Plugin } from '@tiptap/pm/state'
import type { ReactNodeViewProps } from '@tiptap/react'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { type ProsemirrorBinding, ySyncPluginKey } from '@tiptap/y-tiptap'
import {
  MarkdownImage,
  MarkdownInlineImage,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-schema'
import { createImageTargetGuard } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-target'
import { normalizeLinkHref } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import { useEditorEditable } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/use-editor-editable'
import { type ImageDimensions, useFileContentSource } from '@/hooks/use-file-content-source'

const MIN_WIDTH = 64

/** A bare pixel count (`"640"`) that needs a `px` suffix, vs. an already-unit'd size (`"50%"`). */
const BARE_PIXEL_SIZE = /^\d+$/
const PIXEL_SIZE = /^\d+(?:\.\d+)?px$/

/**
 * Drag-to-resize image node view (handle at the bottom-right, revealed on selection). Dragging
 * commits the new pixel width to the `width` attribute, which serializes to `<img width>`.
 */
export function ResizableImageView({ node, selected, editor, getPos }: ReactNodeViewProps) {
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
    height?: string | null
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
    if (event.button !== 0 || dragging) return
    const image = imageRef.current
    if (!image) return
    const binding: ProsemirrorBinding | undefined = ySyncPluginKey.getState(editor.state)?.binding
    const position = binding ? getPos() : undefined
    const currentNode = typeof position === 'number' ? editor.state.doc.nodeAt(position) : null
    const matchesTarget =
      binding && currentNode ? createImageTargetGuard(binding, currentNode) : undefined
    /** A node view can be reused for a replacement image, even when every attribute is identical. */
    const isCurrentTarget = () => {
      if (!binding) return true
      const position = getPos()
      return (
        matchesTarget !== undefined &&
        typeof position === 'number' &&
        matchesTarget(editor.state.doc.nodeAt(position))
      )
    }
    if (!isCurrentTarget()) return
    const handle = event.currentTarget
    const pointerId = event.pointerId
    handle.setPointerCapture(pointerId)
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
        if (move.pointerId !== pointerId) return
        const next = Math.max(MIN_WIDTH, Math.round(startWidth + (move.clientX - startX)))
        dragWidthRef.current = next
        setDragWidth(next)
      },
      { signal }
    )
    const finish = (commit: boolean) => {
      const finalWidth = dragWidthRef.current
      setDragging(false)
      setDragWidth(null)
      dragWidthRef.current = null
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
      controller.abort()
      if (
        commit &&
        finalWidth !== null &&
        editor.isEditable &&
        !editor.isDestroyed &&
        isCurrentTarget()
      ) {
        const position = getPos()
        if (typeof position !== 'number') return
        const tr = editor.state.tr
          .setNodeAttribute(position, 'width', String(finalWidth))
          .setNodeAttribute(position, 'height', null)
        editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, position)))
      }
    }
    if (binding) {
      const onTransaction = () => {
        if (!isCurrentTarget()) finish(false)
      }
      editor.on('transaction', onTransaction)
      signal.addEventListener('abort', () => editor.off('transaction', onTransaction), {
        once: true,
      })
    }
    window.addEventListener(
      'pointerup',
      (up) => {
        if (up.pointerId === pointerId) finish(true)
      },
      { signal }
    )
    window.addEventListener(
      'pointercancel',
      (cancel) => {
        if (cancel.pointerId === pointerId) finish(false)
      },
      { signal }
    )
    window.addEventListener('blur', () => finish(false), { signal })
  }

  const committedWidth = attrs.width
    ? BARE_PIXEL_SIZE.test(attrs.width)
      ? `${attrs.width}px`
      : attrs.width
    : undefined
  const committedHeight = attrs.height
    ? BARE_PIXEL_SIZE.test(attrs.height)
      ? `${attrs.height}px`
      : attrs.height
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
  const hasPixelHeight = committedHeight !== undefined && PIXEL_SIZE.test(committedHeight)
  const authoredDimensions =
    committedWidth &&
    committedHeight &&
    PIXEL_SIZE.test(committedWidth) &&
    PIXEL_SIZE.test(committedHeight) &&
    Number.parseFloat(committedWidth) > 0 &&
    Number.parseFloat(committedHeight) > 0
      ? { width: Number.parseFloat(committedWidth), height: Number.parseFloat(committedHeight) }
      : null
  const displayDimensions =
    dragWidth === null ? (authoredDimensions ?? intrinsicDimensions) : intrinsicDimensions
  const displayWidth =
    dragWidth !== null
      ? `${dragWidth}px`
      : (committedWidth ??
        (intrinsicDimensions && (!committedHeight || hasPixelHeight)
          ? committedHeight
            ? `calc(${committedHeight} * ${intrinsicDimensions.width / intrinsicDimensions.height})`
            : `${intrinsicDimensions.width}px`
          : undefined))
  // width + aspect-ratio (with `max-w-full`/`h-auto` from the class list) reserves a responsive box the
  // image can't reflow into, per the CLS-avoidance pattern for known-ratio responsive images. React drops
  // the undefined keys, so an unmeasured image simply gets no reservation (its prior behavior).
  const imageStyle: CSSProperties = {
    width: displayWidth,
    height:
      dragWidth === null && !authoredDimensions && (committedWidth || !hasPixelHeight)
        ? committedHeight
        : undefined,
    maxHeight:
      dragWidth === null && !committedWidth && hasPixelHeight ? committedHeight : undefined,
    aspectRatio: displayDimensions
      ? `${displayDimensions.width} / ${displayDimensions.height}`
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
    <NodeViewWrapper
      as={node.isInline ? 'span' : 'div'}
      className={cn(
        'relative inline-block max-w-full leading-none',
        node.isInline ? 'align-middle' : 'my-4'
      )}
    >
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
        <Button
          type='button'
          variant='ghost'
          size='icon'
          aria-label='Resize image'
          onPointerDown={startResize}
          className='absolute right-0 bottom-0 flex size-10 cursor-nwse-resize touch-none items-end justify-end p-1 sm:size-8'
        >
          <span className='size-3 rounded-[3px] border border-[var(--bg)] bg-[var(--brand-secondary)]' />
        </Button>
      )}
    </NodeViewWrapper>
  )
}

/** Live image node with the drag-to-resize view; same schema + markdown output as the headless one. */
function withImageNodeView(image: Node) {
  return image.extend({
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
        ...(this.parent?.() ?? []),
        new Plugin({
          props: {
            handleClickOn(view, _pos, node, nodePos, event) {
              if (!view.editable || node.type.name !== nodeName) return false
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
              view.dispatch(
                view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos))
              )
              return true
            },
          },
        }),
      ]
    },
  })
}

export const ResizableImage = withImageNodeView(MarkdownImage)
export const ResizableInlineImage = withImageNodeView(MarkdownInlineImage)
