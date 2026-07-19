/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { textractAnalyzeExpenseTool } from '@/tools/textract/analyze-expense'
import { textractAnalyzeIdTool } from '@/tools/textract/analyze-id'
import { textractParserTool, textractParserV2Tool } from '@/tools/textract/parser'

const respond = (body: unknown) => new Response(JSON.stringify(body))

describe('textract_parser', () => {
  const body = textractParserTool.request.body!

  it('builds a sync body from filePath', () => {
    expect(
      body({
        accessKeyId: ' key ',
        secretAccessKey: ' secret ',
        region: ' us-east-1 ',
        filePath: ' https://example.com/doc.pdf ',
        featureTypes: ['TABLES'],
      } as never)
    ).toMatchObject({
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      region: 'us-east-1',
      processingMode: 'sync',
      filePath: 'https://example.com/doc.pdf',
      featureTypes: ['TABLES'],
    })
  })

  it('requires s3Uri for async mode', () => {
    expect(() =>
      body({
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        region: 'us-east-1',
        processingMode: 'async',
      } as never)
    ).not.toThrow()
    expect(
      body({
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        region: 'us-east-1',
        processingMode: 'async',
        s3Uri: 's3://bucket/key.pdf',
      } as never)
    ).toMatchObject({ processingMode: 'async', s3Uri: 's3://bucket/key.pdf' })
  })

  it('throws when no document is provided for sync mode', () => {
    expect(() =>
      body({
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        region: 'us-east-1',
      } as never)
    ).toThrow('Document is required for single-page processing')
  })

  it('normalizes the documented response shape', async () => {
    const result = await textractParserTool.transformResponse!(
      respond({
        success: true,
        output: {
          blocks: [{ BlockType: 'LINE', Id: '1', Text: 'Hello' }],
          documentMetadata: { pages: 2 },
          modelVersion: '1.0',
        },
      })
    )

    expect(result.success).toBe(true)
    expect(result.output.blocks).toHaveLength(1)
    expect(result.output.documentMetadata.pages).toBe(2)
    expect(result.output.modelVersion).toBe('1.0')
  })

  it('surfaces the API error message on failure', async () => {
    await expect(
      textractParserTool.transformResponse!(respond({ success: false, error: 'Bad request' }))
    ).rejects.toThrow('Bad request')
  })
})

describe('textract_parser_v2', () => {
  const body = textractParserV2Tool.request.body!

  it('throws when no file is provided for sync mode', () => {
    expect(() =>
      body({
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        region: 'us-east-1',
      } as never)
    ).toThrow('Document file is required for single-page processing')
  })

  it('builds a sync body from a UserFile', () => {
    const file = { key: 'file-key', name: 'doc.pdf' } as never
    expect(
      body({
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        region: 'us-east-1',
        file,
      } as never)
    ).toMatchObject({ processingMode: 'sync', file })
  })
})

describe('textract_analyze_expense', () => {
  const body = textractAnalyzeExpenseTool.request.body!

  it('throws when neither file nor filePath is provided for sync mode', () => {
    expect(() =>
      body({
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        region: 'us-east-1',
      } as never)
    ).toThrow('Document is required for single-page processing')
  })

  it('falls back to filePath when no file object is provided', () => {
    expect(
      body({
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        region: 'us-east-1',
        filePath: ' https://example.com/receipt.pdf ',
      } as never)
    ).toMatchObject({ processingMode: 'sync', filePath: 'https://example.com/receipt.pdf' })
  })

  it('builds an async body requiring s3Uri', () => {
    expect(
      body({
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        region: 'us-east-1',
        processingMode: 'async',
        s3Uri: 's3://bucket/receipt.pdf',
      } as never)
    ).toMatchObject({ processingMode: 'async', s3Uri: 's3://bucket/receipt.pdf' })
  })

  it('normalizes expense documents from the response', async () => {
    const result = await textractAnalyzeExpenseTool.transformResponse!(
      respond({
        success: true,
        output: {
          expenseDocuments: [{ expenseIndex: 0, summaryFields: [], lineItemGroups: [] }],
          documentMetadata: { pages: 1 },
        },
      })
    )

    expect(result.success).toBe(true)
    expect(result.output.expenseDocuments).toHaveLength(1)
    expect(result.output.documentMetadata.pages).toBe(1)
  })
})

describe('textract_analyze_id', () => {
  const body = textractAnalyzeIdTool.request.body!

  it('throws when no front-of-ID file is provided', () => {
    expect(() =>
      body({ accessKeyId: 'key', secretAccessKey: 'secret', region: 'us-east-1' } as never)
    ).toThrow('Identity document is required')
  })

  it('includes fileBack only when provided', () => {
    const file = { key: 'front-key' } as never
    expect(
      body({ accessKeyId: 'key', secretAccessKey: 'secret', region: 'us-east-1', file } as never)
    ).toEqual({
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      region: 'us-east-1',
      file,
    })

    const fileBack = { key: 'back-key' } as never
    expect(
      body({
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        region: 'us-east-1',
        file,
        fileBack,
      } as never)
    ).toEqual({
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      region: 'us-east-1',
      file,
      fileBack,
    })
  })

  it('falls back to filePath/filePathBack when no file objects are provided', () => {
    expect(
      body({
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        region: 'us-east-1',
        filePath: ' https://example.com/id-front.png ',
        filePathBack: ' https://example.com/id-back.png ',
      } as never)
    ).toEqual({
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      region: 'us-east-1',
      filePath: 'https://example.com/id-front.png',
      filePathBack: 'https://example.com/id-back.png',
    })
  })

  it('normalizes identity documents from the response', async () => {
    const result = await textractAnalyzeIdTool.transformResponse!(
      respond({
        success: true,
        output: {
          identityDocuments: [{ documentIndex: 0, identityDocumentFields: [] }],
          documentMetadata: { pages: 1 },
          modelVersion: '1.0',
        },
      })
    )

    expect(result.success).toBe(true)
    expect(result.output.identityDocuments).toHaveLength(1)
    expect(result.output.modelVersion).toBe('1.0')
  })
})
