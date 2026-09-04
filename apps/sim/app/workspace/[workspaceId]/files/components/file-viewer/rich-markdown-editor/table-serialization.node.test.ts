/**
 * @vitest-environment node
 */
import { getSchema, type JSONContent } from '@tiptap/core'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import { describe, expect, it } from 'vitest'
import { yDocToMarkdown } from '@/lib/collab-doc/converter'
import { COLLAB_DOC_FIELD } from '@/lib/collab-doc/field'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import {
  parseMarkdownToDoc,
  serializeMarkdownDocument,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'

describe('legacy table preservation through the server converter', () => {
  it('keeps rich blocks, marks, spans, and widths as standard HTML in a Node environment', () => {
    expect(typeof globalThis.window).toBe('undefined')
    const document: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  attrs: { colspan: 2, colwidth: [120, 240] },
                  content: [
                    {
                      type: 'heading',
                      attrs: { level: 2 },
                      content: [{ type: 'text', text: 'rich heading', marks: [{ type: 'bold' }] }],
                    },
                    { type: 'paragraph', content: [{ type: 'text', text: 'second block' }] },
                  ],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: { rowspan: 2 },
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'a  b', marks: [{ type: 'code' }] }],
                    },
                  ],
                },
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'peer text' }] }],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: '<script>literal</script>' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const shared = prosemirrorJSONToYDoc(
      getSchema(createMarkdownContentExtensions()),
      document,
      COLLAB_DOC_FIELD
    )
    try {
      const markdown = yDocToMarkdown(shared).trim()
      expect(markdown).toContain('<table')
      expect(markdown).toContain('colspan="2"')
      expect(markdown).toContain('rowspan="2"')
      expect(markdown).toContain('colwidth="120,240"')
      expect(markdown).toContain('<h2><strong>rich heading</strong></h2>')
      expect(markdown).toContain('<p>second block</p>')
      expect(markdown).toContain('<code>a  b</code>')
      expect(markdown).toContain('peer text')
      expect(markdown).toContain('&lt;script&gt;literal&lt;/script&gt;')
      expect(parseMarkdownToDoc(markdown).content?.[0].type).toBe('rawHtmlBlock')
      expect(serializeMarkdownDocument(markdown).trim()).toBe(markdown)
    } finally {
      shared.destroy()
    }
  })
})
