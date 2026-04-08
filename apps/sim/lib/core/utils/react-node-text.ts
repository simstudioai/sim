import { isValidElement, type ReactNode } from 'react'

/**
 * Recursively extracts plain text content from a React node tree.
 */
export function extractTextContent(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (!node) return ''
  if (Array.isArray(node)) return node.map(extractTextContent).join('')
  if (isValidElement(node))
    return extractTextContent((node.props as { children?: ReactNode }).children)
  return ''
}
