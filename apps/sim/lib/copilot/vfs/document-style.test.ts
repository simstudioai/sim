/**
 * @vitest-environment node
 */
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  /**
   * `extractDocumentStyle` swallows every failure and returns `null`, and a
   * forged archive is one JSZip rejects on its own — so asserting `null` passes
   * with the guard deleted. Spying on the decompressor is what actually proves
   * the buffer never reached it.
   */
  let loadAsync: ReturnType<typeof vi.spyOn<typeof JSZip, 'loadAsync'>>

  beforeEach(() => {
    loadAsync = vi.spyOn(JSZip, 'loadAsync')
  })

  afterEach(() => {
    loadAsync.mockRestore()
  })

  it('refuses an archive whose declared expansion exceeds the limit', async () => {
    const bomb = forgeDeclaredUncompressedSize(await buildDocxArchive(), 0xfffffff0)

    await expect(extractDocumentStyle(bomb, 'docx')).resolves.toBeNull()
    expect(loadAsync).not.toHaveBeenCalled()
  })

  it('refuses a bomb whose EOCD lies about the entry count behind an empty-EOCD decoy', async () => {
    const bomb = forgeDeclaredUncompressedSize(await buildDocxArchive(), 0xfffffff0)
    const eocdOffset = bomb.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    const cdOffset = bomb.readUInt32LE(eocdOffset + 16)
    const decoy = Buffer.alloc(22)
    decoy.writeUInt32LE(0x06054b50, 0)

    const realEocd = Buffer.from(bomb.subarray(eocdOffset))
    realEocd.writeUInt16LE(bomb.readUInt16LE(eocdOffset + 10) + 1, 8)
    realEocd.writeUInt16LE(bomb.readUInt16LE(eocdOffset + 10) + 1, 10)
    realEocd.writeUInt32LE(cdOffset + decoy.length, 16)

    const attack = Buffer.concat([
      bomb.subarray(0, cdOffset),
      decoy,
      bomb.subarray(cdOffset, eocdOffset),
      realEocd,
    ])

    await expect(extractDocumentStyle(attack, 'docx')).resolves.toBeNull()
    expect(loadAsync).not.toHaveBeenCalled()
  })

  it('still extracts style from a well-formed archive', async () => {
    const summary = await extractDocumentStyle(await buildDocxArchive(), 'docx')

    expect(loadAsync).toHaveBeenCalledTimes(1)
    expect(summary).not.toBeNull()
    expect(summary?.theme?.fonts.minor).toBe('Calibri')
    expect(summary?.theme?.colors.accent1).toBe('4472C4')
  })
})
