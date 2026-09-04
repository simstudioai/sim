import { type Editor, Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { normalizeLinkHref } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import { parseMarkdownToDoc } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'

interface MarkdownPasteStorage {
  pasteWithoutFormatting: boolean
}

declare module '@tiptap/core' {
  interface Storage {
    markdownPaste: MarkdownPasteStorage
  }
}

/** Lets higher-precedence image handlers defer to the same per-editor clipboard intent. */
export function isPlainTextPaste(editor: Editor): boolean {
  return editor.storage.markdownPaste?.pasteWithoutFormatting ?? false
}

/**
 * A single link the paste can wrap a selection in: an http(s) URL, a `mailto:` to a real address, a bare
 * `www.` host, or a bare email. `mailto:` requires an actual `user@host.tld` payload so a crafted value
 * like `mailto:javascript:…` (no `@`) never matches and falls through to a normal paste.
 */
const HTTP_URL = /^https?:\/\/\S+$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAILTO_URL = /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i
const BARE_WWW = /^www\.\S+\.\S+$/i

/**
 * If pasted text is a single link, return the href to wrap a selection in — `www.` gets `https://`, a
 * bare email gets `mailto:`. Returns null for anything else (a multi-word or non-URL paste falls through
 * to normal insertion). The caller still runs the result through `normalizeLinkHref` for scheme safety.
 */
function pastedLinkHref(text: string): string | null {
  if (HTTP_URL.test(text) || MAILTO_URL.test(text)) return text
  if (BARE_WWW.test(text)) return `https://${text}`
  if (EMAIL.test(text)) return `mailto:${text}`
  return null
}

/**
 * Structural markdown — strong signals the plain text is genuinely markdown (a link, image, badge,
 * list, heading, blockquote, fenced block, or GFM table). Only used after clipboard provenance has
 * established that the source is plain text or explicitly Markdown.
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
  /==(?:[^=\n]|=(?!=))+==/,
]

function hasAny(hints: ReadonlyArray<RegExp>, text: string): boolean {
  return hints.some((hint) => hint.test(text))
}

/**
 * VSCode language ids that differ from our code-block language values. `markdown`/`plaintext` map to
 * the empty string so they are NOT forced into a code block — markdown copied from VSCode should parse
 * as markdown, and plain text should paste as text; other ids pass through as-is.
 */
const VSCODE_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  html: 'markup',
  shellscript: 'bash',
  shell: 'bash',
  jsonc: 'json',
  plaintext: '',
  markdown: '',
  md: '',
  mdx: '',
}

/**
 * Reads VSCode's raw clipboard mode. The caller distinguishes Markdown provenance from code
 * language aliases; absent or malformed metadata returns an empty mode.
 */
function parseVscodeMode(data: string | undefined): string {
  if (!data) return ''
  try {
    const mode = (JSON.parse(data) as { mode?: unknown }).mode
    if (typeof mode !== 'string') return ''
    return mode
  } catch {
    return ''
  }
}

/** A `<style>`/`<script>` open or close tag token, scanned one at a time (never the element body). */
const NON_CONTENT_TAG = /<\/?\s*(style|script)\b[^>]*>/gi

/**
 * Strips `<style>`/`<script>` elements from pasted HTML. Google Sheets and Word prepend a `<style>`
 * block of CSS (and Sheets a `<google-sheets-html-origin>` wrapper); ProseMirror's DOM parser has no
 * rule for `<style>`, so it would walk the element's CSS text into the document as literal paragraphs.
 * Removing these before parsing keeps the pasted content clean (PM already discards unknown wrappers).
 *
 * Scans tag tokens in a single linear pass, tracking nesting depth of the currently-open tag name, so
 * nested/overlapping tags — e.g. `<script><script>x</script>` — can't leave a surviving `<script>`
 * behind. A naive single `replace()` pass over `<tag>[\s\S]*?<\/tag>` matches only the innermost pair
 * and leaves the outer tag dangling; repeating that replace until stable fixes correctness but costs
 * O(depth) full-string rescans on attacker-controlled clipboard input. This does it in one pass instead.
 * A stray close tag encountered outside any open element (depth 0) is left in place untouched. `cursor`
 * advances past an open tag the moment it opens (not when it closes), so if the input ends before the
 * element closes — truncated or malformed clipboard HTML — the unterminated element and everything
 * after it is dropped rather than reappearing unstripped in the final `html.slice(cursor)` flush.
 */
function stripNonContentHtml(html: string): string {
  let result = ''
  let cursor = 0
  let depth = 0
  let openTagName = ''
  NON_CONTENT_TAG.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = NON_CONTENT_TAG.exec(html))) {
    const isClosing = match[0][1] === '/'
    const tagName = match[1].toLowerCase()
    if (depth === 0) {
      if (isClosing) continue
      result += html.slice(cursor, match.index)
      openTagName = tagName
      depth = 1
      cursor = match.index + match[0].length
    } else if (tagName === openTagName) {
      depth += isClosing ? -1 : 1
      if (depth === 0) cursor = match.index + match[0].length
    }
  }
  if (depth === 0) result += html.slice(cursor)
  return result
}

/**
 * Parses pasted plain text that looks like markdown into rich content, via the strict CommonMark
 * parser ({@link parseMarkdownToDoc}, `marked`). Pastes inside a code block or inline code are left
 * untouched (code is meant to stay literal).
 *
 * Provenance decides plain-text-vs-HTML: a `text/html` sibling (copied from a browser, Slack, Notion,
 * GitHub, or this editor) is the signal the source was rich. Defer to that structure even when literal
 * cell text resembles Markdown. VSCode's explicit Markdown mode is the exception: its colored-span
 * HTML represents source, not a rendered document. Explicit paste-without-formatting bypasses every
 * transformation, including link wrapping and source-language code blocks.
 *
 * The strictness of the parse matters: `marked` follows CommonMark flanking rules, so `*text*` becomes
 * emphasis but a space-flanked `5 * width * height` stays literal. The editor sets `enablePasteRules:
 * false` so StarterKit's lenient mark paste rules (which would mangle that expression on either path)
 * never run — emphasis is owned by this parser on the plain path and by real HTML tags on the DOM path.
 */
export const MarkdownPaste = Extension.create<Record<string, never>, MarkdownPasteStorage>({
  name: 'markdownPaste',
  /** Clipboard intent must run before Link's selection-wrapping paste handler. */
  priority: 1_100,

  addStorage() {
    return { pasteWithoutFormatting: false }
  },

  addProseMirrorPlugins() {
    const { editor, storage } = this
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            keydown: (_view, event) => {
              storage.pasteWithoutFormatting =
                !event.isComposing &&
                event.keyCode !== 229 &&
                event.key.toLowerCase() === 'v' &&
                (event.metaKey || event.ctrlKey) &&
                event.shiftKey
              return false
            },
            keyup: () => {
              storage.pasteWithoutFormatting = false
              return false
            },
            blur: () => {
              storage.pasteWithoutFormatting = false
              return false
            },
          },
          transformPastedHTML: (html) => stripNonContentHtml(html),
          handlePaste: (view, event, slice) => {
            const pasteWithoutFormatting = storage.pasteWithoutFormatting
            storage.pasteWithoutFormatting = false
            if (!editor.isEditable) return false
            if (pasteWithoutFormatting) {
              const text =
                event.clipboardData?.getData('text/plain') ||
                event.clipboardData?.getData('Text') ||
                event.clipboardData?.getData('text/uri-list')
              if (!text) return true
              view.dispatch(
                view.state.tr
                  .replaceSelection(slice)
                  .setMeta('paste', true)
                  .setMeta('uiEvent', 'paste')
                  .setMeta('preventAutolink', true)
                  .scrollIntoView()
              )
              return true
            }
            if (editor.isActive('codeBlock') || editor.isActive('code')) return false
            const text = event.clipboardData?.getData('text/plain')
            if (!text) return false
            const { selection } = view.state
            if (
              !selection.empty &&
              selection.$from.sameParent(selection.$to) &&
              selection.$from.parent.inlineContent
            ) {
              const href = pastedLinkHref(text.trim())
              const safeHref = href ? normalizeLinkHref(href) : ''
              if (safeHref) return editor.commands.setLink({ href: safeHref })
            }
            const mode = parseVscodeMode(event.clipboardData?.getData('vscode-editor-data'))
            const language = VSCODE_LANGUAGE_ALIASES[mode] ?? mode
            if (language) {
              return editor.commands.insertContent({
                type: 'codeBlock',
                attrs: { language },
                content: [{ type: 'text', text }],
              })
            }
            const isMarkdownSource = mode === 'markdown' || mode === 'md' || mode === 'mdx'
            if (event.clipboardData?.getData('text/html') && !isMarkdownSource) return false
            if (!hasAny(STRUCTURAL_MARKDOWN_HINTS, text) && !hasAny(INLINE_MARK_HINTS, text))
              return false
            const doc = parseMarkdownToDoc(text)
            if (!doc.content?.length) return false
            return editor.commands.insertContent(doc)
          },
        },
      }),
    ]
  },
})
