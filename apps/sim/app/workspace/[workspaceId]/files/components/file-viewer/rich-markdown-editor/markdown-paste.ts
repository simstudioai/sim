import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

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
 * are left untouched (code is meant to stay literal), as are pastes that carry richer HTML — those
 * are handled by ProseMirror's own clipboard parsing.
 */
export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',

  addProseMirrorPlugins() {
    const { editor } = this
    return [
      new Plugin({
        props: {
          handlePaste: (_view, event) => {
            if (editor.isActive('codeBlock')) return false
            const html = event.clipboardData?.getData('text/html')
            if (html) return false
            const text = event.clipboardData?.getData('text/plain')
            if (!text || !looksLikeMarkdown(text)) return false
            const json = editor.markdown?.parse(text)
            if (!json) return false
            return editor.commands.insertContent(json)
          },
        },
      }),
    ]
  },
})
