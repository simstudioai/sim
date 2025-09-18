'use client'

import type { ReactNode } from 'react'

/**
 * Formats text by highlighting block references (<...>) and environment variables ({{...}})
 * Used in code editor, long inputs, and short inputs for consistent syntax highlighting
 *
 * @param text The text to format
 */
export function formatDisplayText(text: string): ReactNode[] {
  if (!text) return []

  const parts = text.split(/(<[^>]+>|\{\{[^}]+\}\})/g)

  return parts.map((part, index) => {
    if (part.startsWith('<') && part.endsWith('>')) {
      return (
        <span key={index} className='text-blue-500'>
          {part}
        </span>
      )
    }

    if (part.match(/^\{\{[^}]+\}\}$/)) {
      return (
        <span key={index} className='text-blue-500'>
          {part}
        </span>
      )
    }

    return <span key={index}>{part}</span>
  })
}
