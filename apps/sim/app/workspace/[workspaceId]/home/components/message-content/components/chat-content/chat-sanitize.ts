const HIDDEN_INLINE_REFERENCE_PATTERN =
  /`[^`\n]*(?:internal\/tool-results\/|internal\/blocktips\/|components\/integrations\/[^`\n]*README)[^`\n]*`/g
const WORKSPACE_RESOURCE_CODE_SPAN_PATTERN =
  /`([^`\n]*<workspace_resource>[\s\S]*?<\/workspace_resource>[^`\n]*)`/g

/**
 * A stray backtick on ONE side of a complete resource tag, which would still
 * stop the chip rendering after the balanced case above is unwrapped.
 *
 * Both require the full opener-payload-closer to be present, and forbid a
 * backtick inside it. That is what separates a real tag from prose merely
 * MENTIONING the tag name: a payload is JSON and carries no backticks, whereas
 * a message explaining the tag writes `<workspace_resource>` on its own with no
 * closer at all. Stripping a mention's opening backtick leaves its closing one
 * unpaired, which opens a code span that runs to the next backtick and inverts
 * every code span in the rest of the message.
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
