import type { Root } from 'mdast'
import type { Plugin } from 'unified'

/**
 * A conservative shortcut for a single plain paragraph. Everything that could
 * introduce Markdown, GFM autolinks, escapes, entities, or another block still
 * goes through remark-parse. This changes only tokenization; the usual rehype,
 * sanitization, components, and word-fade pipeline receive the same tree.
 */
export const remarkPlainText: Plugin<[], Root> = function remarkPlainText() {
  const parse = this.parser
  if (!parse) throw new Error('remarkPlainText requires remark-parse')
  this.parser = (document, file) => {
    if (
      !/^[A-Za-z0-9]/.test(document) ||
      /[\n\r\t\0\\`*_{}[\]<>~&#@:|]/.test(document) ||
      /^\d+[.)](?: |$)/.test(document) ||
      /www\./i.test(document)
    ) {
      return parse(document, file)
    }
    const value = document.replace(/ +$/, '')
    const position = (end: number) => ({
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: end + 1, offset: end },
    })
    return {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value, position: position(value.length) }],
          position: position(document.length),
        },
      ],
      position: position(document.length),
    }
  }
}
