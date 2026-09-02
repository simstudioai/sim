/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { evaluateSandboxBundle } from '@/lib/execution/sandbox/bundles/verify'
import type { SandboxBundleName } from '@/lib/execution/sandbox/types'

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

  it('pdf-lib evaluates in a bare context and exposes the pdf-generate surface', () => {
    const pdfLib = loadCheckedInBundle('pdf-lib')
    expect(typeof pdfLib.PDFDocument).toBe('function')
    expect(typeof pdfLib.rgb).toBe('function')
    expect(typeof pdfLib.StandardFonts).toBe('object')
  })

  it('pptxgenjs evaluates in a bare context and exposes its constructor', () => {
    const source = readFileSync(new URL('./pptxgenjs.cjs', import.meta.url), 'utf-8')
    expect(typeof evaluateSandboxBundle(source, 'pptxgenjs')).toBe('function')
  })
})
