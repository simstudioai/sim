import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  createBareSandboxContext,
  evaluateSandboxBundle,
} from '@/lib/execution/sandbox/bundles/verify'
import type { SandboxBundleName } from '@/lib/execution/sandbox/types'
import { docxGenerateTask } from '@/sandboxes/docx-generate'

function loadCheckedInBundle(name: SandboxBundleName): Record<string, unknown> {
  const source = readFileSync(new URL(`./${name}.cjs`, import.meta.url), 'utf-8')
  return evaluateSandboxBundle(source, name) as Record<string, unknown>
}

/**
 * The checked-in bundles are what Trigger.dev workers run verbatim, so this is
 * the only place a bundle that throws while being evaluated is caught before a
 * deploy. Each case asserts the surface the matching sandbox task's bootstrap
 * and finalize scripts reach for.
 */
describe('sandbox bundles', () => {
  it('docx evaluates in a bare context and exposes the docx-generate surface', () => {
    const docx = loadCheckedInBundle('docx')
    expect(typeof docx.Document).toBe('function')
    expect(typeof docx.Packer).toBe('function')
    expect(typeof docx.ImageRun).toBe('function')
    expect(typeof docx.Paragraph).toBe('function')
  })

  it('docx-generate packs a document with the checked-in bundle in a bare context', async () => {
    const context = createBareSandboxContext()
    evaluateSandboxBundle(
      readFileSync(new URL('./docx.cjs', import.meta.url), 'utf-8'),
      'docx',
      context
    )
    const runAsync = (body: string) => vm.runInContext(`(async () => { ${body} })()`, context)

    await runAsync(docxGenerateTask.bootstrap)
    await runAsync(
      "addSection({ children: [new docx.Paragraph({ children: [new docx.TextRun('R&D <ok>')] })] })"
    )
    const bytes: unknown = await runAsync(docxGenerateTask.finalize)

    expect(ArrayBuffer.isView(bytes)).toBe(true)
    const zip = await JSZip.loadAsync(bytes as Uint8Array)
    expect(await zip.file('word/document.xml')?.async('string')).toContain('R&amp;D &lt;ok&gt;')
  })

  it('docx encodes and decodes base64 through the btoa/atob the worker provides', async () => {
    const context = createBareSandboxContext()
    evaluateSandboxBundle(
      readFileSync(new URL('./docx.cjs', import.meta.url), 'utf-8'),
      'docx',
      context
    )
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

    const packed: unknown = await vm.runInContext(
      `(async () => {
        const docx = globalThis.__bundles.docx;
        const doc = new docx.Document({
          protection: { type: 'readOnly', password: 'secret' },
          sections: [{ children: [new docx.Paragraph({ children: [
            new docx.ImageRun({ type: 'png', data: 'data:image/png;base64,${pngBase64}', transformation: { width: 10, height: 10 } }),
          ] })] }],
        });
        return docx.Packer.toBase64String(doc);
      })()`,
      context
    )

    const zip = await JSZip.loadAsync(packed as string, { base64: true })
    expect(await zip.file('word/settings.xml')?.async('string')).toMatch(
      /<w:documentProtection[^>]*w:hash="[^"]+"/
    )
    expect(zip.file('word/media/image1.png')).not.toBeNull()
  })

  it('pdf-lib evaluates in a bare context and exposes the pdf-generate surface', () => {
    const pdfLib = loadCheckedInBundle('pdf-lib')
    expect(typeof pdfLib.PDFDocument).toBe('function')
    expect(typeof pdfLib.rgb).toBe('function')
    expect(typeof pdfLib.StandardFonts).toBe('object')
  })

  it('vitest-expect evaluates in a bare context and fails with uncolored vitest messages', () => {
    const bundle = loadCheckedInBundle('vitest-expect') as {
      createExpect: () => (value: unknown) => { toEqual: (expected: unknown) => void }
      fn: () => unknown
    }
    expect(typeof bundle.fn).toBe('function')
    const sandboxExpect = bundle.createExpect()
    let message = ''
    try {
      sandboxExpect({ channel: '#support' }).toEqual({ channel: '#billing' })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/channel: '#support'.*to deeply equal.*channel: '#billing'/)
    expect(message).not.toContain('\u001b[')
  })

  it('pptxgenjs evaluates in a bare context and exposes its constructor', () => {
    const source = readFileSync(new URL('./pptxgenjs.cjs', import.meta.url), 'utf-8')
    expect(typeof evaluateSandboxBundle(source, 'pptxgenjs')).toBe('function')
  })
})
