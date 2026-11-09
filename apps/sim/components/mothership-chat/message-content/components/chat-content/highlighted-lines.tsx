import { memo } from 'react'

/**
 * Partition Prism output after highlighting the entire fence, so multiline
 * grammar state stays intact. Reopen crossing spans on each line: React can
 * retain unchanged line HTML instead of replacing every token in the fence.
 * This accepts only Prism's generated spans, never raw code or arbitrary HTML.
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = []
  const openSpans: string[] = []
  let line = ''
  let offset = 0
  for (const match of html.matchAll(/<span\b[^>]*>|<\/span>|\n/g)) {
    line += html.slice(offset, match.index)
    const token = match[0]
    offset = match.index + token.length
    if (token === '\n') {
      lines.push(`${line}${'</span>'.repeat(openSpans.length)}\n`)
      line = openSpans.join('')
    } else {
      if (token === '</span>') openSpans.pop()
      else openSpans.push(token)
      line += token
    }
  }
  lines.push(line + html.slice(offset))
  return lines
}

interface HighlightedLineProps {
  html: string
}

const HighlightedLine = memo(function HighlightedLine({ html }: HighlightedLineProps) {
  return <span dangerouslySetInnerHTML={{ __html: html }} />
})

interface HighlightedLinesProps {
  html: string
}

export function HighlightedLines({ html }: HighlightedLinesProps) {
  return splitHighlightedLines(html).map((line, index) => (
    <HighlightedLine key={index} html={line} />
  ))
}
