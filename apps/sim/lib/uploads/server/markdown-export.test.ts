/**
 * @vitest-environment node
 */
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import {
  createMarkdownExport,
  MAX_EXPORT_MARKDOWN_PARSE_BYTES,
} from '@/lib/uploads/server/markdown-export'

vi.mock('@/lib/uploads/core/storage-service', () => ({ downloadFile: vi.fn() }))

async function exportMarkdown(content: string, name = 'image.png') {
  const result = await createMarkdownExport({
    content: Buffer.from(content),
    fileName: 'document.md',
    assets: [
      {
        imageId: 'image-1',
        key: 'workspace/image-1',
        context: 'workspace',
        originalName: name,
        size: 3,
      },
    ],
  })
  const zip = await JSZip.loadAsync(result.buffer)
  return zip.file('document.md')!.async('string')
}

describe('Markdown export image rewriting', () => {
  beforeEach(() => vi.mocked(downloadFile).mockReset().mockResolvedValue(Buffer.from('png')))

  it('preserves BOM and frontmatter values even if they contain image markup', async () => {
    const source =
      '\uFEFF---\r\ntitle: "![metadata](/api/files/view/image-1)"\r\n---\r\n\r\n![body](/api/files/view/image-1)\r\n'
    expect(await exportMarkdown(source)).toBe(
      source.replace('![body](/api/files/view/image-1)', '![body](./assets/image.png)')
    )
  })

  it('returns large documents verbatim before parsing or fetching assets', async () => {
    const content = Buffer.from(
      '![image](/api/files/view/image-1)\n' + 'a'.repeat(MAX_EXPORT_MARKDOWN_PARSE_BYTES)
    )
    const result = await createMarkdownExport({
      content,
      fileName: 'large.md',
      assets: [
        {
          imageId: 'image-1',
          key: 'workspace/image-1',
          context: 'workspace',
          originalName: 'image.png',
          size: 3,
        },
      ],
    })
    expect(result).toMatchObject({ format: 'markdown', assetCount: 0, fileName: 'large.md' })
    expect(result.buffer).toBe(content)
    expect(downloadFile).not.toHaveBeenCalled()
  })

  it('does not reinterpret escaped HTML or image markup as an embed', async () => {
    const source =
      '\\<img src=/api/files/view/image-1> &lt;img src="/api/files/view/image-1"> \\![escaped](/api/files/view/image-1)\n\n![visible](/api/files/view/image-1)'
    expect(await exportMarkdown(source)).toBe(
      source.replace('![visible](/api/files/view/image-1)', '![visible](./assets/image.png)')
    )
  })

  it('rewrites only the image, preserving matching links, prose, and code byte for byte', async () => {
    const source =
      '![image](/api/files/view/image-1)\r\n\r\n[link](/api/files/view/image-1)\r\n/api/files/view/image-1\r\n`![image](/api/files/view/image-1)`\r\n\r\n```md\r\n![image](/api/files/view/image-1)\r\n```\r\n'
    expect(await exportMarkdown(source)).toBe(
      source.replace('![image](/api/files/view/image-1)', '![image](./assets/image.png)')
    )
  })

  it('does not change another image whose id starts with a bundled id', async () => {
    const source = '![one](/api/files/view/image-1) ![ten](/api/files/view/image-10)'
    expect(await exportMarkdown(source)).toBe(
      '![one](./assets/image.png) ![ten](/api/files/view/image-10)'
    )
  })

  it('preserves a shared reference definition and ordinary link while localizing the image', async () => {
    const source =
      '![photo][asset]\n\n[download][asset]\n\n[asset]: /api/files/view/image-1 "Caption"\n'
    expect(await exportMarkdown(source)).toBe(
      '![photo](./assets/image.png "Caption")\n\n[download][asset]\n\n[asset]: /api/files/view/image-1 "Caption"\n'
    )
  })

  it('changes only HTML img src attributes, not links, comments, code, or other attributes', async () => {
    const source =
      '<img alt="/api/files/view/image-1" src="/api/files/view/image-1" width="50">\n\n<a href="/api/files/view/image-1">link</a>\n<!-- <img src="/api/files/view/image-1"> -->\n<code><img src="/api/files/view/image-1"></code>\n'
    expect(await exportMarkdown(source)).toBe(
      source.replace('src="/api/files/view/image-1"', 'src="./assets/image.png"')
    )
  })

  it.each(['pre', 'code', 'kbd', 'script', 'style'])(
    'preserves raw-source content in %s across inline and block HTML',
    async (tag) => {
      const source = `![visible](/api/files/view/image-1)\n\n<${tag}>before ![hidden](/api/files/view/image-1) <img src="/api/files/view/image-1"> after</${tag}>\n\n![after](/api/files/view/image-1)`
      expect(await exportMarkdown(source)).toBe(
        source
          .replace('![visible](/api/files/view/image-1)', '![visible](./assets/image.png)')
          .replace('![after](/api/files/view/image-1)', '![after](./assets/image.png)')
      )
    }
  )

  it.each(['"', "'", ''])(
    'handles quoted and unquoted HTML sources without changing dimensions: %s',
    async (quote) => {
      expect(
        await exportMarkdown(`<img width=50 src=${quote}/api/files/view/image-1${quote} height=60>`)
      ).toBe('<img width=50 src="./assets/image.png" height=60>')
    }
  )

  it('uses only the first HTML src attribute', async () => {
    const source =
      '<img src="external.png" src="/api/files/view/image-1">\n\n![visible](/api/files/view/image-1)'
    expect(await exportMarkdown(source)).toBe(
      source.replace('![visible](/api/files/view/image-1)', '![visible](./assets/image.png)')
    )
  })

  it('preserves image nesting in links, lists, blockquotes, and GFM tables', async () => {
    const source =
      '[![linked](/api/files/view/image-1)](/api/files/view/image-1)\n\n- [ ] ![task](/workspace/ws/files/image-1)\n  - ![child](/api/files/view/image-1)\n\n> ![quoted](/api/files/view/image-1)\n\n| header |\n| --- |\n| ![cell](/api/files/view/image-1) |\n'
    const expected =
      '[![linked](./assets/image.png)](/api/files/view/image-1)\n\n- [ ] ![task](./assets/image.png)\n  - ![child](./assets/image.png)\n\n> ![quoted](./assets/image.png)\n\n| header |\n| --- |\n| ![cell](./assets/image.png) |\n'
    expect(await exportMarkdown(source)).toBe(expected)
  })

  it('keeps image labels and titles safe inside a GFM table cell', async () => {
    const source = '| header |\n| --- |\n| ![a\\|b](/api/files/view/image-1 "one\\|two") |\n'
    expect(await exportMarkdown(source)).toBe(
      '| header |\n| --- |\n| ![a\\|b](./assets/image.png "one\\|two") |\n'
    )
  })

  it('preserves all source between separate HTML fragments and Markdown images', async () => {
    const source =
      'start <img src="/api/files/view/image-1"> middle ![md](/api/files/view/image-1) end <img src="/api/files/view/image-1">\n\n> <img\n>   src="/api/files/view/image-1"\n>   width="50">\n'
    expect(await exportMarkdown(source)).toBe(
      'start <img src="./assets/image.png"> middle ![md](./assets/image.png) end <img src="./assets/image.png">\n\n> <img\n>   src="./assets/image.png"\n>   width="50">\n'
    )
  })

  it('URL-encodes asset filenames that contain spaces, delimiters, or unicode', async () => {
    expect(await exportMarkdown('![image](/api/files/view/image-1)', 'a #?🖼.png')).toBe(
      '![image](./assets/a%20%23%3F%F0%9F%96%BC.png)'
    )
  })

  it.each(['![asset][]', '![asset]', '![photo][ASSET]'])(
    'localizes collapsed, shortcut, and case-folded references: %s',
    async (image) => {
      const source = `${image}\n\n[asset]: /api/files/view/image-1\n`
      const alt = image.includes('photo') ? 'photo' : 'asset'
      expect(await exportMarkdown(source)).toBe(
        `![${alt}](./assets/image.png)\n\n[asset]: /api/files/view/image-1\n`
      )
    }
  )
})
