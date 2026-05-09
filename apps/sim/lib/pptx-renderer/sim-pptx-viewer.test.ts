/**
 * @vitest-environment jsdom
 */
import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import { openSimPptxViewer, SIM_PPTX_LIST_OPTIONS } from '@/lib/pptx-renderer/sim-pptx-viewer'

async function createMinimalPptx(): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types />')
  zip.file(
    'ppt/presentation.xml',
    `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:sldSz cx="9144000" cy="5143500" />
      <p:sldIdLst><p:sldId id="256" r:id="rId1" /></p:sldIdLst>
    </p:presentation>`
  )
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml" />
    </Relationships>`
  )
  zip.file(
    'ppt/slides/slide1.xml',
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld>
        <p:spTree>
          <p:nvGrpSpPr><p:cNvPr id="1" name="" /><p:cNvGrpSpPr /><p:nvPr /></p:nvGrpSpPr>
          <p:grpSpPr />
        </p:spTree>
      </p:cSld>
    </p:sld>`
  )
  zip.file('ppt/slides/_rels/slide1.xml.rels', '<Relationships />')
  return zip.generateAsync({ type: 'arraybuffer' })
}

describe('openSimPptxViewer', () => {
  it('renders a minimal PPTX and cleans up the container on destroy', async () => {
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 960 })
    const onRenderComplete = vi.fn()

    const handle = await openSimPptxViewer({
      buffer: await createMinimalPptx(),
      container,
      onRenderComplete,
    })

    expect(onRenderComplete).toHaveBeenCalled()
    expect(container.querySelector('[data-slide-index="0"]')).not.toBeNull()

    handle.destroy()
    expect(container.innerHTML).toBe('')
  })

  it('uses windowed list rendering defaults for large decks', () => {
    expect(SIM_PPTX_LIST_OPTIONS).toMatchObject({
      windowed: true,
      batchSize: 8,
      initialSlides: 4,
    })
  })
})
