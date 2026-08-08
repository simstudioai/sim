const HIDDEN_INLINE_REFERENCE_PATTERN =
  /`[^`\n]*(?:internal\/tool-results\/|internal\/blocktips\/|components\/integrations\/[^`\n]*README)[^`\n]*`/g

/**
 * A complete workspace-resource tag: opener, payload, closer.
 *
 * Two constraints on the payload, both load-bearing:
 *
 * - **No backtick.** A payload is JSON and carries none, so this is what tells a
 *   real tag from prose MENTIONING the tag name — a message explaining the
 *   syntax writes the opener and the closer as two separately backticked spans.
 * - **No nested opener**, via the negative lookahead. A cost bound rather than a
 *   correctness rule: a lazy scan allowed to cross an opener restarts from every
 *   opener, so a message repeating the tag name is quadratic — on the main
 *   thread, for every streamed chunk.
 *
 * Accepted trade: a resource whose title or path itself contains a backtick is
 * not matched, so it renders as text rather than a chip. That costs one chip and
 * is rare; the failure it replaces corrupts a whole message and is common.
 */
const COMPLETE_TAG_SOURCE =
  '<workspace_resource>(?:(?!<workspace_resource>)[^`])*?<\\/workspace_resource>'

/** Non-global so {@link RegExp.test} has no `lastIndex` to carry between calls. */
const COMPLETE_WORKSPACE_RESOURCE_TAG = new RegExp(COMPLETE_TAG_SOURCE)

/**
 * One left-to-right pass over the two things that can own a backtick: an inline
 * code span, and a tag with a stray backtick pressed against it.
 *
 * ONE pass is the design. Two separate passes each have to guess which backticks
 * belong together, and every previous arrangement of this file got a different
 * case wrong — a span two words away, a code fence, then a span sitting flush
 * against the tag. Here a span consumes its own delimiters as the scan reaches
 * them, so `` `config.json`<tag> `` keeps its pair without a special case.
 *
 * The trailing backtick is only taken when no further backtick follows on the
 * line; otherwise it is not a stray at all but the opener of the next span, and
 * `` <tag>`config.json` `` would lose that span's delimiter. A LEADING backtick
 * needs no such guard, because a backtick that closes a span is consumed as part
 * of that span. Of the two, only the trailing lookahead is pinned by a test —
 * swapping the alternatives changes behaviour only for a span that both opens
 * flush against a tag and closes elsewhere, which no fixture covers.
 */
const CODE_SPAN_OR_FLANKED_TAG = new RegExp(
  `\`[^\`\\n]*\`|\`?(${COMPLETE_TAG_SOURCE})(?:\`(?![^\`\\n]*\`))?`,
  'g'
)

export function sanitizeChatDisplayContent(content: string): string {
  return content
    .replace(CODE_SPAN_OR_FLANKED_TAG, (match, tag?: string) => {
      // A tag with stray backticks against it: keep the tag, drop the strays.
      if (tag !== undefined) return tag

      // A code span. Unwrap it only when it genuinely holds a tag — the parser
      // lifts the tag out either way, so leaving the delimiters would strand a
      // pair of backticks around a hole. Anything else is someone else's span.
      const inner = match.slice(1, -1)
      return COMPLETE_WORKSPACE_RESOURCE_TAG.test(inner) ? inner : match
    })
    .replace(HIDDEN_INLINE_REFERENCE_PATTERN, '')
}
