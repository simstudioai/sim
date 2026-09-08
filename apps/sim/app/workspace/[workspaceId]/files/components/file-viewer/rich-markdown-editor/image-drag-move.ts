import { Fragment, Slice } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import { dropPoint } from '@tiptap/pm/transform'
import type { EditorView } from '@tiptap/pm/view'
import { isImageNode } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-node'
import { htmlReferencesSrc } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-paste'

interface MoveDraggedImageOptions {
  /** Image files on the drop, from `extractImageFiles`. */
  images: File[]
  /** The drop's `text/html`, which the browser enriches with the dragged node's rendered src. */
  html: string
  /**
   * Maps a node's stored `src` to the URL actually rendered into `<img src>`, when the host rewrites
   * it (the file editor's display-layer resolve). Omit where stored and rendered are the same.
   */
  resolveSrc?: (src: string | undefined) => string | undefined
}

/**
 * Repositions an image the user dragged from inside this editor, returning true when it consumed
 * the drop.
 *
 * TipTap's image node view runs its own `dragstart`, which bypasses ProseMirror's clipboard
 * serialization — no PM `text/html`, and `view.dragging` never set — so neither ProseMirror's default
 * move nor the `slice` argument to `handleDrop` sees anything. What survives is a NodeSelection on the
 * dragged image plus the browser's native enrichment, whose html carries the absolute rendered URL of
 * exactly that node. That pair is the signal, and without acting on it the drop falls through to the
 * upload path and stores a second copy of an image the document already has.
 *
 * The move is the same shape as ProseMirror's own: compute the drop point against the pre-delete doc,
 * delete the source, then map the insert position through that delete. A null `dropPoint` (no valid
 * insertion point) is a handled no-op — the node stays put, still selected — rather than a raw-position
 * fallback, which `tr.insert` can throw on.
 *
 * The gate accepts at most one file rather than exactly one: some drag transports carry the html
 * alone. A genuinely external drop can never reference the currently selected node's own rendered src.
 */
export function moveDraggedImageNode(
  view: EditorView,
  event: DragEvent,
  { images, html, resolveSrc }: MoveDraggedImageOptions
): boolean {
  const { selection } = view.state
  if (images.length > 1) return false
  if (!(selection instanceof NodeSelection) || !isImageNode(selection.node)) return false

  const src = selection.node.attrs.src
  const rendered = typeof src === 'string' ? (resolveSrc?.(src) ?? src) : undefined
  if (!htmlReferencesSrc(html, rendered)) return false

  event.preventDefault()
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (!coords) return true

  const $drop = view.state.doc.resolve(coords.pos)
  const { image, inlineImage } = view.state.schema.nodes
  const type = $drop.parent.canReplaceWith($drop.index(), $drop.index(), inlineImage)
    ? inlineImage
    : image
  const node =
    selection.node.type === type
      ? selection.node
      : type.create(selection.node.attrs, null, selection.node.marks)
  const tr = view.state.tr
  const insertPos = dropPoint(view.state.doc, coords.pos, new Slice(Fragment.from(node), 0, 0))
  if (insertPos === null) return true

  tr.delete(selection.from, selection.to)
  const mapped = tr.mapping.map(insertPos)
  tr.insert(mapped, node)
  tr.setSelection(NodeSelection.create(tr.doc, mapped))
  view.dispatch(tr.scrollIntoView())
  return true
}
