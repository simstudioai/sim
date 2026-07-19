import { useEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import type { JSONContent } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'
import { NodeSelection, Plugin } from '@tiptap/pm/state'
import type { ReactNodeViewProps } from '@tiptap/react'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { useFileContentSource } from '@/hooks/use-file-content-source'
import { normalizeLinkHref } from './markdown-fidelity'
import { useEditorEditable } from './use-editor-editable'

const MIN_WIDTH = 64

/**
 * A markdown linked image `[![alt](src "t")](href "t2")` — an image wrapped in a link, the canonical
 * form of a README badge. `@tiptap/markdown` parses this as a link mark over an image node, but an
 * image node can't carry inline marks, so the wrapping link is silently dropped. We instead tokenize
 * the whole construct ourselves and hang the link target on the image node's `href` attribute, so it
 * round-trips losslessly (and the file stays editable rather than opening read-only).
 */
const LINKED_IMAGE_RE =
  /^\[!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/

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
 * it does — standard markdown has no width syntax, so a resized image must round-trip as HTML to
 * preserve its dimensions. Unsized images stay clean `![alt](src)`. An image with an `href` is
 * wrapped in a markdown link so a linked badge round-trips as `[![alt](src)](href)`.
 *
 * A *sized **and** linked* image is the one case markdown can't represent: the linked-image tokenizer
 * only recognizes `[![alt](src)](href)`, so emitting `[<img …>](href)` would silently drop the link on
 * reparse (and the round-trip-safety probe wouldn't catch it). We keep the link and fall back to the
 * unsized `[![alt](src)](href)` form — the link matters more than the exact dimensions for a badge.
 */
function imageMarkdown(node: JSONContent): string {
  const attrs = node.attrs ?? {}
  const src = typeof attrs.src === 'string' ? attrs.src : ''
  const alt = typeof attrs.alt === 'string' ? attrs.alt : ''
  const title = typeof attrs.title === 'string' ? attrs.title : ''
  const href = typeof attrs.href === 'string' ? attrs.href : ''
  const hrefTitle = typeof attrs.hrefTitle === 'string' ? attrs.hrefTitle : ''
  const width = attrs.width
  const height = attrs.height
  let image: string
  if ((width || height) && !href) {
    const parts = [`src="${escapeAttr(src)}"`]
    if (alt) parts.push(`alt="${escapeAttr(alt)}"`)
    if (title) parts.push(`title="${escapeAttr(title)}"`)
    if (width) parts.push(`width="${escapeAttr(String(width))}"`)
    if (height) parts.push(`height="${escapeAttr(String(height))}"`)
    image = `<img ${parts.join(' ')}>`
  } else {
    // Escape so an alt with `]`/`[` or a title with `"` can't break out of the `![…](… "…")` syntax
    // and corrupt the round-trip; a src with spaces/parens goes in angle brackets (CommonMark).
    const titlePart = title ? ` "${title.replace(/["\\]/g, '\\$&')}"` : ''
    const safeSrc = /[\s()]/.test(src) ? `<${src}>` : src
    image = `![${alt.replace(/[\\[\]]/g, '\\$&')}](${safeSrc}${titlePart})`
  }
  if (!href) return image
  // Escape `"`/`\` so an href title can't break out of the `[…](href "title")` syntax (mirrors the
  // image title escaping above).
  const hrefTitlePart = hrefTitle ? ` "${hrefTitle.replace(/["\\]/g, '\\$&')}"` : ''
  return `[${image}](${href}${hrefTitlePart})`
}

interface MarkdownImageToken {
  /** Set only by our linked-image tokenizer; absent on the built-in `![](src)` token. */
  src?: string
  alt?: string
  title?: string | null
  /** Built-in image token holds the source URL here; our linked token holds the link target. */
  href?: string
  hrefTitle?: string | null
  /** Built-in image token holds the alt text here. */
  text?: string
}

/** Map both the built-in image token and our linked-image token onto the image node's attributes. */
function parseImageToken(token: MarkdownImageToken): JSONContent {
  const isLinked = typeof token.src === 'string'
  return {
    type: 'image',
    attrs: isLinked
      ? {
          src: token.src,
          alt: token.alt ?? '',
          title: token.title ?? null,
          href: token.href ?? null,
          hrefTitle: token.hrefTitle ?? null,
        }
      : {
          src: token.href ?? '',
          alt: token.text ?? '',
          title: token.title ?? null,
          href: null,
          hrefTitle: null,
        },
  }
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

/** Link target of a linked image — markdown-only state, never emitted as an HTML `<img>` attribute. */
const hrefAttr = { default: null, rendered: false }
const hrefTitleAttr = { default: null, rendered: false }

/**
 * Image node that carries optional `width`/`height` (serialized as an HTML `<img>` tag) and an
 * optional `href`/`hrefTitle` (a wrapping markdown link, for badges). Shared by the headless
 * round-trip path (no node view) and the live {@link ResizableImage}.
 */
export const MarkdownImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: widthAttr,
      height: heightAttr,
      href: hrefAttr,
      hrefTitle: hrefTitleAttr,
    }
  },
  markdownTokenizer: {
    name: 'image',
    level: 'inline',
    start: (src: string) => src.indexOf('[!['),
    tokenize: (src: string): (MarkdownImageToken & { type: string; raw: string }) | undefined => {
      const match = LINKED_IMAGE_RE.exec(src)
      if (!match) return undefined
      return {
        type: 'image',
        raw: match[0],
        alt: match[1] ?? '',
        src: match[2],
        title: match[3] ?? null,
        href: match[4],
        hrefTitle: match[5] ?? null,
      }
    },
  },
  parseMarkdown: parseImageToken,
  renderMarkdown: imageMarkdown,
})

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
