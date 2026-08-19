/**
 * @vitest-environment node
 */
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { extractDocAssets } from '@/lib/copilot/tools/server/files/doc-asset-extract'

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
