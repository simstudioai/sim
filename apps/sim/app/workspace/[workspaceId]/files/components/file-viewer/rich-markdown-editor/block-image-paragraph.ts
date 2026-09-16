import type { JSONContent } from '@tiptap/core'

/** Image-only paragraphs remain blocks; images beside text need an inline representation. */
export function splitBlockImageParagraph(node: JSONContent): JSONContent[] {
  if (node.type !== 'paragraph' || !node.content?.some((child) => child.type === 'image')) {
    return [node]
  }
  if (
    node.content.some(
      (child) =>
        child.type !== 'image' &&
        (child.type !== 'text' || child.text?.trim() || child.marks?.length)
    )
  ) {
    return [
      {
        ...node,
        content: node.content.map((child) =>
          child.type === 'image' ? { ...child, type: 'inlineImage' } : child
        ),
      },
    ]
  }
  return node.content.filter((child) => child.type === 'image')
}
