import type { JSONContent } from '@tiptap/core'

/** Images are block nodes in the shared schema, even when Markdown places them beside text. */
export function splitBlockImageParagraph(node: JSONContent): JSONContent[] {
  if (node.type !== 'paragraph' || !node.content?.some((child) => child.type === 'image')) {
    return [node]
  }
  const blocks: JSONContent[] = []
  let inline: JSONContent[] = []
  const flush = () => {
    /** Whitespace beside a block image becomes paragraph padding, not visible inline content. */
    let start = 0
    let end = inline.length - 1
    for (const leading of [true, false]) {
      while (start <= end) {
        const index = leading ? start : end
        const child = inline[index]
        if (child.type !== 'text' || child.marks?.some((mark) => mark.type === 'code')) break
        const text = (child.text ?? '').replace(leading ? /^[ \t\r\n]+/ : /[ \t\r\n]+$/, '')
        if (text) {
          inline[index] = { ...child, text }
          break
        }
        if (leading) start++
        else end--
      }
    }
    if (start <= end) blocks.push({ ...node, content: inline.slice(start, end + 1) })
    inline = []
  }
  for (const child of node.content) {
    if (child.type === 'image') {
      flush()
      blocks.push(child)
    } else {
      inline.push(child)
    }
  }
  flush()
  return blocks
}
