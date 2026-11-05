import type { ReactNode } from 'react'
import { extractTextContent } from '@/lib/core/utils/react-node-text'

/** A rendered node's text, as a code block's copy button needs it. */
export function nodeText(node: ReactNode): string {
  return extractTextContent(node)
}
