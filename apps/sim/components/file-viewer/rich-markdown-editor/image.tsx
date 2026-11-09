'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Node } from '@tiptap/core'
import { NodeSelection, Plugin } from '@tiptap/pm/state'
import type { ReactNodeViewProps } from '@tiptap/react'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { type ProsemirrorBinding, ySyncPluginKey } from '@tiptap/y-tiptap'
import {
  MarkdownImage,
  MarkdownInlineImage,
} from '@/components/file-viewer/rich-markdown-editor/image-schema'
import { createImageTargetGuard } from '@/components/file-viewer/rich-markdown-editor/image-target'
import { normalizeLinkHref } from '@/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import styles from '@/components/file-viewer/rich-markdown-editor/node-views.module.css'
import { useEditorEditable } from '@/components/file-viewer/rich-markdown-editor/use-editor-editable'
import { useFileContentSource } from '@/hooks/use-file-content-source'

const MIN_WIDTH = 64

/** A bare pixel count (`"640"`) that needs a `px` suffix, vs. an already-unit'd size (`"50%"`). */
const BARE_PIXEL_SIZE = /^\d+$/
const PIXEL_SIZE = /^\d+(?:\.\d+)?px$/

interface ImageDimensions {
  width: number
  height: number
}

/**
 * The image node view: drag the body to move it, drag the corner handle (shown when selected) to
 * resize. The new width commits to the `width` attribute, which serializes to `<img width>`.
 */
function ResizableImageView({ node, selected, editor, getPos }: ReactNodeViewProps) {
  const source = useFileContentSource()
  const imageRef = useRef<HTMLImageElement>(null)
  const dragAbortRef = useRef<AbortController | null>(null)
  const dragWidthRef = useRef<number | null>(null)
  const [dragging, setDragging] = useState(false)
  /** The live width during a resize, kept out of the document so the resize is one undo step. */
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  /** Measured from the loaded image, to reserve its box when no stored dimensions exist yet. */
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

  const [prevSrc, setPrevSrc] = useState(attrs.src)
  if (prevSrc !== attrs.src) {
    setPrevSrc(attrs.src)
    setFailed(false)
    setMeasuredDimensions(null)
  }

  const startResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    if (event.button !== 0 || dragging) return
    const image = imageRef.current
    if (!image) return
    const binding: ProsemirrorBinding | undefined = ySyncPluginKey.getState(editor.state)?.binding
    const position = binding ? getPos() : undefined
    const currentNode = typeof position === 'number' ? editor.state.doc.nodeAt(position) : null
    const matchesTarget =
      binding && currentNode ? createImageTargetGuard(binding, currentNode) : undefined
    /** A node view can be reused for a replacement image, even with identical attributes. */
    const isCurrentTarget = () => {
      if (!binding) return true
      const at = getPos()
      return (
        matchesTarget !== undefined &&
        typeof at === 'number' &&
        matchesTarget(editor.state.doc.nodeAt(at))
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
        const at = getPos()
        if (typeof at !== 'number') return
        const tr = editor.state.tr
          .setNodeAttribute(at, 'width', String(finalWidth))
          .setNodeAttribute(at, 'height', null)
        editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, at)))
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
  const storedDimensions = useMemo(
    () => source.getImageDimensions?.(attrs.src) ?? null,
    [source, attrs.src]
  )
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
  const displayHeight =
    dragWidth === null && !authoredDimensions && (committedWidth || !hasPixelHeight)
      ? committedHeight
      : undefined
  const displayMaxHeight =
    dragWidth === null && !committedWidth && hasPixelHeight ? committedHeight : undefined
  const aspectRatio = displayDimensions
    ? `${displayDimensions.width} / ${displayDimensions.height}`
    : undefined

  /** Width and aspect ratio reserve a responsive box the image cannot reflow out of. */
  useLayoutEffect(() => {
    const image = imageRef.current
    if (!image) return
    image.style.width = displayWidth ?? ''
    image.style.height = displayHeight ?? ''
    image.style.maxHeight = displayMaxHeight ?? ''
    image.style.aspectRatio = aspectRatio ?? ''
  }, [displayWidth, displayHeight, displayMaxHeight, aspectRatio])

  const safeHref = normalizeLinkHref(typeof attrs.href === 'string' ? attrs.href : '')
  const editable = useEditorEditable(editor)

  const image = (
    <img
      ref={imageRef}
      src={source.resolveImageSrc(attrs.src)}
      alt={attrs.alt ?? ''}
      title={attrs.title ?? undefined}
      draggable={editable}
      data-drag-handle={editable ? '' : undefined}
      data-editable={editable || undefined}
      data-failed={failed || undefined}
      className={styles.image}
      onError={() => setFailed(true)}
      onLoad={(event) => {
        setFailed(false)
        const { naturalWidth, naturalHeight } = event.currentTarget
        if (naturalWidth <= 0 || naturalHeight <= 0) return
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
    />
  )

  return (
    <NodeViewWrapper as={node.isInline ? 'span' : 'div'}>
      <span className={styles.imageFrame} data-inline={node.isInline || undefined}>
        {safeHref ? (
          // The editor's click handler navigates (on a modifier or when read-only); a plain click selects.
          <a
            href={safeHref}
            target='_blank'
            rel='noopener noreferrer'
            className={styles.imageLink}
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
            className={styles.resizeHandle}
            onPointerDown={startResize}
          >
            <span className={styles.resizeKnob} />
          </button>
        )}
      </span>
    </NodeViewWrapper>
  )
}

/** An image node with the move and resize view; the same schema and Markdown as the headless one. */
function withImageNodeView(image: Node) {
  return image.extend({
    addNodeView() {
      return ReactNodeViewRenderer(ResizableImageView)
    },
    /** A plain click on the image always selects it, though its body is also a drag source. */
    addProseMirrorPlugins() {
      const nodeName = this.name
      return [
        ...(this.parent?.() ?? []),
        new Plugin({
          props: {
            handleClickOn(view, _pos, clicked, nodePos, event) {
              if (!view.editable || clicked.type.name !== nodeName) return false
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
