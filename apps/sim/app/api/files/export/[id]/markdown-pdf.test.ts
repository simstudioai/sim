/**
 * @vitest-environment node
 */
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { renderMarkdownPdf } from '@/app/api/files/export/[id]/markdown-pdf'

describe('Markdown PDF rendering', () => {
  it('creates a valid multi-page PDF with GFM and an embedded image', async () => {
    const image = await sharp({
      create: {
        width: 120,
        height: 60,
        channels: 3,
        background: '#4f46e5',
      },
    })
      .png()
      .toBuffer()
    const repeatedParagraphs = Array.from(
      { length: 70 },
      (_, index) => `Paragraph ${index + 1} with **bold**, _italic_, and \`inline code\`.`
    ).join('\n\n')
    const markdown = `# Export title

> A useful blockquote with a [link](https://sim.ai).

Smart quotes “work”, Greek Ω stays readable, and unsupported emoji 🚀 falls back safely.

- First item
- Second item

| Name | Value |
| --- | ---: |
| Alpha | 1 |
| Beta | 2 |

\`\`\`ts
const exported = true
\`\`\`

![Embedded image](/workspace/ws-1/files/image-1)

${repeatedParagraphs}`

    const buffer = await renderMarkdownPdf({
      markdown,
      title: 'Export title',
      images: new Map([['image-1', image]]),
    })

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
    expect(buffer.length).toBeGreaterThan(1_000)

    const document = await PDFDocument.load(buffer)
    expect(document.getTitle()).toBe('Export title')
    expect(document.getPageCount()).toBeGreaterThan(1)
  })

  it('falls back instead of decoding an image above the pixel ceiling', async () => {
    const oversizedSvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="20000"><rect width="100%" height="100%" fill="red"/></svg>'
    )

    const buffer = await renderMarkdownPdf({
      markdown: '![Too large](/api/files/view/image-1)',
      title: 'Bounded image',
      images: new Map([['image-1', oversizedSvg]]),
    })

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
    expect((await PDFDocument.load(buffer)).getPageCount()).toBe(1)
  })
})
