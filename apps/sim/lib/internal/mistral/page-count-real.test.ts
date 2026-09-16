/**
 * @vitest-environment node
 */
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { countMistralPdfPages } from '@/lib/internal/mistral/page-count'

describe('Mistral real PDF page measurement', () => {
  it('counts a real synthetic PDF without extracting or sending its content', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage()
    pdf.addPage()
    const bytes = Buffer.from(await pdf.save())
    await expect(countMistralPdfPages(bytes)).resolves.toBe(2)
  })
})
