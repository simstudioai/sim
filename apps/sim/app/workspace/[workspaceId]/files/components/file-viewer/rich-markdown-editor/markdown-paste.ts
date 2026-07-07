import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { parseMarkdownToDoc } from './markdown-parse'

/**
 * Structural markdown — strong signals the plain text is genuinely markdown (a link, image, badge,
 * list, heading, blockquote, fenced block, or GFM table). Our parser round-trips these more faithfully
 * than generic HTML→DOM mapping (GFM alignment, escaping, the `./raw-markdown-snippet.ts` constructs),
 * so they are parsed even when the clipboard also carries an HTML sibling.
 */
const STRUCTURAL_MARKDOWN_HINTS: ReadonlyArray<RegExp> = [
  /^#{1,6}\s/m,
  /\*\*[^*]+\*\*/,
  /\[[^\]]*]\([^)]+\)/,
  /^\s*[-*+]\s/m,
  /^\s*\d+\.\s/m,
  /^>\s/m,
  /```/,
  /^\|.*\|.*\|/m,
]

/**
 * Inline marks — weaker markdown signals (`*italic*` / `_italic_`, `~~strike~~`, `` `code` ``) that a
 * rich HTML sibling encodes just as well. Parsed for a plain-text-only paste (so markdown copied from a
 * terminal or `.md` source renders), but deferred to an HTML sibling: its presence means the source was
 * rich, and it may carry structure the plain text can't (a copied table's plain form is tab-separated,
 * not a `| … |` grid, so parsing it would flatten the table).
 */
const INLINE_MARK_HINTS: ReadonlyArray<RegExp> = [
  /\*[^*\n]+\*/,
  /_[^_\n]+_/,
  /~~[^~\n]+~~/,
  /`[^`\n]+`/,
]

function hasAny(hints: ReadonlyArray<RegExp>, text: string): boolean {
  return hints.some((hint) => hint.test(text))
}

/**
 * Parses pasted plain text that looks like markdown into rich content, via the strict CommonMark
 * parser ({@link parseMarkdownToDoc}, `marked`). Pastes inside a code block are left untouched (code
 * is meant to stay literal).
 *
 * Provenance decides plain-text-vs-HTML: a `text/html` sibling (copied from a browser, Slack, Notion,
 * GitHub, or this editor) is the signal the source was rich. Structural markdown is still parsed from
 * the plain-text sibling regardless — our parser is more faithful for GFM tables and escaping. But
 * inline-only marks are equally expressible in HTML, so when a rich sibling is present we defer to the
 * DOM path, which preserves structure the plain text can't encode. A plain-text-only clipboard (a
 * terminal, a code editor, a `.md` file) always parses.
 *
 * The strictness of the parse matters: `marked` follows CommonMark flanking rules, so `*text*` becomes
 * emphasis but a space-flanked `5 * width * height` stays literal. The editor sets `enablePasteRules:
 * false` so StarterKit's lenient mark paste rules (which would mangle that expression on either path)
 * never run — emphasis is owned by this parser on the plain path and by real HTML tags on the DOM path.
 */
export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',

  addProseMirrorPlugins() {
    const { editor } = this
    return [
      new Plugin({
        props: {
          handlePaste: (_view, event) => {
            if (!editor.isEditable) return false
            if (editor.isActive('codeBlock')) return false
            const text = event.clipboardData?.getData('text/plain')
            if (!text) return false
            if (!hasAny(STRUCTURAL_MARKDOWN_HINTS, text)) {
              if (!hasAny(INLINE_MARK_HINTS, text)) return false
              if (event.clipboardData?.getData('text/html')) return false
            }
            const doc = parseMarkdownToDoc(text)
            if (!doc.content?.length) return false
            return editor.commands.insertContent(doc)
          },
        },
      }),
    ]
  },
})
