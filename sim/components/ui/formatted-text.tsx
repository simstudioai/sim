'use client'

import { ReactNode } from 'react'

/**
 * Formats text by highlighting block references (<...>) and environment variables ({{...}})
 * Used in code editor, long inputs, and short inputs for consistent syntax highlighting
 * 
 * @param text The text to format
 * @param stripQuotes Whether to strip unnecessary quotes from the text (for plain text variables)
 */
export function formatDisplayText(text: string, stripQuotes: boolean = false): ReactNode[] {
  if (!text) return []

  // If stripQuotes is true, remove surrounding quotes that might have been added
  // This is needed when displaying plain type variables in inputs
  let processedText = text;
  if (stripQuotes && typeof text === 'string') {
    // Check if the text is a quoted string (starts and ends with quotes)
    if ((text.startsWith('"') && text.endsWith('"')) || 
        (text.startsWith("'") && text.endsWith("'"))) {
      // Remove the quotes but make sure there's at least one character between them
      if (text.length > 2) {
        processedText = text.slice(1, -1);
      }
    }
  }

  // Split the text by both tag patterns <something.something> and {{ENV_VAR}}
  const parts = processedText.split(/(<[^>]+>|\{\{[^}]+\}\})/g)

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
