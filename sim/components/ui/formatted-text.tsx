'use client'

import { ReactNode } from 'react'

/**
 * Formats text by highlighting block references (<...>) and environment variables ({{...}})
 * Used in code editor, long inputs, and short inputs for consistent syntax highlighting
 */
export function formatDisplayText(text: string): ReactNode[] {
  if (!text) return []

  // Split the text by both tag patterns <something.something> and {{ENV_VAR}}
  const parts = text.split(/(<[^>]+>|\{\{[^}]+\}\})/g)

  return parts.map((part, index) => {
    // Handle block references
    if (part.startsWith('<') && part.endsWith('>')) {
      return (
        <span key={index} className="text-blue-500">
          {part}
        </span>
      )
    }

    // Handle environment variables
    if (part.match(/^\{\{[^}]+\}\}$/)) {
      return (
        <span key={index} className="text-blue-500">
          {part}
        </span>
      )
    }

    return <span key={index}>{part}</span>
  })
}
