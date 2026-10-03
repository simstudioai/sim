/** @vitest-environment jsdom */
import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import {
  applyFrontmatter,
  postProcessSerializedMarkdown,
  splitFrontmatter,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import {
  parseMarkdownToDoc,
  serializeMarkdownDocument,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'
import { isRoundTripSafe } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/round-trip-safety'

describe('frontmatter preservation', () => {
  it.each([
    ['leading comment', '# Document metadata\ntitle: Hello'],
    ['leading blank and comment', '\n# Document metadata\ntitle: Hello'],
    ['multiple comments', '# First\n\n# Second\ntitle: Hello'],
    ['double-quoted key', '"title": Hello'],
    ['single-quoted key', "'title': Hello"],
    ['escaped double quote', '"the \\"title\\"": Hello'],
    ['escaped single quote', "'author''s title': Hello"],
    ['quoted Unicode key', '"标题": Hello'],
    ['double-quoted colon', '"namespace:field": Hello'],
    ['single-quoted colon', "'namespace:field': Hello"],
    ['double-quoted backslash', '"path\\\\name": Hello'],
    ['single-quoted backslash', "'path\\name': Hello"],
    ['empty quoted key', '"": Hello'],
    ['quoted hash', '"# heading-like key": Hello'],
    ['comment before quoted key', '# Metadata\n"page title": Hello'],
  ])('keeps %s byte-exact when the body is edited', (_name, metadata) => {
    const prefix = `---\n${metadata}\n---\n\n`
    const source = `${prefix}Body remains text.`
    expect(isRoundTripSafe(source)).toBe(true)
    expect(splitFrontmatter(source)).toEqual({
      frontmatter: prefix,
      body: 'Body remains text.',
    })

    const { frontmatter, body } = splitFrontmatter(source)
    const editor = new Editor({
      extensions: createMarkdownContentExtensions(),
      content: parseMarkdownToDoc(body),
    })
    try {
      expect(editor.commands.insertContentAt(1, 'Edited ')).toBe(true)
      const saved = applyFrontmatter(
        frontmatter,
        postProcessSerializedMarkdown(editor.getMarkdown())
      )
      expect(saved).toBe(`${prefix}Edited Body remains text.`)
      expect(serializeMarkdownDocument(saved)).toBe(saved)
    } finally {
      editor.destroy()
    }
  })

  it('preserves comments, quoted keys, BOM, CRLF and the exact body separator together', () => {
    const prefix = '\uFEFF---\r\n# Metadata\r\n"title": Hello\r\n--- \t\r\n\r\n\r\n'
    const { frontmatter, body } = splitFrontmatter(`${prefix}Body`)
    expect(frontmatter).toBe(prefix)
    expect(body).toBe('Body')
    expect(serializeMarkdownDocument(`${frontmatter}Edited`)).toBe(`${prefix}Edited`)
  })

  it.each([
    ['heading', '---\n# Heading\n---\nBody'],
    ['heading and prose', '---\n# Heading\n\nProse\n---\nBody'],
    ['several headings', '---\n# Heading\n## Subheading\n---\nBody'],
    ['quoted prose', '---\n"A quotation"\n---\nBody'],
    ['quoted prose with a colon', '---\n"A quotation: with colon"\n---\nBody'],
    ['unclosed double quote', '---\n"title: Hello\n---\nBody'],
    ['unclosed single quote', "---\n'author's title': Hello\n---\nBody"],
    ['delimiter prefix', '---\n"title": Hello\n---not-a-delimiter\nBody'],
    ['delimiter prefix after a plain key', '---\ntitle: Hello\n---not-a-delimiter\nBody'],
    ['delimiter prefix as body', '---\n---not-a-delimiter\n---\nBody'],
  ])('keeps a leading thematic break and %s visible', (_name, source) => {
    expect(splitFrontmatter(source)).toEqual({ frontmatter: '', body: source })
  })
})
