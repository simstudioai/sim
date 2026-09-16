import type { Node } from '@tiptap/pm/model'

export function isImageNode(node: { type: { name: string } }): boolean {
  return node.type.name === 'image' || node.type.name === 'inlineImage'
}

/** Insert images inside headings without changing the existing block-image insertion elsewhere. */
export function imageTypeAt(doc: Node, position: number): 'image' | 'inlineImage' {
  const parent = doc.resolve(position).parent
  return parent.type.name === 'heading' ? 'inlineImage' : 'image'
}
