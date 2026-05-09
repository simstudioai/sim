/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { buildPresentation } from '@/lib/pptx-renderer/model/presentation'
import type { PptxFiles } from '@/lib/pptx-renderer/parser/zip-parser'

function createFiles(presentation: string): PptxFiles {
  return {
    contentTypes: '<Types />',
    presentation,
    presentationRels: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml" />
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml" />
    </Relationships>`,
    slides: new Map([
      ['ppt/slides/slide1.xml', createSlideXml()],
      ['ppt/slides/slide2.xml', createSlideXml()],
    ]),
    slideRels: new Map([
      ['ppt/slides/_rels/slide1.xml.rels', '<Relationships />'],
      ['ppt/slides/_rels/slide2.xml.rels', '<Relationships />'],
    ]),
    slideLayouts: new Map(),
    slideLayoutRels: new Map(),
    slideMasters: new Map(),
    slideMasterRels: new Map(),
    themes: new Map(),
    media: new Map(),
    charts: new Map(),
    chartStyles: new Map(),
    chartColors: new Map(),
    diagramDrawings: new Map(),
  }
}

function createPresentationXml(markers = ''): string {
  return `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ${markers}>
    <p:sldSz cx="9144000" cy="5143500" />
    <p:sldIdLst>
      <p:sldId id="256" r:id="rId2" />
      <p:sldId id="257" r:id="rId1" />
    </p:sldIdLst>
  </p:presentation>`
}

function createSlideXml(): string {
  return `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
    <p:cSld>
      <p:spTree>
        <p:nvGrpSpPr><p:cNvPr id="1" name="" /><p:cNvGrpSpPr /><p:nvPr /></p:nvGrpSpPr>
        <p:grpSpPr />
      </p:spTree>
    </p:cSld>
  </p:sld>`
}

describe('buildPresentation', () => {
  it('does not treat the standard wps namespace prefix as WPS Office', () => {
    const presentation = buildPresentation(
      createFiles(
        createPresentationXml(
          'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"'
        )
      )
    )

    expect(presentation.isWps).toBe(false)
  })

  it('orders slides by relationship id instead of numeric slide id', () => {
    const presentation = buildPresentation(createFiles(createPresentationXml()))

    expect(presentation.slides.map((slide) => slide.slidePath)).toEqual([
      'ppt/slides/slide2.xml',
      'ppt/slides/slide1.xml',
    ])
  })
})
