import type { SafeXmlNode } from '../parser/xml-parser'

/**
 * Check whether a shape-like node contains a placeholder definition.
 */
export function isPlaceholder(node: SafeXmlNode): boolean {
  const nvSpPr = node.child('nvSpPr')
  if (nvSpPr.exists()) {
    const nvPr = nvSpPr.child('nvPr')
    if (nvPr.child('ph').exists()) return true
  }
  const nvPicPr = node.child('nvPicPr')
  if (nvPicPr.exists()) {
    const nvPr = nvPicPr.child('nvPr')
    if (nvPr.child('ph').exists()) return true
  }
  return false
}

/**
 * Parse all attributes of a node into a local-name keyed map.
 */
export function parseAllAttributes(node: SafeXmlNode): Map<string, string> {
  const result = new Map<string, string>()
  const el = node.element
  if (!el) return result
  const attrs = el.attributes
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i]
    result.set(attr.localName, attr.value)
  }
  return result
}
