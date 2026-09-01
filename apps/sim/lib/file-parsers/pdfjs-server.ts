import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/pdf'

/** Open a PDF with the server-compatible pdf.js build and hardened defaults. */
export async function openPdfDocument(data: Uint8Array): Promise<PDFDocumentProxy> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  return getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise
}
