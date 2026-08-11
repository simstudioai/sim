/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolvePreviewType } from './preview-panel'

describe('resolvePreviewType', () => {
  it.each([
    ['text/markdown', 'notes.txt'],
    ['text/x-markdown', 'notes.txt'],
    [null, 'notes.md'],
    [null, 'notes.markdown'],
  ])('uses the shared Markdown eligibility for %s / %s', (mimeType, filename) => {
    expect(resolvePreviewType(mimeType, filename)).toBe('markdown')
  })
})
