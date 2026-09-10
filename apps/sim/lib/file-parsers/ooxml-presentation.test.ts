/**
 * @vitest-environment node
 */
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { extractPresentationText } from '@/lib/file-parsers/ooxml-presentation'

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

function shape(text: string, placeholderType?: string): string {
  const ph =
    placeholderType === undefined ? '' : `<p:nvPr><p:ph type="${placeholderType}"/></p:nvPr>`
  return `<p:sp><p:nvSpPr><p:cNvPr id="1" name="s"/><p:cNvSpPr/>${ph}</p:nvSpPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
}

function slideXml(spTree: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:spTree>${spTree}</p:spTree></p:cSld></p:sld>`
}

function notesXml(spTree: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes ${NS}><p:cSld><p:spTree>${spTree}</p:spTree></p:cSld></p:notes>`
}

interface DeckSlide {
  index: number
  spTree: string
  notesSpTree?: string
}

async function buildDeck(slides: DeckSlide[]): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types/>')
  zip.file('ppt/media/image1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  for (const slide of slides) {
    zip.file(`ppt/slides/slide${slide.index}.xml`, slideXml(slide.spTree))
    if (slide.notesSpTree !== undefined) {
      zip.file(
        `ppt/slides/_rels/slide${slide.index}.xml.rels`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${slide.index}.xml"/></Relationships>`
      )
      zip.file(`ppt/notesSlides/notesSlide${slide.index}.xml`, notesXml(slide.notesSpTree))
    }
  }
  return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>
}

describe('extractPresentationText', () => {
  it('emits titles and body paragraphs while skipping layout placeholders', async () => {
    const buffer = await buildDeck([
      {
        index: 1,
        spTree:
          shape('Deck Title', 'ctrTitle') +
          shape('First point', 'body') +
          shape('7', 'sldNum') +
          shape('2026-01-01', 'dt') +
          shape('Confidential', 'ftr') +
          shape('testdoc', 'hdr'),
      },
    ])

    const text = await extractPresentationText(buffer)

    expect(text).toBe('Deck Title\n\nFirst point')
  })

  it('renders a graphic-frame table as rows', async () => {
    const cell = (value: string) =>
      `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>${value}</a:t></a:r></a:p></a:txBody></a:tc>`
    const spTree =
      shape('Roles', 'title') +
      `<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr>${cell('Role')}${cell('Contact')}</a:tr><a:tr>${cell('Owner')}${cell('ops@example.com')}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`

    const text = await extractPresentationText(await buildDeck([{ index: 1, spTree }]))

    expect(text).toContain('[Table]\n| Role | Contact |\n| Owner | ops@example.com |\n[/Table]')
  })

  it('takes only the body placeholder from a notes page', async () => {
    const buffer = await buildDeck([
      {
        index: 1,
        spTree: shape('Slide body', 'body'),
        notesSpTree:
          shape('testdoc', 'hdr') +
          shape('Speaker reminder', 'body') +
          shape('1', 'sldNum') +
          `<p:sp><p:nvSpPr><p:cNvPr id="2" name="thumb"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp>`,
      },
    ])

    const text = await extractPresentationText(buffer)

    expect(text).toBe('Slide body\n[Notes]\nSpeaker reminder')
  })

  it('omits the notes marker when the notes body is empty', async () => {
    const buffer = await buildDeck([
      { index: 1, spTree: shape('Only slide', 'body'), notesSpTree: shape('3', 'sldNum') },
    ])

    expect(await extractPresentationText(buffer)).toBe('Only slide')
  })

  it('orders slide10 after slide9 and separates slides with a blank line', async () => {
    const buffer = await buildDeck([
      { index: 10, spTree: shape('Tenth') },
      { index: 9, spTree: shape('Ninth') },
      { index: 2, spTree: shape('Second') },
    ])

    expect(await extractPresentationText(buffer)).toBe('Second\n\nNinth\n\nTenth')
  })

  it('recurses into group shapes in document order', async () => {
    const spTree = `<p:grpSp><p:nvGrpSpPr/>${shape('Grouped one')}<p:grpSp>${shape('Nested two')}</p:grpSp></p:grpSp>${shape('After group')}`

    expect(await extractPresentationText(await buildDeck([{ index: 1, spTree }]))).toBe(
      'Grouped one\nNested two\nAfter group'
    )
  })

  it('joins runs within a paragraph and turns line breaks into newlines', async () => {
    const spTree = `<p:sp><p:nvSpPr><p:cNvPr id="1" name="s"/><p:cNvSpPr/></p:nvSpPr><p:txBody><a:p><a:r><a:t>Hello </a:t></a:r><a:r><a:t>world</a:t></a:r><a:br/><a:fld type="slidenum"><a:t>‹#›</a:t></a:fld></a:p></p:txBody></p:sp>`

    expect(await extractPresentationText(await buildDeck([{ index: 1, spTree }]))).toBe(
      'Hello world\n‹#›'
    )
  })

  it('rejects when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      extractPresentationText(await buildDeck([{ index: 1, spTree: shape('x') }]), {
        signal: controller.signal,
      })
    ).rejects.toThrow()
  })
})
