/**
 * @vitest-environment node
 */
import { PDFDocument } from 'pdf-lib'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { MarkdownPdfLimitError, renderMarkdownPdf } from '@/app/api/files/export/[id]/markdown-pdf'

async function pdfPagesText(buffer: Buffer): Promise<string[]> {
  const document = await getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise
  try {
    return await Promise.all(
      Array.from({ length: document.numPages }, async (_, index) => {
        const page = await document.getPage(index + 1)
        const content = await page.getTextContent()
        return content.items.map((item) => ('str' in item ? item.str : '')).join(' ')
      })
    )
  } finally {
    await document.destroy()
  }
}

describe('Markdown PDF rendering', () => {
  it('creates a valid multi-page PDF with GFM and an embedded image', async () => {
    const imageKey = 'workspace/ws-1/editor-image.png'
    const imageUrl = `/api/files/serve/${encodeURIComponent(imageKey)}?context=workspace`
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

Smart quotes “work” and Greek Ω stays readable.

中文排版应该清晰易读。 العربية يجب أن تكون متصلة ومقروءة. हिन्दी पाठ स्पष्ट और पठनीय होना चाहिए। עברית צריכה להיות ברורה וקריאה.

- First item
- Second item

| Name | Value |
| --- | ---: |
| Alpha | 1 |
| Beta | 2 |

\`\`\`ts
const exported = true
\`\`\`

![Embedded image](${imageUrl})

<img src="${imageUrl}" alt="Resized image" width="240" height="120">

${repeatedParagraphs}`

    const buffer = await renderMarkdownPdf({
      markdown,
      title: 'Export title',
      images: new Map([[`key:${imageKey}`, image]]),
    })

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
    expect(buffer.length).toBeGreaterThan(1_000)

    const document = await PDFDocument.load(buffer)
    expect(document.getTitle()).toBe('Export title')
    expect(document.getPageCount()).toBeGreaterThan(1)

    const text = (await pdfPagesText(buffer)).join(' ')
    expect(text).toContain('中文排版应该清晰易读')
    expect(text).toContain('العربية')
    // PDF extractors expose visually positioned Indic vowel marks before their base character.
    expect(text).toMatch(/[\u0900-\u097f]{4,}/u)
    expect(text).toContain('עברית')
    expect(text).not.toContain('Image: Embedded image')

    const parsed = await getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise
    try {
      let imagePaints = 0
      for (let pageNumber = 1; pageNumber <= parsed.numPages; pageNumber += 1) {
        const operators = await (await parsed.getPage(pageNumber)).getOperatorList()
        imagePaints += operators.fnArray.filter(
          (operator) =>
            operator === OPS.paintImageXObject || operator === OPS.paintInlineImageXObject
        ).length
      }
      expect(imagePaints).toBeGreaterThanOrEqual(2)
    } finally {
      await parsed.destroy()
    }
  })

  it('keeps long table rows together and repeats the header across table pages', async () => {
    const rows = Array.from(
      { length: 90 },
      (_, index) =>
        `| Row ${index + 1} | Description ${index + 1} with enough text to exercise wrapping |`
    ).join('\n')
    const buffer = await renderMarkdownPdf({
      markdown: `# Table report\n\n| Name | Value |\n| --- | --- |\n${rows}`,
      title: 'Table report',
    })

    const pages = await pdfPagesText(buffer)
    const tablePages = pages.filter((page) => page.includes('Row '))
    expect(tablePages.length).toBeGreaterThan(1)
    expect(tablePages.every((page) => page.includes('Name') && page.includes('Value'))).toBe(true)
  })

  it('renders a table that contains only a header', async () => {
    const buffer = await renderMarkdownPdf({
      markdown: '| Name | Value |\n| --- | --- |',
      title: 'Header-only table',
    })

    const text = (await pdfPagesText(buffer)).join(' ')
    expect(text).toContain('Name')
    expect(text).toContain('Value')
  })

  it('falls back instead of decoding an image above the pixel ceiling', async () => {
    const oversizedSvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="20000"><rect width="100%" height="100%" fill="red"/></svg>'
    )

    const buffer = await renderMarkdownPdf({
      markdown: '![Too large](/api/files/view/image-1)',
      title: 'Bounded image',
      images: new Map([['id:image-1', oversizedSvg]]),
    })

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
    expect((await PDFDocument.load(buffer)).getPageCount()).toBe(1)
    expect((await pdfPagesText(buffer)).join(' ')).toContain('Image: Too large')
  })

  it('rejects a pathological number of document blocks before PDF layout', async () => {
    const markdown = Array.from({ length: 3_001 }, (_, index) => `Paragraph ${index}`).join('\n\n')

    await expect(renderMarkdownPdf({ markdown, title: 'Too many blocks' })).rejects.toBeInstanceOf(
      MarkdownPdfLimitError
    )
  })
})
