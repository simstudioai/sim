/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { agiloftRetrieveAttachmentTool } from '@/tools/agiloft/retrieve_attachment'

describe('Agiloft attachment file output', () => {
  it('preserves the canonical stored file descriptor without requiring inline data', async () => {
    const file = {
      id: 'stored-file',
      name: 'attachment.pdf',
      size: 12 * 1024 * 1024,
      type: 'application/pdf',
      url: '/api/files/stored',
      key: 'execution/attachment.pdf',
      context: 'execution',
    }
    const result = await agiloftRetrieveAttachmentTool.transformResponse!(
      Response.json({ success: true, output: { file } })
    )
    expect(result).toEqual({ success: true, output: { file } })
    expect(result.output.file).not.toHaveProperty('data')
    expect(result.output.file).not.toHaveProperty('mimeType')
  })
})
