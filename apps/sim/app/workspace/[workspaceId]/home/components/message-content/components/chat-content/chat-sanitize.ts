const HIDDEN_INLINE_REFERENCE_PATTERN =
  /`[^`\n]*(?:internal\/tool-results\/|internal\/blocktips\/|components\/integrations\/[^`\n]*README)[^`\n]*`/g
const WORKSPACE_RESOURCE_CODE_SPAN_PATTERN =
  /`([^`\n]*<workspace_resource>[^`]*?<\/workspace_resource>[^`\n]*)`/g

/**
 * A stray backtick on ONE side of a complete resource tag, which would still
 * stop the chip rendering after the balanced case above is unwrapped.
 *
 * All three patterns forbid a backtick between opener and closer, and that is
 * the load-bearing part. It separates a real tag from prose MENTIONING the tag
 * name: a payload is JSON and carries no backticks, whereas a message explaining
 * the syntax writes an opener and a closer as two separately backticked spans
 * with prose between them. Without the restriction, that prose reads as one
 * wrapped tag and its outer backticks are stripped — or a lone mention loses its
 * opening backtick — leaving an unpaired one that opens a code span running to
 * the next backtick, inverting every code span in the rest of the message.
 *
 * The trade: a resource whose title or path itself contains a backtick will not
 * have wrapping backticks stripped, so it renders as text rather than a chip.
 * That is the better failure. Prose explaining the tag is common and its damage
 * is message-wide; a backtick inside a filename is rare and costs one chip.
 */
const WORKSPACE_RESOURCE_LEADING_BACKTICK =
  /`(\s*<workspace_resource>[^`]*?<\/workspace_resource>)/g
const WORKSPACE_RESOURCE_TRAILING_BACKTICK =
  /(<workspace_resource>[^`]*?<\/workspace_resource>\s*)`/g

export function sanitizeChatDisplayContent(content: string): string {
  return content
    .replace(WORKSPACE_RESOURCE_CODE_SPAN_PATTERN, '$1')
    .replace(HIDDEN_INLINE_REFERENCE_PATTERN, '')
    .replace(WORKSPACE_RESOURCE_LEADING_BACKTICK, '$1')
    .replace(WORKSPACE_RESOURCE_TRAILING_BACKTICK, '$1')
}
