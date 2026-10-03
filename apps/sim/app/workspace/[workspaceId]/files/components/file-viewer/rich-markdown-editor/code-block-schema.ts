import type { JSONContent } from '@tiptap/core'
import { CodeBlock } from '@tiptap/extension-code-block'

/**
 * React-free schema half of the code-block node. Lives apart from {@link ./code-block} (its React
 * node view) so the shared editor schema — `createMarkdownContentExtensions` in `./extensions` — can
 * be imported by server code (the collab-doc seed converter) without pulling a client component
 * (`useEffect`) into a Server Component module. The client editor injects the node-view variant
 * ({@link CodeBlockWithLanguage}) via `nodeViews`.
 */

function codeBlockText(node: JSONContent): string {
  return (node.content ?? []).map((child) => child.text ?? '').join('')
}

/** Fence sized to one backtick longer than the longest run inside the code (CommonMark rule). */
function fenceFor(text: string): string {
  const longestRun = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length))
  return '`'.repeat(Math.max(3, longestRun + 1))
}

/**
 * Code block whose markdown serializer sizes the fence to the interior backtick runs, so a code
 * block that itself contains a ``` line round-trips instead of shattering. Shared by the test
 * (plain) and live ({@link CodeBlockWithLanguage}) paths.
 */
export const MarkdownCodeBlock = CodeBlock.extend({
  renderMarkdown: (node: JSONContent) => {
    const language = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
    const text = codeBlockText(node)
    const fence = fenceFor(text)
    return `${fence}${language}\n${text}\n${fence}`
  },
})
