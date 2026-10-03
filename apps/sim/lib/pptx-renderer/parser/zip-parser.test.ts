import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { parseZip } from '@/lib/pptx-renderer/parser/zip-parser'

async function createZip(entries: Record<string, string | Uint8Array>): Promise<ArrayBuffer> {
  const zip = new JSZip()
  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content)
  }
  return zip.generateAsync({ type: 'arraybuffer' })
}

describe('parseZip', () => {
  it('rejects archives that exceed entry limits', async () => {
    const buffer = await createZip({
      '[Content_Types].xml': '<Types />',
      'ppt/presentation.xml': '<p:presentation />',
    })

    await expect(parseZip(buffer, { maxEntries: 1 })).rejects.toThrow(
      'PPTX zip limit exceeded: entries 2 > maxEntries 1'
    )
  })

  it('rejects archives that exceed media byte limits', async () => {
    const buffer = await createZip({
      'ppt/media/image1.png': new Uint8Array([1, 2, 3, 4]),
    })

    await expect(parseZip(buffer, { maxMediaBytes: 3 })).rejects.toThrow('PPTX zip limit exceeded')
  })
})
