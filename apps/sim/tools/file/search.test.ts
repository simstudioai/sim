import { describe, expect, it } from 'vitest'
import { fileSearchTool } from '@/tools/file/search'

describe('fileSearchTool', () => {
  it('keeps the query model-visible and every builder setting user-only', () => {
    expect(fileSearchTool.params.query).toMatchObject({
      required: true,
      visibility: 'user-or-llm',
    })
    expect(fileSearchTool.params.mode).toMatchObject({
      required: false,
      visibility: 'user-only',
    })
    expect(fileSearchTool.params.maxResults).toMatchObject({
      required: false,
      visibility: 'user-only',
    })
  })

  describe('mode-accurate syntax for the model', () => {
    const baseSchema = {
      type: 'object' as const,
      properties: { query: { type: 'string', description: 'declared' } },
      required: ['query'],
    }
    const enrich = (mode: string) =>
      fileSearchTool.toolEnrichment?.enrichTool(mode, baseSchema, fileSearchTool.description, {})

    it('binds to the builder-chosen mode', () => {
      expect(fileSearchTool.toolEnrichment?.dependsOn).toBe('mode')
    })

    it('teaches regex syntax when the block matches by pattern', async () => {
      const enriched = await enrich('regex')

      expect(enriched?.description).toContain('regular expression')
      const query = enriched?.parameters.properties.query as { description: string }
      expect(query.description).toContain('3 consecutive literal characters')
      expect(query.description).toContain('word boundary')
    })

    it('drops regex syntax entirely when the block matches verbatim', async () => {
      const enriched = await enrich('exact')

      expect(enriched?.description).toContain('exact piece of text')
      const query = enriched?.parameters.properties.query as { description: string }
      expect(query.description).toContain('matched verbatim')
      expect(query.description).toContain('nothing needs escaping')
      expect(query.description).not.toContain('regular expression matched')
      expect(query.description).not.toContain('word boundary')
    })

    it('leaves the declared syntax alone for a mode it does not recognize', async () => {
      await expect(enrich('glob')).resolves.toBeNull()
    })

    it('does not invent a query param the builder already filled in', async () => {
      const enriched = await fileSearchTool.toolEnrichment?.enrichTool(
        'exact',
        { type: 'object', properties: {}, required: [] },
        fileSearchTool.description,
        {}
      )

      expect(enriched?.parameters.properties).toEqual({})
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
      mode: 'regex',
      maxResults: 50,
    })
    expect(fileSearchTool.operation.input({ query: 'needle', mode: 'exact' })).toMatchObject({
      mode: 'exact',
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
