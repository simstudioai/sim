/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { downloadArtifactTool, downloadArtifactV2Tool } from '@/tools/cursor/download_artifact'

describe('Cursor artifact output versions', () => {
  it('preserves legacy inline metadata', async () => {
    const file = { name: 'index.ts', mimeType: 'text/plain', data: 'YQ==', size: 1 }
    const result = await downloadArtifactTool.transformResponse!(
      Response.json({ success: true, output: { file } })
    )
    expect(result).toEqual({
      success: true,
      output: { content: 'Downloaded artifact: index.ts', metadata: file },
    })
  })

  it('preserves only the canonical stored file in v2', async () => {
    const file = {
      id: 'stored-file',
      name: 'index.ts',
      size: 12 * 1024 * 1024,
      type: 'text/plain',
      url: '/api/files/stored',
      key: 'execution/index.ts',
      context: 'execution',
    }
    const result = await downloadArtifactV2Tool.transformResponse!(
      Response.json({ success: true, output: { file } })
    )
    expect(result).toEqual({ success: true, output: { file } })
    expect(Object.keys(downloadArtifactV2Tool.outputs!)).toEqual(['file'])
  })
})
