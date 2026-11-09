import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'

/** The text of the document's leading heading (any level), or null when the first block isn't a heading. */
export function firstHeadingTitle(doc: ProseMirrorNode): string | null {
  const first = doc.firstChild
  if (!first || first.type.name !== 'heading') return null
  const text = first.textContent.trim()
  return text.length > 0 ? text : null
}

/** True while the selection head sits inside the document's leading heading. */
export function isSelectionInLeadingHeading(state: EditorState): boolean {
  const { $head } = state.selection
  return $head.depth > 0 && $head.index(0) === 0 && state.doc.firstChild?.type.name === 'heading'
}
