const HIDDEN_INLINE_REFERENCE_PATTERN =
  /`[^`\n]*(?:internal\/tool-results\/|internal\/blocktips\/|components\/integrations\/[^`\n]*README)[^`\n]*`/g

/**
 * A complete workspace-resource tag, with any backtick sitting directly against
 * either end. Replacing with the tag alone drops those backticks, which is what
 * lets the chip render when the model wrapped the tag in a code span.
 *
 * Three constraints, each load-bearing:
 *
 * - **The closer must be present.** Prose MENTIONING the tag name writes
 *   `<workspace_resource>` with no closer at all. Stripping a mention's opening
 *   backtick leaves the closing one unpaired, and it opens a code span that runs
 *   to the next backtick — inverting every code span in the rest of the message.
 * - **No backtick between opener and closer.** A payload is JSON and carries
 *   none, while a message explaining the syntax writes the opener and the closer
 *   as two separately backticked spans. Without this, that prose reads as one
 *   wrapped tag and loses its outer pair.
 * - **No `<workspace_resource>` between opener and closer**, via the negative
 *   lookahead. This is a cost bound, not a correctness rule: a lazy scan that may
 *   cross an opener restarts from every opener, so a message repeating the tag
 *   name is quadratic — on the main thread, for every streamed chunk.
 *
 * Backticks must be DIRECTLY adjacent. Allowing whitespace between let the
 * pattern reach past the tag and take the delimiter off a neighbouring code
 * span — `` Open `config.json` <tag> `` lost a backtick that way, and `\s*`
 * crossing a newline broke the closing fence of a code block containing a tag.
 *
 * Accepted trade: a resource whose title or path itself contains a backtick is
 * not matched, so it renders as text rather than a chip. That costs one chip and
 * is rare; the failure it replaces corrupts a whole message and is common.
 */
const WORKSPACE_RESOURCE_TAG_WITH_BACKTICKS =
  /`?(<workspace_resource>(?:(?!<workspace_resource>)[^`])*?<\/workspace_resource>)`?/g

/**
 * An inline code span, paired the way markdown pairs one: opening backtick to
 * the next backtick on the same line.
 *
 * Pairing matters. A pattern that instead looked for "a backtick, then a tag,
 * then a backtick" would happily start at one span's delimiter and end at a
 * different span's, unwrapping the text between two unrelated spans — which is
 * how `` Open `config.json` <tag> then run `bun test` `` lost a backtick.
 */
const CODE_SPAN_PATTERN = /`([^`\n]*)`/g

/** Non-global so {@link RegExp.test} has no `lastIndex` to carry between calls. */
const COMPLETE_WORKSPACE_RESOURCE_TAG =
  /<workspace_resource>(?:(?!<workspace_resource>)[^`])*?<\/workspace_resource>/

export function sanitizeChatDisplayContent(content: string): string {
  return (
    content
      // A tag inside a code span: drop the delimiters, keep the content. The
      // parser extracts the tag either way, so leaving them would strand a pair
      // of backticks around a hole once the chip is lifted out.
      .replace(CODE_SPAN_PATTERN, (span, inner: string) =>
        COMPLETE_WORKSPACE_RESOURCE_TAG.test(inner) ? inner : span
      )
      .replace(HIDDEN_INLINE_REFERENCE_PATTERN, '')
      // A leftover backtick pressed against a tag, with no partner to pair with.
      .replace(WORKSPACE_RESOURCE_TAG_WITH_BACKTICKS, '$1')
  )
}
