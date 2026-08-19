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
  let sourceOffset = 0
  return text.split(REFERENCE_PATTERN).map((part) => {
    const partOffset = sourceOffset
    sourceOffset += part.length
    if (!part) return null
    const isReference =
      (part.startsWith('<') && part.endsWith('>')) || (part.startsWith('{{') && part.endsWith('}}'))
    return isReference ? (
      <span key={partOffset} className='text-[var(--brand-secondary)]'>
        {part}
      </span>
    ) : (
      <span key={partOffset}>{part}</span>
    )
  })
}
