/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { fileWriteTool } from '@/tools/file/write'

describe('fileWriteTool', () => {
  it('passes nested relative paths through the existing fileName parameter', () => {
    expect(
      fileWriteTool.request.body?.({
        fileName: 'Reports/2026/report.md',
        content: 'report',
        workspaceId: 'workspace-1',
      })
    ).toMatchObject({
      operation: 'write',
      fileName: 'Reports/2026/report.md',
      workspaceId: 'workspace-1',
    })
  })

  it('declares and returns the canonical created path', async () => {
    expect(fileWriteTool.outputs?.vfsPath).toMatchObject({
      type: 'string',
      description: expect.stringContaining('Canonical workspace path'),
    })

    const result = await fileWriteTool.transformResponse?.(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            id: 'file-1',
            name: 'report.md',
            vfsPath: 'files/Reports/2026/report.md',
          },
        })
      )
    )
    expect(result).toMatchObject({
      success: true,
      output: { vfsPath: 'files/Reports/2026/report.md' },
    })
  })
})
