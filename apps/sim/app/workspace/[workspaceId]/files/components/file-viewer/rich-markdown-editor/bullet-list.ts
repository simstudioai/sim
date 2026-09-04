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
})
