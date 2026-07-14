import { Fragment, type ReactNode } from 'react'

const INLINE_TOKEN =
  /(\*{3}[^\s*](?:[^*\n]*[^\s*])?\*{3}|\*\*[^\s*](?:[^*\n]*[^\s*])?\*\*|\*[^\s*](?:[^*\n]*[^\s*])?\*|`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+\))/g

const LINK_TOKEN = /^\[([^\]\n]+)\]\([^\s)]+\)$/

/**
 * Minimal inline-markdown renderer for agent-group narration rows. Supports
 * `**bold**`, `*italic*`, `***bold-italic***`, `` `code` `` spans, and
 * `[label](url)` links (rendered as their label — narration is prose, not
 * navigation). Emphasis contents and link labels are rendered recursively so
 * nested markers resolve; code spans stay verbatim. Everything else,
 * including unterminated markers, renders as-is. Full Streamdown rendering is
 * intentionally avoided here — these rows re-render on every streaming frame.
 *
 * Splitting on a single capturing group alternates plain text (even indices)
 * and matched tokens (odd indices), so index parity is the exact
 * discriminator — plain text that merely resembles a marker (e.g. `* x *`,
 * rejected by the tokenizer's boundary rules) is never reclassified.
 */
export function renderInlineMarkdown(text: string): ReactNode[] {
  return text.split(INLINE_TOKEN).map((part, i) => (i % 2 === 1 ? renderToken(part, i) : part))
}

function renderToken(part: string, key: number): ReactNode {
  if (part.length > 6 && part.startsWith('***') && part.endsWith('***')) {
    return (
      <strong key={key} className='font-semibold'>
        <em>{renderInlineMarkdown(part.slice(3, -3))}</em>
      </strong>
    )
  }
  if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
    return (
      <strong key={key} className='font-semibold'>
        {renderInlineMarkdown(part.slice(2, -2))}
      </strong>
    )
  }
  if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
    return (
      <span key={key} className='font-mono text-[12px]'>
        {part.slice(1, -1)}
      </span>
    )
  }
  if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
    return <em key={key}>{renderInlineMarkdown(part.slice(1, -1))}</em>
  }
  const link = LINK_TOKEN.exec(part)
  if (link) {
    return <Fragment key={key}>{renderInlineMarkdown(link[1])}</Fragment>
  }
  return part
}
