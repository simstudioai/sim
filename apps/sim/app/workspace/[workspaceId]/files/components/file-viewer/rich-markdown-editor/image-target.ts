import { Node } from '@tiptap/pm/model'
import type { ProsemirrorBinding } from '@tiptap/y-tiptap'
import { XmlElement } from 'yjs'

function getImageYTarget(binding: ProsemirrorBinding, node: Node): XmlElement | undefined {
  for (const [type, mappedNode] of binding.mapping) {
    if (mappedNode === node && type instanceof XmlElement) return type
  }
}

/**
 * Yjs reconciliation can reuse images and their containers during a reorder. Require unchanged
 * other images throughout the document; text edits and the target's own metadata remain compatible.
 */
export function createImageTargetGuard(binding: ProsemirrorBinding, node: Node) {
  const target = getImageYTarget(binding, node)
  const parent = target?.parent
  const images = () =>
    Array.from(
      binding.type.createTreeWalker(
        (child) => child instanceof XmlElement && ['image', 'inlineImage'].includes(child.nodeName)
      )
    )
  const originalImages = images().map((element) => ({
    element,
    node: binding.mapping.get(element),
  }))
  const source = target?.getAttribute('src')
  return (currentNode: Node | null): boolean => {
    if (
      !target ||
      !currentNode ||
      target.parent !== parent ||
      binding.mapping.get(target) !== currentNode ||
      target.getAttribute('src') !== source
    )
      return false
    const currentImages = images()
    return (
      originalImages.length === currentImages.length &&
      originalImages.every(({ element, node }, index) => {
        if (element !== currentImages[index]) return false
        if (element === target) return true
        const current = binding.mapping.get(element)
        return node instanceof Node && current instanceof Node && node.eq(current)
      })
    )
  }
}
