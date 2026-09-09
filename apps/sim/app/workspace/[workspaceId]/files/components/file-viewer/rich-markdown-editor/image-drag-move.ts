import { Fragment, Slice } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import { dropPoint } from '@tiptap/pm/transform'
import type { EditorView } from '@tiptap/pm/view'
import { isImageNode } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-node'

/** Adapt a single image between block and inline destinations; leave all other drops to ProseMirror. */
export function moveDraggedImageNode(
  view: EditorView,
  event: DragEvent,
  slice: Slice,
  moved: boolean
): boolean {
  const image = slice.content.firstChild
  if (
    slice.openStart ||
    slice.openEnd ||
    slice.content.childCount !== 1 ||
    !image ||
    !isImageNode(image)
  ) {
    return false
  }
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (!coords) return false
  const $drop = view.state.doc.resolve(coords.pos)
  const { image: blockImage, inlineImage } = view.state.schema.nodes
  if (!blockImage || !inlineImage) return false
  const type = $drop.parent.canReplaceWith($drop.index(), $drop.index(), inlineImage)
    ? inlineImage
    : blockImage
  if (image.type === type) return false

  /** Tiptap's data-drag-handle selects the dragged image before ProseMirror starts the drag. */
  const source = view.state.selection
  /** Do not delete a replacement selection if the dragged image changed or disappeared. */
  if (moved && (!view.dragging || !(source instanceof NodeSelection) || !source.node.eq(image))) {
    return true
  }
  const node = type.create(image.attrs, null, image.marks)
  const insertPos = dropPoint(view.state.doc, coords.pos, new Slice(Fragment.from(node), 0, 0))
  if (insertPos === null) return true

  const tr = view.state.tr
  if (moved) tr.delete(source.from, source.to)
  const mapped = tr.mapping.map(insertPos)
  tr.insert(mapped, node)
  tr.setSelection(NodeSelection.create(tr.doc, mapped))
  view.focus()
  view.dispatch(tr.setMeta('uiEvent', 'drop'))
  return true
}
