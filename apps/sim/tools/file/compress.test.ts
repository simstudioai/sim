/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { fileCompressTool, fileDecompressTool } from '@/tools/file/compress'

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

describe('fileDecompressTool', () => {
  it('builds a decompress request body from a file ID', () => {
    const body = fileDecompressTool.request.body?.({
      fileId: 'wf_zip',
      _context: { workspaceId: 'ws_1' },
    } as Parameters<NonNullable<typeof fileDecompressTool.request.body>>[0])

    expect(body).toMatchObject({
      operation: 'decompress',
      fileId: 'wf_zip',
      workspaceId: 'ws_1',
    })
  })

  it('returns the extracted files on success', async () => {
    const extracted = [
      { id: 'wf_a', name: 'a.txt', url: 'https://example.com/a.txt', key: 'k/a.txt' },
      { id: 'wf_b', name: 'b.txt', url: 'https://example.com/b.txt', key: 'k/b.txt' },
    ]

    const result = await fileDecompressTool.transformResponse?.(
      Response.json({ success: true, data: { files: extracted } })
    )

    expect(result).toMatchObject({
      success: true,
      output: { files: extracted },
    })
  })

  it('propagates route failures as tool failures', async () => {
    const result = await fileDecompressTool.transformResponse?.(
      Response.json({ success: false, error: '"data.txt" is not a valid .zip archive' })
    )

    expect(result).toMatchObject({
      success: false,
      error: '"data.txt" is not a valid .zip archive',
      output: {},
    })
  })
})
