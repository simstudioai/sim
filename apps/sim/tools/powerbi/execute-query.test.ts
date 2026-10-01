import { jsonResponse } from '@sim/testing/helpers/http'
import { describe, expect, it } from 'vitest'
import { powerbiExecuteQueryTool } from '@/tools/powerbi/execute-query'

const params = {
  accessToken: 'provider-token',
  groupId: 'workspace-id',
  datasetId: 'dataset-id',
  query: 'EVALUATE ROW("value", 1)',
}

describe('Power BI DAX result handling', () => {
  it('preserves partial rows and identifies errors at every documented scope', async () => {
    const response = jsonResponse({
      error: { code: 'ResponseLimit', message: 'Limited result.' },
      results: [
        {
          error: { code: 'QueryLimit', message: 'One result table allowed.' },
          tables: [
            {
              error: { code: 'TableLimit', message: 'More than the allowed rows.' },
              rows: [{ 'Sales[Amount]': 0, '[Blank]': null }],
            },
          ],
        },
      ],
    })

    const result = await powerbiExecuteQueryTool.transformResponse!(response, params)

    expect(result).toMatchObject({
      success: false,
      retryable: false,
      output: {
        rows: [{ 'Sales[Amount]': 0, '[Blank]': null }],
        rowCount: 1,
        incomplete: true,
        errors: [
          { scope: 'response', code: 'ResponseLimit', message: 'Limited result.' },
          { scope: 'query', code: 'QueryLimit', message: 'One result table allowed.' },
          { scope: 'table', code: 'TableLimit', message: 'More than the allowed rows.' },
        ],
      },
    })
    expect(result.error).toContain('Limited result.')
  })

  it('preserves provider column names, blank values and falsy values in complete results', async () => {
    const result = await powerbiExecuteQueryTool.transformResponse!(
      jsonResponse({
        results: [
          {
            tables: [
              { rows: [{ 'Table[Flag]': false, '[Number]': 0, '[Text]': '', '[Blank]': null }] },
            ],
          },
        ],
        informationProtectionLabel: { id: 'label-id', name: 'Confidential' },
      }),
      params
    )

    expect(result).toMatchObject({
      success: true,
      output: {
        rows: [{ 'Table[Flag]': false, '[Number]': 0, '[Text]': '', '[Blank]': null }],
        rowCount: 1,
        incomplete: false,
        errors: [],
        informationProtectionLabel: { id: 'label-id', name: 'Confidential' },
      },
    })
  })

  it('does not fabricate a query error message when Microsoft supplies only a code', async () => {
    const result = await powerbiExecuteQueryTool.transformResponse!(
      jsonResponse({ error: { code: 'DatasetExecuteQueriesError' } }),
      params
    )

    expect(result).toMatchObject({
      success: false,
      retryable: false,
      output: {
        rows: [],
        rowCount: 0,
        incomplete: true,
        errors: [{ scope: 'response', code: 'DatasetExecuteQueriesError', message: null }],
      },
    })
    expect(result.error).toContain('DatasetExecuteQueriesError')
  })

  it.each(['omitted', 'empty'])('accepts one result table with %s rows', async (kind) => {
    const result = await powerbiExecuteQueryTool.transformResponse!(
      jsonResponse({ results: [{ tables: [kind === 'empty' ? { rows: [] } : {}] }] }),
      params
    )

    expect(result).toMatchObject({
      success: true,
      output: { rows: [], rowCount: 0, errors: [], incomplete: false },
    })
  })

  it('keeps nested Microsoft error details when the direct message is absent', async () => {
    const result = await powerbiExecuteQueryTool.transformResponse!(
      jsonResponse({
        error: {
          code: 'DatasetExecuteQueriesError',
          details: { diagnostic: 'DAX query failure' },
        },
      }),
      params
    )

    expect(result.output.errors).toEqual([
      {
        scope: 'response',
        code: 'DatasetExecuteQueriesError',
        message: null,
        details: { diagnostic: 'DAX query failure' },
      },
    ])
  })

  it.each(['declared', 'streamed'])(
    'rejects a %s response above the 20 MiB budget',
    async (kind) => {
      let canceled = false
      let emitted = false
      const payload = new TextEncoder().encode(
        JSON.stringify({
          results: [{ tables: [{ rows: [{ '[Payload]': 'a'.repeat(20 * 1024 * 1024) }] }] }],
        })
      )
      const response = new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              if (emitted) {
                controller.close()
                return
              }
              emitted = true
              controller.enqueue(payload)
            },
            cancel() {
              canceled = true
            },
          },
          { highWaterMark: 0 }
        ),
        kind === 'declared'
          ? { headers: { 'content-length': String(20 * 1024 * 1024 + 1) } }
          : undefined
      )

      await expect(powerbiExecuteQueryTool.transformResponse!(response, params)).rejects.toThrow(
        /maximum size.*20971520/
      )
      expect(canceled).toBe(true)
    }
  )

  it('cancels a pending provider read when execution is aborted', async () => {
    const abort = new AbortController()
    let canceled = false
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          canceled = true
        },
      })
    )
    const transformed = powerbiExecuteQueryTool.transformResponse!(response, params, {
      signal: abort.signal,
    })
    abort.abort(new Error('Execution canceled'))

    await expect(transformed).rejects.toThrow('Execution canceled')
    expect(canceled).toBe(true)
  })
})
