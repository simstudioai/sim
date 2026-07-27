import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/** The text of the document's leading heading (any level), or null when the first block isn't a heading. */
export function firstHeadingTitle(doc: ProseMirrorNode): string | null {
  const first = doc.firstChild
  if (!first || first.type.name !== 'heading') return null
  const text = first.textContent.trim()
  return text.length > 0 ? text : null
}
