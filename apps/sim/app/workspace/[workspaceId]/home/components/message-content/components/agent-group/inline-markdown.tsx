import type { ReactNode } from 'react'

const INLINE_TOKEN = /(\*\*[^*\n]+\*\*|\*\S(?:[^*\n]*\S)?\*|`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+\))/g

const LINK_TOKEN = /^\[([^\]\n]+)\]\([^\s)]+\)$/

/**
 * Minimal inline-markdown renderer for agent-group narration rows. Supports
 * `**bold**`, `*italic*`, `` `code` `` spans, and `[label](url)` links
 * (rendered as their label — narration is prose, not navigation). Everything
 * else, including unterminated markers, renders verbatim. Full Streamdown
 * rendering is intentionally avoided here — these rows re-render on every
 * streaming frame.
 */
export function renderInlineMarkdown(text: string): ReactNode[] {
  const parts = text.split(INLINE_TOKEN)
  return parts.map((part, i) => {
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className='font-semibold'>
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      return (
        <span key={i} className='font-mono text-[12px]'>
          {part.slice(1, -1)}
        </span>
      )
    }
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    const link = LINK_TOKEN.exec(part)
    if (link) {
      return link[1]
    }
    return part
  })
}
