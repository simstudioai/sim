/**
 * @vitest-environment node
 */
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { extractDocAssets } from '@/lib/copilot/tools/server/files/doc-asset-extract'
import { MAX_OOXML_CENTRAL_DIRECTORY_RECORDS, ZipBombError } from '@/lib/file-parsers/ooxml-limits'

const THEME_XML = `<?xml version="1.0"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F2937"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
      <a:accent2><a:srgbClr val="C0504D"/></a:accent2>
      <a:accent3><a:srgbClr val="9BBB59"/></a:accent3>
      <a:accent4><a:srgbClr val="8064A2"/></a:accent4>
      <a:accent5><a:srgbClr val="4BACC6"/></a:accent5>
      <a:accent6><a:srgbClr val="F79646"/></a:accent6>
      <a:hlink><a:srgbClr val="0000FF"/></a:hlink>
      <a:folHlink><a:srgbClr val="800080"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>`

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7])

async function buildPptx(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('ppt/theme/theme1.xml', THEME_XML)
  zip.file(
    'ppt/presentation.xml',
    '<p:presentation xmlns:p="x"><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/></p:presentation>'
  )
  zip.file('ppt/media/image1.png', PNG_BYTES)
  zip.file('ppt/media/image2.jpeg', JPG_BYTES)
  zip.file('ppt/slides/slide1.xml', '<p:sld/>')
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('extractDocAssets', () => {
  it('extracts theme colors, fonts, slide size, and media from a pptx', async () => {
    const { theme, media } = await extractDocAssets(await buildPptx(), 'pptx')
    expect(theme.format).toBe('pptx')
    expect(theme.colors).toMatchObject({
      dk1: '000000',
      lt1: 'FFFFFF',
      dk2: '1F2937',
      accent1: '4F81BD',
      accent6: 'F79646',
      hlink: '0000FF',
    })
    expect(theme.fonts).toEqual({ major: 'Calibri Light', minor: 'Calibri' })
    expect(theme.slideSize).toEqual({ widthIn: 13.33, heightIn: 7.5 })
    expect(media.map((m) => m.name)).toEqual(['image1.png', 'image2.jpeg'])
    expect(media[0]?.bytes.equals(PNG_BYTES)).toBe(true)
    expect(media[1]?.bytes.equals(JPG_BYTES)).toBe(true)
  })

  it('extracts from a docx under the word/ prefix without a slide size', async () => {
    const zip = new JSZip()
    zip.file('word/theme/theme1.xml', THEME_XML)
    zip.file('word/media/image1.png', PNG_BYTES)
    zip.file('word/document.xml', '<w:document/>')
    const { theme, media } = await extractDocAssets(
      await zip.generateAsync({ type: 'nodebuffer' }),
      'docx'
    )
    expect(theme.format).toBe('docx')
    expect(theme.colors.accent1).toBe('4F81BD')
    expect(theme.slideSize).toBeUndefined()
    expect(media.map((m) => m.name)).toEqual(['image1.png'])
  })

  it('extracts slide text/image layout, inheriting placeholder frames from the slide layout', async () => {
    const relNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    const zip = new JSZip()
    zip.file('ppt/theme/theme1.xml', THEME_XML)
    zip.file('ppt/media/image1.png', PNG_BYTES)
    zip.file(
      'ppt/slides/slide1.xml',
      `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>
<p:txBody><a:p><a:r><a:rPr lang="en-US" sz="3600" b="1"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:rPr><a:t>Q3 &amp; Q4 Results</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:spPr><a:xfrm><a:off x="914400" y="1828800"/><a:ext cx="4572000" cy="914400"/></a:xfrm></p:spPr>
<p:txBody><a:p><a:r><a:rPr sz="1400"><a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:latin typeface="Georgia"/></a:rPr><a:t>First line</a:t></a:r></a:p><a:p><a:r><a:t>Second line</a:t></a:r></a:p></p:txBody></p:sp>
<p:grpSp><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>grouped</a:t></a:r></a:p></p:txBody></p:sp></p:grpSp>
<p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr><a:xfrm><a:off x="1828800" y="914400"/><a:ext cx="1828800" cy="1828800"/></a:xfrm></p:spPr></p:pic>
</p:spTree></p:cSld></p:sld>`
    )
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      `<Relationships><Relationship Id="rId1" Type="${relNs}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${relNs}/image" Target="../media/image1.png"/></Relationships>`
    )
    zip.file(
      'ppt/slideLayouts/slideLayout1.xml',
      `<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="10972800" cy="1143000"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Click to edit</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sldLayout>`
    )
    const { theme, layout } = await extractDocAssets(
      await zip.generateAsync({ type: 'nodebuffer' }),
      'pptx'
    )
    expect(layout).toHaveLength(1)
    const slide = layout[0]
    expect(slide.slide).toBe(1)
    expect(slide.images).toEqual([{ name: 'image1.png', xIn: 2, yIn: 1, wIn: 2, hIn: 2 }])
    expect(theme.images?.['image1.png']?.placements).toEqual([
      { slide: 1, xIn: 2, yIn: 1, wIn: 2, hIn: 2 },
    ])
    expect(slide.texts).toHaveLength(2)
    expect(slide.texts[0]).toMatchObject({
      text: 'Q3 & Q4 Results',
      xIn: 1,
      yIn: 0.5,
      wIn: 12,
      hIn: 1.25,
      font: 'major',
      sizePt: 36,
      bold: true,
      schemeColor: 'accent1',
    })
    expect(slide.texts[0].colorHex).toBeUndefined()
    expect(slide.texts[1]).toMatchObject({
      text: 'First line\nSecond line',
      xIn: 1,
      yIn: 2,
      wIn: 5,
      hIn: 1,
      font: 'Georgia',
      sizePt: 14,
      colorHex: '112233',
    })
    expect(slide.texts[1].bold).toBeUndefined()
    expect(slide.texts.some((t) => t.text.includes('grouped'))).toBe(false)
  })

  it('refuses an archive the OOXML guard rejects', async () => {
    // Every media entry is inflated into a retained Buffer with no cap of its
    // own, so the guard is the only thing bounding this. Tripping its
    // record-count ceiling asserts the call site is guarded without building a
    // multi-megabyte fixture; the size ceilings are covered in zip-guard.test.ts.
    const zip = new JSZip()
    for (let index = 0; index <= MAX_OOXML_CENTRAL_DIRECTORY_RECORDS; index++) {
      zip.file(`ppt/media/image${index}.png`, PNG_BYTES)
    }

    await expect(
      extractDocAssets(await zip.generateAsync({ type: 'nodebuffer' }), 'pptx')
    ).rejects.toThrow(ZipBombError)
  })

  it('tolerates a package with no theme or media', async () => {
    const zip = new JSZip()
    zip.file('ppt/slides/slide1.xml', '<p:sld/>')
    const { theme, media } = await extractDocAssets(
      await zip.generateAsync({ type: 'nodebuffer' }),
      'pptx'
    )
    expect(theme.colors).toEqual({})
    expect(media).toEqual([])
  })
})
