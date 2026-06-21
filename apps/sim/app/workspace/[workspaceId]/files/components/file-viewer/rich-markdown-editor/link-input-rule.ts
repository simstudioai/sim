import { Extension, InputRule } from '@tiptap/core'
import { normalizeLinkHref } from './markdown-fidelity'

/**
 * Typed markdown link: `[text](url)` or `[text](url "title")`, completed by the closing `)`. The URL
 * is space-free (markdown requires `<url>` for spaces, which this intentionally skips). StarterKit's
 * Link ships no input rule — only paste/autolink — so without this, typed link syntax stays literal.
 */
const LINK_INPUT_RULE = /\[([^\]]+)]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/

/**
 * Converts a typed markdown link into a real link mark on the closing `)`. The visible text is the
 * first capture group (so `markInputRule`, which keeps the *last* group, can't express this); the
 * href comes from the second group, normalized through {@link normalizeLinkHref} so a bare domain
 * gets `https://` and an unsafe scheme (`javascript:`) is refused (left as literal text). Skipped
 * inside code blocks, where the brackets are literal source.
 */
export const MarkdownLinkInputRule = Extension.create({
  name: 'markdownLinkInputRule',

  addInputRules() {
    return [
      new InputRule({
        find: LINK_INPUT_RULE,
        handler: ({ state, range, match }) => {
          if (state.selection.$from.parent.type.spec.code) return null
          const linkType = state.schema.marks.link
          if (!linkType) return null
          const [fullMatch, text, rawHref, title] = match
          const href = normalizeLinkHref(rawHref ?? '')
          if (!href || !text) return null

          const { tr } = state
          const textStart = range.from + fullMatch.indexOf(text)
          const textEnd = textStart + text.length
          if (textEnd < range.to) tr.delete(textEnd, range.to)
          if (textStart > range.from) tr.delete(range.from, textStart)
          const markEnd = range.from + text.length
          tr.addMark(range.from, markEnd, linkType.create({ href, title: title || null }))
          tr.removeStoredMark(linkType)
        },
      }),
    ]
  },
})
