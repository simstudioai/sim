import { describe, expect, it, vi } from 'vitest'

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('@sim/logger', () => ({ createLogger: () => logger }))

import { fileFetchTool, fileParserTool, fileParserV3Tool } from '@/tools/file/parser'

describe('fileParserTool', () => {
  it('preserves authenticated fetch inputs without logging headers or signed URLs', () => {
    const fileUrl = 'https://example.com/report.pdf?signature=private-url-token'
    const headers = { Authorization: 'Bearer private-header-token' }
    expect(fileFetchTool.operation.input({ fileUrl, headers })).toMatchObject({
      filePath: fileUrl,
      headers,
    })
    const logged = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ])
    expect(logged).not.toContain('private-url-token')
    expect(logged).not.toContain('private-header-token')
  })

  it('does not log supplied headers when the file path is missing', () => {
    expect(() =>
      fileFetchTool.operation.input({
        fileUrl: '',
        headers: { Authorization: 'Bearer private-header-token' },
      })
    ).toThrow('Missing required parameter: filePath')
    const logged = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ])
    expect(logged).not.toContain('private-header-token')
  })

  it('maps the public File Fetch URL to the internal parser path', () => {
    expect(
      fileFetchTool.operation.input({
        fileUrl: 'https://example.com/report.pdf',
        headers: { Authorization: 'Bearer token' },
      })
    ).toEqual({
      filePath: 'https://example.com/report.pdf',
      headers: { Authorization: 'Bearer token' },
      workspaceId: undefined,
    })
  })

  it('propagates parser operation failures as tool failures', async () => {
    const result = await fileParserTool.transformResponse?.(
      Response.json({
        success: false,
        error: 'File is too large to parse safely.',
        filePath: 'https://example.com/big.pdf',
      })
    )

    expect(result).toMatchObject({
      success: false,
      error: 'File is too large to parse safely.',
      output: {
        files: [],
        combinedContent: '',
      },
    })
  })

  it('propagates parse route failures from V3 and file fetch tools', async () => {
    const body = {
      success: false,
      error: 'File is too large to parse safely.',
      filePath: 'https://example.com/big.pdf',
    }

    await expect(fileParserV3Tool.transformResponse?.(Response.json(body))).resolves.toMatchObject({
      success: false,
      error: 'File is too large to parse safely.',
      output: {
        files: [],
        combinedContent: '',
      },
    })
    await expect(fileFetchTool.transformResponse?.(Response.json(body))).resolves.toMatchObject({
      success: false,
      error: 'File is too large to parse safely.',
      output: {
        files: [],
        combinedContent: '',
      },
    })
  })

  it('omits failed entries from partial multi-file parse results', async () => {
    const result = await fileParserTool.transformResponse?.(
      Response.json({
        success: true,
        results: [
          {
            success: false,
            error: 'First file failed',
            filePath: 'bad.pdf',
          },
          {
            success: true,
            output: {
              content: 'ok',
              fileType: 'text/plain',
              size: 2,
              name: 'ok.txt',
              binary: false,
            },
          },
        ],
      })
    )

    expect(result).toMatchObject({
      success: true,
      output: {
        files: [{ name: 'ok.txt', content: 'ok' }],
        combinedContent: 'ok',
      },
    })
  })

  it('preserves partial multi-file parse successes from an oversized response', async () => {
    const result = await fileParserTool.transformResponse?.(
      Response.json(
        {
          success: false,
          error: 'Parsed file output is too large to return safely.',
          results: [
            {
              success: true,
              output: {
                content: 'ok',
                fileType: 'text/plain',
                size: 2,
                name: 'ok.txt',
                binary: false,
              },
            },
          ],
        },
        { status: 413 }
      )
    )

    expect(result).toMatchObject({
      success: true,
      error: 'Parsed file output is too large to return safely.',
      output: {
        files: [{ name: 'ok.txt', content: 'ok' }],
        combinedContent: 'ok',
      },
    })
  })
})
