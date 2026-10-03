import { describe, expect, it } from 'vitest'
import { buildHtmlPreviewDocument } from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-panel'

const MARKED =
  '<!DOCTYPE html><html><head><meta name="sim-artifact"><title>T</title></head><body><div class="page"></div></body></html>'
const PLAIN = '<!DOCTYPE html><html><head><title>T</title></head><body><p>hi</p></body></html>'

describe('buildHtmlPreviewDocument', () => {
  it('injects the stylesheet only for a page that opted in', () => {
    expect(buildHtmlPreviewDocument(MARKED)).toContain('--surface-active')
    expect(buildHtmlPreviewDocument(PLAIN)).not.toContain('--surface-active')
  })

  it('keeps the sandbox guarantees on every path', () => {
    for (const doc of [MARKED, PLAIN, '<p>bare fragment</p>']) {
      const built = buildHtmlPreviewDocument(doc)
      expect(built).toContain("default-src 'none'")
      expect(built).toContain('about:srcdoc')
    }
  })
})
