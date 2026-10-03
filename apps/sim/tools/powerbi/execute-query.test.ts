import { jsonResponse } from '@sim/testing/helpers/http'
import { describe, expect, it } from 'vitest'
import { powerbiExecuteQueryTool } from '@/tools/powerbi/execute-query'

const { transformResponse } = powerbiExecuteQueryTool
if (!transformResponse) throw new Error('powerbi_execute_query has no transformResponse')

const params = {
  accessToken: 'provider-token',
  groupId: 'workspace-id',
  datasetId: 'dataset-id',
  query: 'EVALUATE ROW("value", 1)',
}

describe('Power BI DAX result handling', () => {
  it('preserves partial rows and identifies errors at every documented scope', async () => {
    const response = jsonResponse({
      error: {
        'pbi.error': { code: 'ResponseLimit', message: 'Limited result.' },
      },
      results: [
        {
          error: {
            'pbi.error': { code: 'QueryLimit', message: 'One result table allowed.' },
          },
          tables: [
            {
              error: {
                'pbi.error': { code: 'TableLimit', message: 'More than the allowed rows.' },
              },
              rows: [{ 'Sales[Amount]': 0, '[Blank]': null }],
            },
          ],
        },
      ],
    })

    const result = await transformResponse(response, params)

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
    const result = await transformResponse(
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
    const result = await transformResponse(
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
    const result = await transformResponse(
      jsonResponse({ results: [{ tables: [kind === 'empty' ? { rows: [] } : {}] }] }),
      params
    )

    expect(result).toMatchObject({
      success: true,
      output: { rows: [], rowCount: 0, errors: [], incomplete: false },
    })
  })

  it.each(['direct', 'wrapped'])('normalizes %s Microsoft error diagnostics', async (kind) => {
    const details =
      kind === 'direct'
        ? { diagnostic: 'DAX query failure' }
        : [
            { code: 'AnalysisServicesErrorCode', detail: { type: 1, value: '3238920194' } },
            { code: 'DetailsMessage', detail: { type: 1, value: 'The DAX query is invalid.' } },
          ]
    const result = await transformResponse(
      jsonResponse({
        error: {
          code: 'DatasetExecuteQueriesError',
          ...(kind === 'direct'
            ? { details }
            : { 'pbi.error': { code: 'DatasetExecuteQueriesError', details } }),
        },
      }),
      params
    )

    expect(result.output.errors).toEqual([
      {
        scope: 'response',
        code: 'DatasetExecuteQueriesError',
        message: kind === 'direct' ? null : 'The DAX query is invalid.',
        details,
      },
    ])
    expect(result.error).toBe(
      kind === 'direct' ? 'DatasetExecuteQueriesError' : 'The DAX query is invalid.'
    )
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

      await expect(transformResponse(response, params)).rejects.toThrow(/maximum size.*20971520/)
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
    const transformed = transformResponse(response, params, {
      signal: abort.signal,
    })
    abort.abort(new Error('Execution canceled'))

    await expect(transformed).rejects.toThrow('Execution canceled')
    expect(canceled).toBe(true)
  })
})
