const HIDDEN_INLINE_REFERENCE_PATTERN =
  /`[^`\n]*(?:internal\/tool-results\/|internal\/blocktips\/|components\/integrations\/[^`\n]*README)[^`\n]*`/g

/** JSON strings own their escaped quotes, backticks, and quoted tag markers. */
const JSON_STRING_SOURCE = '"(?:\\\\(?:["\\\\/bfnrt]|u[0-9a-fA-F]{4})|[^"\\\\\\r\\n])*"'

/** Unquoted openers, backticks, and invalid backslashes bound failed payload scans. */
const COMPLETE_TAG_SOURCE = `<(?<chipTag>workspace_resource|source)>\\s*\\{(?:${JSON_STRING_SOURCE}|[^"\`<\\\\])*?\\}\\s*</\\k<chipTag>>`

const INLINE_CHIP_OR_DELIMITER = new RegExp(`${COMPLETE_TAG_SOURCE}|\`+|\\n`, 'g')
const CHIP_OR_PARAGRAPH_BREAK = new RegExp(`${COMPLETE_TAG_SOURCE}|\\n[\\t \\r]*\\n`, 'g')

interface OpenCodeSpan {
  index: number
  containsChip: boolean
  touchesChip: boolean
}

/** Only matched multi-backtick runs are code; an unmatched run remains ordinary prose. */
function unwrapInlineParagraph(content: string): string {
  const remainingRuns = new Map<number, number>()
  for (const [value] of content.matchAll(INLINE_CHIP_OR_DELIMITER)) {
    if (value.startsWith('`') && value.length > 1) {
      remainingRuns.set(value.length, (remainingRuns.get(value.length) ?? 0) + 1)
    }
  }
  const removedDelimiters: number[] = []
  let openSpan: OpenCodeSpan | null = null
  let previousChipEnd = -1
  let protectedRunLength: number | null = null

  const finishLine = () => {
    if (openSpan?.touchesChip) removedDelimiters.push(openSpan.index)
    openSpan = null
  }

  for (const token of content.matchAll(INLINE_CHIP_OR_DELIMITER)) {
    const [value] = token
    const index = token.index
    if (value === '\n') {
      finishLine()
      previousChipEnd = -1
    } else if (value.startsWith('`')) {
      if (value.length > 1) {
        remainingRuns.set(value.length, (remainingRuns.get(value.length) ?? 1) - 1)
      }
      if (protectedRunLength !== null) {
        if (value.length === protectedRunLength) protectedRunLength = null
        continue
      }
      if (value.length > 1) {
        if (!openSpan && remainingRuns.get(value.length)) protectedRunLength = value.length
        continue
      }
      if (openSpan) {
        if (openSpan.containsChip) removedDelimiters.push(openSpan.index, index)
        openSpan = null
      } else {
        openSpan = { index, containsChip: false, touchesChip: previousChipEnd === index }
      }
    } else {
      if (openSpan) {
        openSpan.containsChip = true
        openSpan.touchesChip ||= index === openSpan.index + 1
      }
      previousChipEnd = index + value.length
    }
  }
  finishLine()

  const parts: string[] = []
  let cursor = 0
  for (const index of removedDelimiters) {
    parts.push(content.slice(cursor, index))
    cursor = index + 1
  }
  parts.push(content.slice(cursor))
  return parts.join('')
}

/** Paragraph breaks end inline spans, but blank lines inside chip JSON belong to the payload. */
function unwrapInlineChips(content: string): string {
  const parts: string[] = []
  let cursor = 0

  for (const match of content.matchAll(CHIP_OR_PARAGRAPH_BREAK)) {
    if (!match[0].startsWith('\n')) continue
    parts.push(unwrapInlineParagraph(content.slice(cursor, match.index)), match[0])
    cursor = match.index + match[0].length
  }
  parts.push(unwrapInlineParagraph(content.slice(cursor)))
  return parts.join('')
}

/** Fenced blocks are literal, including unclosed streaming fences and longer closing runs. */
export function sanitizeChatDisplayContent(content: string): string {
  const parts: string[] = []
  let cursor = 0
  let fenceStart: number | null = null
  let fence = ''

  for (const line of content.matchAll(/^ {0,3}(`{3,}|~{3,})([^\n]*)(?:\n|$)/gm)) {
    const [, delimiter, info] = line
    if (fenceStart === null) {
      if (delimiter[0] === '`' && info.includes('`')) continue
      fenceStart = line.index
      fence = delimiter
    } else if (
      delimiter[0] === fence[0] &&
      delimiter.length >= fence.length &&
      /^[\t \r]*$/.test(info)
    ) {
      const end = line.index + line[0].length
      parts.push(
        unwrapInlineChips(content.slice(cursor, fenceStart)),
        content.slice(fenceStart, end)
      )
      cursor = end
      fenceStart = null
    }
  }

  if (fenceStart === null) {
    parts.push(unwrapInlineChips(content.slice(cursor)))
  } else {
    parts.push(unwrapInlineChips(content.slice(cursor, fenceStart)), content.slice(fenceStart))
  }
  return parts.join('').replace(HIDDEN_INLINE_REFERENCE_PATTERN, '')
}
