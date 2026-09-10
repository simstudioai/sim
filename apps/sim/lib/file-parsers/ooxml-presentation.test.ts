/**
 * @vitest-environment node
 */
import JSZip, { type JSZipObject } from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileParserError } from '@/lib/file-parsers/errors'
import { MAX_OFFICE_XML_PART_BYTES } from '@/lib/file-parsers/office-text'
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
  /** Extra `<Relationship>` elements for the slide's own rels part. */
  extraRels?: string
}

const RELS_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** Lists the given slide part names in `p:sldIdLst` order, resolved through the presentation rels. */
function presentationParts(zip: JSZip, order: number[]): void {
  const ids = order.map((n, i) => `<p:sldId id="${256 + i}" r:id="rId${n}"/>`).join('')
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS}><p:sldIdLst>${ids}</p:sldIdLst></p:presentation>`
  )
  const rels = order
    .map(
      (n) => `<Relationship Id="rId${n}" Type="${REL_TYPE}/slide" Target="slides/slide${n}.xml"/>`
    )
    .join('')
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ${RELS_NS}>${rels}</Relationships>`
  )
}

async function buildDeck(slides: DeckSlide[], order?: number[]): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types/>')
  zip.file('ppt/media/image1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  if (order) presentationParts(zip, order)
  for (const slide of slides) {
    zip.file(`ppt/slides/slide${slide.index}.xml`, slideXml(slide.spTree))
    const rels: string[] = []
    if (slide.notesSpTree !== undefined) {
      rels.push(
        `<Relationship Id="rId2" Type="${REL_TYPE}/notesSlide" Target="../notesSlides/notesSlide${slide.index}.xml"/>`
      )
      zip.file(`ppt/notesSlides/notesSlide${slide.index}.xml`, notesXml(slide.notesSpTree))
    }
    if (slide.extraRels) rels.push(slide.extraRels)
    if (rels.length > 0) {
      zip.file(
        `ppt/slides/_rels/slide${slide.index}.xml.rels`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ${RELS_NS}>${rels.join('')}</Relationships>`
      )
    }
  }
  return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>
}

const DIAGRAM_FRAME = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="Diagram 5"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rId3" r:lo="rId4" r:qs="rId5" r:cs="rId6"/></a:graphicData></a:graphic></p:graphicFrame>`

const CHART_FRAME = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="Chart 6"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId3"/></a:graphicData></a:graphic></p:graphicFrame>`

function diagramDataXml(points: string[]): string {
  const pts = points
    .map(
      (text, i) =>
        `<dgm:pt modelId="{${i}}"><dgm:t><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></dgm:t></dgm:pt>`
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst><dgm:pt modelId="{doc}" type="doc"><dgm:t><a:p/></dgm:t></dgm:pt>${pts}</dgm:ptLst></dgm:dataModel>`
}

const CHART_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Revenue by </a:t></a:r><a:r><a:t>quarter</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:ser><c:idx val="0"/><c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:pt idx="0"><c:v>Sales</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>1st Qtr</c:v></c:pt><c:pt idx="1"><c:v>2nd Qtr</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:ser><c:idx val="1"/><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>Costs</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>1st Qtr</c:v></c:pt><c:pt idx="1"><c:v>2nd Qtr</c:v></c:pt></c:strCache></c:strRef></c:cat></c:ser></c:barChart><c:catAx><c:axId val="1"/><c:title><c:tx><c:rich><a:p><a:r><a:t>Quarter</a:t></a:r></a:p></c:rich></c:tx></c:title></c:catAx><c:valAx><c:axId val="2"/></c:valAx></c:plotArea></c:chart></c:chartSpace>`

describe('extractPresentationText', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

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
    const spTree = `<p:sp><p:nvSpPr><p:cNvPr id="1" name="s"/><p:cNvSpPr/></p:nvSpPr><p:txBody><a:p><a:r><a:t>Hello </a:t></a:r><a:r><a:t>world</a:t></a:r><a:br/><a:r><a:t>again</a:t></a:r></a:p></p:txBody></p:sp>`

    expect(await extractPresentationText(await buildDeck([{ index: 1, spTree }]))).toBe(
      'Hello world\nagain'
    )
  })

  it('walks the fallback branch of an AlternateContent wrapper, else its first choice', async () => {
    const spTree =
      `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="x">${shape('Choice text')}</mc:Choice><mc:Fallback>${shape('Fallback text')}</mc:Fallback></mc:AlternateContent>` +
      `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="x">${shape('Only choice')}</mc:Choice></mc:AlternateContent>`

    expect(await extractPresentationText(await buildDeck([{ index: 1, spTree }]))).toBe(
      'Fallback text\nOnly choice'
    )
  })

  it('skips slide-number fields outside their placeholder but keeps date fields', async () => {
    const spTree = `<p:sp><p:nvSpPr><p:cNvPr id="1" name="s"/><p:cNvSpPr/></p:nvSpPr><p:txBody><a:p><a:r><a:t>Page </a:t></a:r><a:fld type="slidenum"><a:t>369</a:t></a:fld><a:fld type="datetime1"><a:t>6/29/2021</a:t></a:fld><a:fld type="custom"><a:t>kept</a:t></a:fld></a:p></p:txBody></p:sp>`

    expect(await extractPresentationText(await buildDeck([{ index: 1, spTree }]))).toBe(
      'Page 6/29/2021kept'
    )
  })

  it('still drops a date field inside a dt placeholder', async () => {
    const spTree = `<p:sp><p:nvSpPr><p:cNvPr id="1" name="s"/><p:cNvSpPr/><p:nvPr><p:ph type="dt"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:fld type="datetime1"><a:t>6/29/2021</a:t></a:fld></a:p></p:txBody></p:sp>${shape('Body')}`

    expect(await extractPresentationText(await buildDeck([{ index: 1, spTree }]))).toBe('Body')
  })

  it('emits a picture as its alternative text unless it is a file name or auto caption', async () => {
    const pic = (descr: string) =>
      `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 3" descr="${descr}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr></p:pic>`
    const spTree = pic('Org chart') + pic('python-logo.gif') + pic('Picture 2') + shape('Caption')

    expect(await extractPresentationText(await buildDeck([{ index: 1, spTree }]))).toBe(
      '[Image: Org chart]\nCaption'
    )
  })

  it('ignores a notes relationship that escapes ppt/notesSlides', async () => {
    const zip = new JSZip()
    zip.file('ppt/slides/slide1.xml', slideXml(shape('Body')))
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../../docProps/app.xml"/></Relationships>`
    )
    zip.file('docProps/app.xml', notesXml(shape('Leaked', 'body')))
    const buffer = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer

    expect(await extractPresentationText(buffer)).toBe('Body')
  })

  it('rejects a slide part above the per-part size cap before parsing it', async () => {
    const buffer = await buildDeck([{ index: 1, spTree: shape('Small') }])
    const zip = await JSZip.loadAsync(buffer)
    const entry = zip.file('ppt/slides/slide1.xml') as JSZipObject & {
      _data: { uncompressedSize: number }
    }
    entry._data.uncompressedSize = MAX_OFFICE_XML_PART_BYTES + 1
    vi.spyOn(JSZip, 'loadAsync').mockResolvedValueOnce(zip)

    await expect(extractPresentationText(buffer)).rejects.toMatchObject<FileParserError>({
      code: 'complexity_limit',
    })
  })

  it('follows the presentation sldIdLst order rather than part numbering', async () => {
    const buffer = await buildDeck(
      [
        { index: 1, spTree: shape('One') },
        { index: 2, spTree: shape('Two') },
        { index: 3, spTree: shape('Three') },
      ],
      [3, 1, 2]
    )

    expect(await extractPresentationText(buffer)).toBe('Three\n\nOne\n\nTwo')
  })

  it('skips slide ids whose target is missing and falls back when none resolve', async () => {
    const withMissing = await buildDeck(
      [
        { index: 1, spTree: shape('One') },
        { index: 2, spTree: shape('Two') },
      ],
      [2, 9, 1]
    )
    expect(await extractPresentationText(withMissing)).toBe('Two\n\nOne')

    const noneResolve = await buildDeck([{ index: 1, spTree: shape('Only') }], [7])
    expect(await extractPresentationText(noneResolve)).toBe('Only')
  })

  it('reads SmartArt text from the diagram data part in document order', async () => {
    const zip = new JSZip()
    zip.file('ppt/slides/slide1.xml', slideXml(shape('Process', 'title') + DIAGRAM_FRAME))
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      `<Relationships ${RELS_NS}><Relationship Id="rId3" Type="${REL_TYPE}/diagramData" Target="../diagrams/data1.xml"/><Relationship Id="rId4" Type="${REL_TYPE}/diagramLayout" Target="../diagrams/layout1.xml"/></Relationships>`
    )
    zip.file('ppt/diagrams/data1.xml', diagramDataXml(['Plan', 'Build', 'Ship']))
    zip.file('ppt/diagrams/layout1.xml', '<dgm:layoutDef xmlns:dgm="x"/>')
    const buffer = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer

    expect(await extractPresentationText(buffer)).toBe('Process\n\nPlan\nBuild\nShip')
  })

  it('summarizes a chart as title, axis titles, series, and categories', async () => {
    const zip = new JSZip()
    zip.file('ppt/slides/slide1.xml', slideXml(CHART_FRAME))
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      `<Relationships ${RELS_NS}><Relationship Id="rId3" Type="${REL_TYPE}/chart" Target="../charts/chart1.xml"/></Relationships>`
    )
    zip.file('ppt/charts/chart1.xml', CHART_XML)
    const buffer = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer

    expect(await extractPresentationText(buffer)).toBe(
      '[Chart]\nRevenue by quarter\nQuarter\nSales\nCosts\n1st Qtr\n2nd Qtr\n[/Chart]'
    )
  })

  it('ignores a diagram target that escapes ppt/', async () => {
    const zip = new JSZip()
    zip.file('ppt/slides/slide1.xml', slideXml(shape('Body') + DIAGRAM_FRAME))
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      `<Relationships ${RELS_NS}><Relationship Id="rId3" Type="${REL_TYPE}/diagramData" Target="../../docProps/data1.xml"/></Relationships>`
    )
    zip.file('docProps/data1.xml', diagramDataXml(['Leaked']))
    const buffer = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer

    expect(await extractPresentationText(buffer)).toBe('Body')
  })

  it('includes text carried by a connector shape', async () => {
    const spTree = `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="9" name="Connector 8"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Yes</a:t></a:r></a:p></p:txBody></p:cxnSp>${shape('After')}`

    expect(await extractPresentationText(await buildDeck([{ index: 1, spTree }]))).toBe(
      'Yes\nAfter'
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
