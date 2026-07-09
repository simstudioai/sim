import type {
  JSONContent,
  MarkdownParseHelpers,
  MarkdownRendererHelpers,
  MarkdownToken,
} from '@tiptap/core'
import { Mark, markInputRule, markPasteRule, mergeAttributes } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { Plugin } from '@tiptap/pm/state'

/**
 * `==text==` with non-space edges — the Pandoc/Obsidian highlight syntax. The body allows a lone `=`
 * (`=(?!=)`) but never `==`, so a highlight over text containing `=` (e.g. `==a=b==`) round-trips while
 * the closing `==` still terminates the run.
 */
const HIGHLIGHT_BODY = String.raw`(?:[^=]|=(?!=))+?`
const HIGHLIGHT_TOKEN = new RegExp(String.raw`^==(?!\s)(${HIGHLIGHT_BODY})(?<!\s)==`)
/** Input/paste rule form (anchored on a preceding boundary) so typing `==x==` toggles the mark. */
const HIGHLIGHT_INPUT = new RegExp(String.raw`(?:^|\s)(==(?!\s)(${HIGHLIGHT_BODY})(?<!\s)==)$`)
const HIGHLIGHT_PASTE = new RegExp(String.raw`(?:^|\s)(==(?!\s)(${HIGHLIGHT_BODY})(?<!\s)==)`, 'g')

/**
 * Highlight mark (`<mark>`), serialized to and parsed from `==text==`. CommonMark/`marked` has no
 * highlight token, so this registers a custom inline tokenizer (parsing the inner text as inline
 * markdown so nested marks like `==**bold**==` survive) and a `renderMarkdown` that wraps the content
 * in `==`. Mirrors the verbatim-node registration pattern in `./raw-markdown-snippet`.
 *
 * The tokenizer's `start` returns the index of the next `==` (a plain string search, not the
 * `createLexer()`-calling form the `RawHtmlBlock` caveat warns against) so `marked` breaks its inline
 * text run there and gives this tokenizer a chance mid-line — `=` is not a default break char like `[`.
 *
 * A lone `=` is allowed inside a highlight (so `==a=b==` round-trips), but `==` cannot be encoded in the
 * `==…==` delimiter (emitting `==a==b==` would split the highlight and corrupt the text on reload). The
 * tokenizer/input rules already exclude `==`; an `appendTransaction` guard removes the mark from any
 * text that ends up containing `==` (e.g. a toolbar highlight over `a==b`), so the doc never holds an
 * unrepresentable highlight and serialization stays lossless.
 */
export const Highlight = Mark.create({
  name: 'highlight',

  parseHTML() {
    return [{ tag: 'mark' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes), 0]
  },

  addInputRules() {
    return [markInputRule({ find: HIGHLIGHT_INPUT, type: this.type })]
  },

  addPasteRules() {
    return [markPasteRule({ find: HIGHLIGHT_PASTE, type: this.type })]
  },

  addKeyboardShortcuts() {
    return { 'Mod-Shift-h': () => this.editor.commands.toggleMark(this.name) }
  },

  markdownTokenName: 'highlight',
  markdownTokenizer: {
    name: 'highlight',
    level: 'inline' as const,
    start: (src: string) => src.indexOf('=='),
    tokenize(src: string): MarkdownToken | undefined {
      const match = HIGHLIGHT_TOKEN.exec(src)
      if (!match) return undefined
      return { type: 'highlight', raw: match[0], text: match[1] }
    },
  },

  parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
    const inner = token.text ?? ''
    const tokens = helpers.tokenizeInline?.(inner)
    const content = tokens ? helpers.parseInline(tokens) : [{ type: 'text', text: inner }]
    return { mark: 'highlight', content }
  },

  renderMarkdown(node: JSONContent, h: MarkdownRendererHelpers) {
    return `==${h.renderChildren(node.content ?? [])}==`
  },

  addProseMirrorPlugins() {
    const markType = this.type
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((transaction) => transaction.docChanged)) return null
          let tr: Transaction | null = null
          newState.doc.descendants((node, pos) => {
            if (
              node.isText &&
              node.text?.includes('==') &&
              node.marks.some((mark) => mark.type === markType)
            ) {
              tr = (tr ?? newState.tr).removeMark(pos, pos + node.nodeSize, markType)
            }
          })
          return tr
        },
      }),
    ]
  },
})
