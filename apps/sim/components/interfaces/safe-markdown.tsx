'use client'

import { Streamdown } from 'streamdown'
import 'streamdown/styles.css'

/**
 * Markdown renderer for interface pages. Uses Streamdown (no raw HTML injection).
 */
export function SafeMarkdown({ content }: { content: string }) {
  return (
    <div className='max-w-none font-sans text-[var(--text-primary)] text-sm leading-relaxed [&_a]:underline'>
      <Streamdown>{content}</Streamdown>
    </div>
  )
}
