import { type RenderContext, renderNestedMarkdownContent } from '@tiptap/core'
import { getListMarker, ListItem } from '@tiptap/extension-list'
import { splitBlockImageParagraph } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/block-image-paragraph'

function listItemMarker(context: RenderContext): string {
  if (context.parentType !== 'orderedList') return '- '
  const { start, type } = context.meta?.parentAttrs ?? {}
  const first = (typeof start === 'number' && start) || 1
  return getListMarker(typeof type === 'string' ? type : null, first - 1 + context.index, '. ')
}

/**
 * Markdown items may start with a nested block, but the list-item schema requires a paragraph
 * first. Supply that empty paragraph before Yjs hydration can discard the invalid subtree.
 *
 * Nested blocks keep the two-space indent under every marker. Upstream aligns ordered-item
 * children to the marker width, but its ordered-list tokenizer strips one column less, so a
 * fenced code block inside a numbered item would gain a leading space on every save. Drop
 * this override once the upstream ordered-list tokenizer strips the full marker width.
 */
export const MarkdownListItem = ListItem.extend({
  parseMarkdown(token, helpers) {
    const parsed = this.parent?.(token, helpers) ?? []
    if (Array.isArray(parsed)) return parsed
    const content = (parsed.content ?? []).flatMap(splitBlockImageParagraph)
    if (content[0]?.type !== 'paragraph') content.unshift({ type: 'paragraph' })
    return { ...parsed, content }
  },
  renderMarkdown: (node, helpers, context) => {
    const rendered = renderNestedMarkdownContent(node, helpers, listItemMarker(context))
    /** Marked misreads an opening empty `- ` line as prose when it has a trailing space. */
    return rendered.replace(/^-[ \t]+(?=\n|$)/, '-')
  },
})
