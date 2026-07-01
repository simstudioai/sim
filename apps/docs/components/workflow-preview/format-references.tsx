import type { ReactNode } from 'react'

/** Block references `<block.field>` and environment variables `{{VAR}}`. */
const REFERENCE_PATTERN = /(<[^<>]+>|\{\{[^{}]+\}\})/g

/**
 * Highlights `<...>` block references and `{{...}}` environment variables in
 * brand-secondary, mirroring the editor's `formatDisplayText`. Read-only and
 * static — no validation or tag interactivity, since docs has no workflow state.
 */
export function formatReferences(text: string): ReactNode[] {
  if (!text) return []
  return text.split(REFERENCE_PATTERN).map((part, index) => {
    if (!part) return null
    const isReference =
      (part.startsWith('<') && part.endsWith('>')) || (part.startsWith('{{') && part.endsWith('}}'))
    return isReference ? (
      <span key={index} className='text-[var(--brand-secondary)]'>
        {part}
      </span>
    ) : (
      <span key={index}>{part}</span>
    )
  })
}
