const HIDDEN_INLINE_REFERENCE_PATTERN =
  /`[^`\n]*(?:internal\/tool-results\/|internal\/blocktips\/|components\/integrations\/[^`\n]*README)[^`\n]*`/g

/** JSON strings own their escaped quotes, backticks, and any quoted tag markers. */
const JSON_STRING_SOURCE = String.raw`"(?:[^"\\\r\n]|\\[^\r\n])*"`

/**
 * Complete chip tags consume JSON strings atomically. Outside strings, a new
 * opener or backtick ends the candidate, so prose mentions cannot join into a
 * tag and repeated unclosed openers cannot repeatedly scan the same suffix.
 */
const COMPLETE_TAG_SOURCE = `<(?<chipTag>workspace_resource|source)>\\s*\\{(?:${JSON_STRING_SOURCE}|[^"\`<])*?\\}\\s*</\\k<chipTag>>`

const CHIP_OR_CODE_DELIMITER = new RegExp(`${COMPLETE_TAG_SOURCE}|\`|\n`, 'g')

/**
 * Pair Markdown delimiters outside chip payloads in one forward pass. A pair
 * containing a chip is unwrapped; a lone delimiter is removed only when flush
 * against a chip. Neighbouring code spans and multiline fences keep their pairs.
 */
export function sanitizeChatDisplayContent(content: string): string {
  const removedDelimiters: number[] = []
  let openingTick = -1
  let containsChip = false
  let adjacentToChip = false
  let lastChipEnd = -1

  for (const match of content.matchAll(CHIP_OR_CODE_DELIMITER)) {
    const index = match.index
    if (match.groups?.chipTag) {
      if (openingTick !== -1) {
        containsChip = true
        adjacentToChip ||= index === openingTick + 1
      }
      lastChipEnd = index + match[0].length
      continue
    }

    if (match[0] === '\n') {
      if (openingTick !== -1 && adjacentToChip) removedDelimiters.push(openingTick)
      openingTick = -1
      lastChipEnd = -1
      continue
    }

    if (openingTick === -1) {
      openingTick = index
      containsChip = false
      adjacentToChip = lastChipEnd === index
    } else {
      if (containsChip) removedDelimiters.push(openingTick, index)
      openingTick = -1
    }
  }

  if (openingTick !== -1 && adjacentToChip) removedDelimiters.push(openingTick)

  const parts: string[] = []
  let start = 0
  for (const index of removedDelimiters) {
    parts.push(content.slice(start, index))
    start = index + 1
  }
  parts.push(content.slice(start))
  return parts.join('').replace(HIDDEN_INLINE_REFERENCE_PATTERN, '')
}
