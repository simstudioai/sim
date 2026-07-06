import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { parseMarkdownToDoc } from './markdown-parse'

/**
 * Markdown syntax hints. If pasted plain text matches any of these, it's parsed as markdown rather
 * than inserted literally — so a pasted link, image, badge, list, or heading renders as rich content
 * instead of showing its raw `[text](url)` / `# ` source.
 */
const MARKDOWN_HINTS: ReadonlyArray<RegExp> = [
  /^#{1,6}\s/m,
  /\*\*[^*]+\*\*/,
  /\[[^\]]*]\([^)]+\)/,
  /^\s*[-*+]\s/m,
  /^\s*\d+\.\s/m,
  /^>\s/m,
  /```/,
  /^\|.*\|.*\|/m,
]

function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_HINTS.some((hint) => hint.test(text))
}

/**
 * Parses pasted plain text that looks like markdown into rich content. Pastes inside a code block
 * are left untouched (code is meant to stay literal).
 *
 * A clipboard entry that also carries `text/html` (copied from a browser, Slack, Notion, GitHub,
 * or this editor itself) used to always defer entirely to ProseMirror's generic HTML→DOM mapping,
 * even when the `text/plain` sibling was clean markdown our own parser round-trips more faithfully
 * (GFM table alignment, escaping, the constructs `./raw-markdown-snippet.ts` now preserves). Only
 * defer to DOM mapping when the plain-text sibling *doesn't* look like markdown — an HTML clipboard
 * payload with no markdown-shaped plain-text counterpart (a genuinely rich paste from a word
 * processor, a web page selection, …) still goes through the DOM path unchanged.
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
            if (!text || !looksLikeMarkdown(text)) return false
            // Parse through the chunker (linear) so pasting a large markdown blob can't freeze the
            // main thread the way the underlying superlinear parse would.
            const doc = parseMarkdownToDoc(text)
            if (!doc.content?.length) return false
            return editor.commands.insertContent(doc)
          },
        },
      }),
    ]
  },
})
