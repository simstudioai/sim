/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { fileCompressTool } from '@/tools/file/compress'

describe('fileCompressTool', () => {
  it('builds a compress request body from file IDs and archive name', () => {
    const body = fileCompressTool.request.body?.({
      fileId: ['wf_a', 'wf_b'],
      archiveName: 'documents.zip',
      _context: { workspaceId: 'ws_1' },
    } as Parameters<NonNullable<typeof fileCompressTool.request.body>>[0])

    expect(body).toMatchObject({
      operation: 'compress',
      fileId: ['wf_a', 'wf_b'],
      archiveName: 'documents.zip',
      workspaceId: 'ws_1',
    })
  })

  it('forwards a selected file object when no IDs are provided', () => {
    const fileInput = { id: 'wf_c', name: 'report.pdf' }
    const body = fileCompressTool.request.body?.({
      fileInput,
      workspaceId: 'ws_2',
    } as Parameters<NonNullable<typeof fileCompressTool.request.body>>[0])

    expect(body).toMatchObject({
      operation: 'compress',
      fileInput,
      workspaceId: 'ws_2',
    })
  })

  it('returns the compressed archive on success', async () => {
    const archive = {
      id: 'wf_zip',
      name: 'archive.zip',
      size: 1024,
      url: 'https://example.com/archive.zip',
      type: 'application/zip',
      key: 'workspace/ws_1/archive.zip',
    }

    const result = await fileCompressTool.transformResponse?.(
      Response.json({
        success: true,
        data: {
          id: archive.id,
          name: archive.name,
          size: archive.size,
          url: archive.url,
          file: archive,
          files: [archive],
        },
      })
    )

    expect(result).toMatchObject({
      success: true,
      output: { id: 'wf_zip', name: 'archive.zip', size: 1024, files: [archive] },
    })
  })

  it('propagates route failures as tool failures', async () => {
    const result = await fileCompressTool.transformResponse?.(
      Response.json({ success: false, error: 'Combined input is too large to compress.' })
    )

    expect(result).toMatchObject({
      success: false,
      error: 'Combined input is too large to compress.',
      output: {},
    })
  })
})
