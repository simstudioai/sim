'use client'

import type { ReactNode } from 'react'
import { normalizeBlockName } from '@/stores/workflows/utils'

export interface HighlightContext {
  accessiblePrefixes?: Set<string>
  highlightAll?: boolean
}

const SYSTEM_PREFIXES = new Set(['start', 'loop', 'parallel', 'variable'])

/**
 * Formats text by highlighting block references (<...>) and environment variables ({{...}})
 * Used in code editor, long inputs, and short inputs for consistent syntax highlighting
 */
export function formatDisplayText(text: string, context?: HighlightContext): ReactNode[] {
  if (!text) return []

  const shouldHighlightPart = (part: string): boolean => {
    if (!part.startsWith('<') || !part.endsWith('>')) {
      return false
    }

    if (context?.highlightAll) {
      return true
    }

    const inner = part.slice(1, -1)
    const [prefix] = inner.split('.')
    const normalizedPrefix = normalizeBlockName(prefix)

    if (SYSTEM_PREFIXES.has(normalizedPrefix)) {
      return true
    }

    if (context?.accessiblePrefixes?.has(normalizedPrefix)) {
      return true
    }

    return false
  }

  const parts = text.split(/(<[^>]+>|\{\{[^}]+\}\})/g)

  return parts.map((part, index) => {
    if (shouldHighlightPart(part) || part.match(/^\{\{[^}]+\}\}$/)) {
      return (
        <span key={index} className='text-blue-500'>
          {part}
        </span>
      )
    }

    return <span key={index}>{part}</span>
  })
}
