import { ListItem } from '@tiptap/extension-list'
import { splitBlockImageParagraph } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/block-image-paragraph'

/**
 * Markdown items may start with a nested block, but the list-item schema requires a paragraph
 * first. Supply that empty paragraph before Yjs hydration can discard the invalid subtree.
 */
export const MarkdownListItem = ListItem.extend({
  parseMarkdown: (token, helpers) => {
    const parsed = ListItem.config.parseMarkdown?.(token, helpers) ?? []
    if (Array.isArray(parsed)) return parsed
    const content = (parsed.content ?? []).flatMap(splitBlockImageParagraph)
    if (content[0]?.type !== 'paragraph') content.unshift({ type: 'paragraph' })
    return { ...parsed, content }
  },
  renderMarkdown: (node, helpers, context) => {
    const rendered = ListItem.config.renderMarkdown?.(node, helpers, context) ?? ''
    /** Marked misreads an opening empty `- ` line as prose when it has a trailing space. */
    return rendered.replace(/^-[ \t]+(?=\n|$)/, '-')
  },
})
