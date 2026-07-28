/**
 * @vitest-environment node
 */
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { extractDocumentStyle } from '@/lib/copilot/vfs/document-style'

const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50

const THEME_XML =
  '<a:theme><a:themeElements><a:clrScheme>' +
  '<a:accent1><a:srgbClr val="4472C4"/></a:accent1>' +
  '</a:clrScheme><a:fontScheme>' +
  '<a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Calibri"/></a:minorFont>' +
  '</a:fontScheme></a:themeElements></a:theme>'

async function buildDocxArchive(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('word/theme/theme1.xml', THEME_XML)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/**
 * Overwrite every central-directory record's declared uncompressed size so the
 * archive claims a multi-gigabyte expansion without allocating it — the shape
 * of a zip bomb the guard rejects without decompressing anything.
 */
function forgeDeclaredUncompressedSize(zipBuffer: Buffer, declaredBytes: number): Buffer {
  const forged = Buffer.from(zipBuffer)
  for (let offset = 0; offset + 46 <= forged.length; offset++) {
    if (forged.readUInt32LE(offset) === CENTRAL_DIRECTORY_HEADER_SIGNATURE) {
      forged.writeUInt32LE(declaredBytes, offset + 24)
    }
  }
  return forged
}

describe('extractDocumentStyle zip-bomb guard', () => {
  it('refuses an archive whose declared expansion exceeds the limit', async () => {
    const bomb = forgeDeclaredUncompressedSize(await buildDocxArchive(), 0xfffffff0)
    await expect(extractDocumentStyle(bomb, 'docx')).resolves.toBeNull()
  })

  it('still extracts style from a well-formed archive', async () => {
    const summary = await extractDocumentStyle(await buildDocxArchive(), 'docx')

    expect(summary).not.toBeNull()
    expect(summary?.theme?.fonts.minor).toBe('Calibri')
    expect(summary?.theme?.colors.accent1).toBe('4472C4')
  })
})
