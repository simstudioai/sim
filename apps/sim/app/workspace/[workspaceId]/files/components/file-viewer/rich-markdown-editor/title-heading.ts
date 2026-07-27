import type { JSONContent } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/** The text of the document's leading heading (any level), or null when the first block isn't a heading. */
export function firstHeadingTitle(doc: ProseMirrorNode): string | null {
  const first = doc.firstChild
  if (!first || first.type.name !== 'heading') return null
  const text = first.textContent.trim()
  return text.length > 0 ? text : null
}

/** A level-1 heading node carrying `title`, used to seed a document's title from the file name. */
export function titleHeadingNode(title: string): JSONContent {
  return { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] }
}
