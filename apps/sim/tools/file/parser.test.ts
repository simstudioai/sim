/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { fileFetchTool, fileParserTool, fileParserV3Tool } from '@/tools/file/parser'

describe('fileParserTool', () => {
  it('propagates parse route failures as tool failures', async () => {
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
