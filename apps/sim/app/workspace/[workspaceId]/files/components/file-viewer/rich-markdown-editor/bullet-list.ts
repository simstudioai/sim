import { BulletList } from '@tiptap/extension-list'
import { joinListInputRules } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/list-input-rules'

/**
 * Extends the stock input rules, which only join a preceding list, to also join an immediately
 * following bullet list. Keeping the join in the input-rule transaction preserves undo and the
 * caret, without merging across paragraphs or rewriting unrelated lists on every edit.
 */
export const JoiningBulletList = BulletList.extend({
  addInputRules() {
    return joinListInputRules(this.parent?.() ?? [], this.type)
  },
  renderMarkdown(node, helpers, context) {
    const firstParagraph = node.content?.[0]?.content?.[0]
    const startsEmpty = firstParagraph?.type === 'paragraph' && !firstParagraph.content?.length
    const nested = context.parentType === 'listItem' || context.parentType === 'taskItem'
    const followsText =
      context.previousNode?.type === 'paragraph' && Boolean(context.previousNode.content?.length)
    const rendered = helpers.renderChildren(node.content ?? [], '\n')
    /** Separate an opening empty bullet from its parent's text so it cannot become a Setext heading. */
    return nested && startsEmpty && followsText ? `\n${rendered}` : rendered
  },
})
