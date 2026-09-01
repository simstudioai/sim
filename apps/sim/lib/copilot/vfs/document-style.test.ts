/**
 * @vitest-environment node
 */
import { deflateRawSync } from 'zlib'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLoadAsync } = vi.hoisted(() => ({ mockLoadAsync: vi.fn() }))

vi.mock('jszip', () => ({ default: { loadAsync: mockLoadAsync } }))

import { extractDocumentStyle } from '@/lib/copilot/vfs/document-style'

const THEME_XML = `<?xml version="1.0"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>`

interface ZipEntryInput {
  name: string
  content: string
  /** Overrides the uncompressed size written to both headers, to model a lying archive. */
  declaredUncompressedSize?: number
}

/**
 * Emit a ZIP archive byte by byte. Generating one with a library and patching it
 * afterwards cannot express a declared size that never matched the payload, and
 * that divergence is the whole subject of these tests.
 */
function buildZip(entries: ZipEntryInput[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.from(entry.content, 'utf8')
    const deflated = deflateRawSync(raw)
    const declared = entry.declaredUncompressedSize ?? raw.length

    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt32LE(0, 14) // crc32 — nothing under test validates it
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(declared, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    locals.push(local, deflated)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10) // deflate
    central.writeUInt32LE(0, 16)
    central.writeUInt32LE(deflated.length, 20)
    central.writeUInt32LE(declared, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centrals.push(central)

    offset += local.length + deflated.length
  }

  const centralDirectory = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, centralDirectory, eocd])
}

/** Stand-in for a loaded JSZip archive, serving the parts the extractor asks for. */
function fakeArchive(files: Record<string, string>) {
  return {
    file: (path: string) => (files[path] ? { async: async () => files[path] } : null),
  }
}

describe('extractDocumentStyle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('extracts theme colors and fonts from a well-formed docx', async () => {
    mockLoadAsync.mockResolvedValue(fakeArchive({ 'word/theme/theme1.xml': THEME_XML }))

    const summary = await extractDocumentStyle(
      buildZip([{ name: 'word/theme/theme1.xml', content: THEME_XML }]),
      'docx'
    )

    expect(mockLoadAsync).toHaveBeenCalledOnce()
    expect(summary?.theme?.colors).toMatchObject({
      dk1: '000000',
      lt1: 'FFFFFF',
      accent1: '4472C4',
    })
    expect(summary?.theme?.fonts).toEqual({ major: 'Calibri Light', minor: 'Calibri' })
  })

  it('extracts theme data from a well-formed pptx', async () => {
    mockLoadAsync.mockResolvedValue(fakeArchive({ 'ppt/theme/theme1.xml': THEME_XML }))

    const summary = await extractDocumentStyle(
      buildZip([{ name: 'ppt/theme/theme1.xml', content: THEME_XML }]),
      'pptx'
    )

    expect(summary?.theme?.fonts.minor).toBe('Calibri')
  })

  it('never hands JSZip an archive declaring more expansion than the guard allows', async () => {
    // JSZip would also fail this archive — but only after inflating the entry,
    // which is the memory cost the guard exists to avoid. Asserting on the
    // return value alone cannot tell the two apart, so assert JSZip is never
    // reached.
    const bomb = buildZip([
      {
        name: 'word/theme/theme1.xml',
        content: THEME_XML,
        declaredUncompressedSize: 2 * 1024 * 1024 * 1024,
      },
    ])

    expect(await extractDocumentStyle(bomb, 'docx')).toBeNull()
    expect(mockLoadAsync).not.toHaveBeenCalled()
  })

  it('never hands JSZip an archive with an implausible compression ratio', async () => {
    // 400 MiB sits under the 1 GiB absolute cap, so this exercises the ratio
    // check rather than the size check. Declaring the expansion rather than
    // carrying it keeps the fixture a few hundred bytes — the guard reads the
    // declared total, so a real payload would only cost the suite memory.
    const bomb = buildZip([
      {
        name: 'word/theme/theme1.xml',
        content: THEME_XML,
        declaredUncompressedSize: 400 * 1024 * 1024,
      },
    ])

    expect(await extractDocumentStyle(bomb, 'docx')).toBeNull()
    expect(mockLoadAsync).not.toHaveBeenCalled()
  })

  it('returns null for a buffer that is not a ZIP archive', async () => {
    expect(await extractDocumentStyle(Buffer.from('not an archive at all'), 'docx')).toBeNull()
    expect(await extractDocumentStyle(Buffer.alloc(2), 'docx')).toBeNull()
    expect(mockLoadAsync).not.toHaveBeenCalled()
  })
})
