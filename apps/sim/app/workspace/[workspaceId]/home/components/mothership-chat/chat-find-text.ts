import type { Nodes } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

const parser = unified().use(remarkParse).use(remarkGfm)
const INLINE_CONTAINERS = new Set([
  'paragraph',
  'heading',
  'strong',
  'emphasis',
  'delete',
  'link',
  'linkReference',
  'tableCell',
])

/** Projects Markdown onto searchable display text, excluding invisible destinations and metadata. */
export function getChatFindText(markdown: string): string {
  function text(node: Nodes): string {
    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code')
      return node.value
    if (node.type === 'image' || node.type === 'imageReference') return '\uffff'
    if (node.type === 'break') return '\n'
    if (node.type === 'footnoteDefinition') return ''
    if (!('children' in node)) return ''
    return node.children
      .map(text)
      .filter(Boolean)
      .join(INLINE_CONTAINERS.has(node.type) ? '' : '\n')
  }
  return text(parser.parse(markdown))
}
