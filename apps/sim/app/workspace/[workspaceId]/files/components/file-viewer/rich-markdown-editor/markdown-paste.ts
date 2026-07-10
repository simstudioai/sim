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
 * Extracts the source language from VSCode's `vscode-editor-data` clipboard payload (a JSON blob with a
 * `mode` field), mapping the few ids that differ from our code-block values. Returns `''` when the
 * payload is absent, unparseable, or a non-code mode (plaintext/markdown). A real code language makes
 * the paste handler emit a fenced code block — otherwise VSCode's per-token colored-span HTML would
 * fall through to ProseMirror's default parser and flatten into plain paragraphs — while an empty
 * result falls through so markdown copied from VSCode still parses as markdown.
 */
function parseVscodeLanguage(data: string | undefined): string {
  if (!data) return ''
  try {
    const mode = (JSON.parse(data) as { mode?: unknown }).mode
    if (typeof mode !== 'string') return ''
    return VSCODE_LANGUAGE_ALIASES[mode] ?? mode
  } catch {
    return ''
  }
}

/** `<style>`/`<script>` elements (with their content), matched as a pair via the tag backreference. */
const NON_CONTENT_HTML = /<(style|script)\b[\s\S]*?<\/\1>/gi

/**
 * Strips `<style>`/`<script>` elements from pasted HTML. Google Sheets and Word prepend a `<style>`
 * block of CSS (and Sheets a `<google-sheets-html-origin>` wrapper); ProseMirror's DOM parser has no
 * rule for `<style>`, so it would walk the element's CSS text into the document as literal paragraphs.
 * Removing these before parsing keeps the pasted content clean (PM already discards unknown wrappers).
 *
 * Replaces in a loop (not a single pass) so nested/overlapping tags — e.g. `<script><script>x</script>` —
 * can't leave a surviving `<script>` behind: each pass can only remove the innermost non-overlapping
 * matches, and a single pass over nested tags leaves the outer one dangling.
 */
function stripNonContentHtml(html: string): string {
  let previous: string
  let stripped = html
  do {
    previous = stripped
    stripped = previous.replace(NON_CONTENT_HTML, '')
  } while (stripped !== previous)
  return stripped
}

/**
 * Parses pasted plain text that looks like markdown into rich content, via the strict CommonMark
 * parser ({@link parseMarkdownToDoc}, `marked`). Pastes inside a code block or inline code are left
 * untouched (code is meant to stay literal).
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
          transformPastedHTML: (html) => stripNonContentHtml(html),
          handlePaste: (_view, event) => {
            if (!editor.isEditable) return false
            if (editor.isActive('codeBlock') || editor.isActive('code')) return false
            const text = event.clipboardData?.getData('text/plain')
            if (!text) return false
            const language = parseVscodeLanguage(event.clipboardData?.getData('vscode-editor-data'))
            if (language) {
              return editor.commands.insertContent({
                type: 'codeBlock',
                attrs: { language },
                content: [{ type: 'text', text }],
              })
            }
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
