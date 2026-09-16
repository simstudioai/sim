/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { StoredToolFile } from '@/lib/internal/tool-operations/file-result'
import { getItemFileTool } from '@/tools/onepassword/get_item_file'

describe('onepassword_get_item_file transform', () => {
  it('preserves the stored file descriptor for downstream file consumers', async () => {
    const file: StoredToolFile = {
      id: 'stored-file-1',
      key: 'execution/workspace-1/workflow-1/execution-1/file.bin',
      url: '/api/files/serve/stored-file-1',
      name: 'file.bin',
      type: 'application/octet-stream',
      mimeType: 'application/octet-stream',
      size: 11 * 1024 * 1024,
      context: 'execution',
    }

    const result = await getItemFileTool.transformResponse!(Response.json({ file }))

    expect(result).toEqual({ success: true, output: { file } })
    expect(result.output.file).not.toHaveProperty('data')
  })
})
