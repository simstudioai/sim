import { describe, expect, it } from 'vitest'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { fileSearchTool } from '@/tools/file/search'

describe('fileSearchTool', () => {
  it('uses the shared protected read operation and admits executor delegation', () => {
    expect(fileOperations.searchContent).toMatchObject({
      id: 'files.search_content',
      minimumRole: 'read',
      workspaceApiKey: 'allow',
      delegatedServices: ['copilot', 'executor'],
    })
  })

  it('keeps the query model-visible and the configured limit user-only', () => {
    expect(fileSearchTool.params.query).toMatchObject({
      required: true,
      visibility: 'user-or-llm',
    })
    expect(fileSearchTool.params.maxResults).toMatchObject({
      required: false,
      visibility: 'user-only',
    })
  })

  it('requests fail-closed secret provenance for returned excerpts', () => {
    expect(fileSearchTool.operation.secretProvenance?.response).toEqual({
      incomplete: 'reject',
    })
  })

  it('defaults the hard cap to 50 without coercing model parameters during serialization', () => {
    expect(fileSearchTool.operation.input({ query: 'needle' })).toEqual({
      query: 'needle',
      maxResults: 50,
    })
  })

  it('describes structured results and index coverage counters', () => {
    expect(fileSearchTool.outputs.results).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          lineNumber: { type: 'number' },
          text: { type: 'string' },
        },
      },
    })
    expect(fileSearchTool.outputs.indexStatus).toMatchObject({
      properties: {
        readyFiles: { type: 'number' },
        pendingFiles: { type: 'number' },
        failedFiles: { type: 'number' },
        skippedFiles: { type: 'number' },
        partialFiles: { type: 'number' },
      },
    })
  })

  it('returns structured result objects to the workflow', async () => {
    const result = await fileSearchTool.transformResponse(
      Response.json({
        success: true,
        data: {
          results: [{ fileId: 'file-1', lineNumber: 2, text: 'needle' }],
          count: 1,
          truncated: false,
          complete: true,
          indexStatus: {
            readyFiles: 1,
            pendingFiles: 0,
            failedFiles: 0,
            skippedFiles: 0,
            partialFiles: 0,
          },
        },
      })
    )

    expect(result.output.results).toEqual([{ fileId: 'file-1', lineNumber: 2, text: 'needle' }])
  })
})
