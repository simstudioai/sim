import type { JSONContent, MarkdownToken } from '@tiptap/core'
import { OrderedList } from '@tiptap/extension-list'
import {
  joinListInputRules,
  orderedListContinues,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/list-input-rules'
import { excludeTableBlockInputRules } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/table'

/**
 * CommonMark distinguishes adjacent ordered lists by their delimiter, not their starting number.
 * Alternate delimiters within a sibling run to preserve explicit restarts without adding nodes.
 * The weak map carries only renderer context between sibling callbacks; nothing enters the schema
 * or persisted attributes, and repeated serialization recomputes each delimiter in document order.
 */
export function createJoiningOrderedList() {
  const delimiters = new WeakMap<JSONContent, '.' | ')'>()
  const parse = OrderedList.config.parseMarkdown

  return OrderedList.extend({
    addInputRules() {
      return excludeTableBlockInputRules(
        joinListInputRules(this.parent?.() ?? [], this.type, { compatible: orderedListContinues })
      )
    },
    parseMarkdown: (token, helpers) => {
      if (!token.ordered || !token.items?.length) return parse?.(token, helpers) ?? []

      /**
       * The upstream tokenizer retains each item's raw marker but ignores delimiter changes.
       * Split its parsed item tokens, retaining its legacy indentation and nested-block behavior.
       * Nested list tokens pass through this same parser via the stock list-item parser.
       */
      const groups: MarkdownToken[] = []
      let delimiter: string | undefined
      for (const item of token.items) {
        const marker = /^[ \t]*(\d+)([.)])(?:[ \t]|$)/.exec(item.raw ?? '')
        if (!marker) {
          groups.length = 0
          break
        }
        if (marker[2] !== delimiter) {
          groups.push({ ...token, start: Number(marker[1]), items: [] })
          delimiter = marker[2]
        }
        groups[groups.length - 1].items?.push(item)
      }
      if (groups.length > 1) return helpers.parseChildren(groups)

      /**
       * The custom tokenizer resolves item paragraphs before later reference definitions exist.
       * At parse time the public helper uses the complete document's reference context.
       */
      const resolved = {
        ...token,
        items: token.items.map((item) => ({
          ...item,
          tokens: item.tokens?.map((child) =>
            child.type === 'paragraph' && child.raw?.includes('[') && helpers.tokenizeInline
              ? { ...child, tokens: helpers.tokenizeInline(child.raw) }
              : child
          ),
        })),
      }
      const parsedList = parse?.(resolved, helpers) ?? []
      if (Array.isArray(parsedList)) return parsedList
      /** Use the registered item parser so empty items retain their schema-required paragraph. */
      const parsed = { ...parsedList, content: helpers.parseChildren(resolved.items) }
      /** The stock parser's truthy default turns a valid zero start into one. */
      if (groups[0]?.start === 0) {
        return { ...parsed, attrs: { ...parsed.attrs, start: 0 } }
      }
      return parsed
    },
    renderMarkdown: (node: JSONContent, helpers, context) => {
      const previous = context.previousNode
      const delimiter =
        previous?.type === 'orderedList' && delimiters.get(previous) === '.' ? ')' : '.'
      delimiters.set(node, delimiter)
      const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1
      return (node.content ?? [])
        .map((item, index) => {
          const rendered = helpers.renderChild?.(item, index) ?? helpers.renderChildren([item])
          return rendered.replace(/^\d+\. /, `${start + index}${delimiter} `)
        })
        .join('\n')
    },
  })
}
