/**
 * @vitest-environment node
 */
import { toError } from '@sim/utils/errors'
import { describe, expect, it } from 'vitest'
import { langsmithCreateFeedbackTool } from '@/tools/langsmith/create_feedback'
import { langsmithCreateRunTool } from '@/tools/langsmith/create_run'
import { langsmithCreateRunsBatchTool } from '@/tools/langsmith/create_runs_batch'
import { langsmithGetRunTool } from '@/tools/langsmith/get_run'
import type {
  LangsmithCreateFeedbackParams,
  LangsmithCreateRunParams,
  LangsmithCreateRunsBatchParams,
  LangsmithGetRunParams,
  LangsmithUpdateRunParams,
} from '@/tools/langsmith/types'
import { langsmithUpdateRunTool } from '@/tools/langsmith/update_run'
import type { ToolConfig } from '@/tools/types'

const resolveUrl = <P>(tool: ToolConfig<P, never>, params: P): string =>
  typeof tool.request.url === 'string' ? tool.request.url : tool.request.url(params)

const createRunParams: LangsmithCreateRunParams = {
  apiKey: 'test-key',
  id: 'run-1',
  name: 'my run',
  run_type: 'chain',
}

const createRunsBatchParams: LangsmithCreateRunsBatchParams = {
  apiKey: 'test-key',
  post: [{ id: 'run-1', name: 'my run', run_type: 'chain' }],
}

const createFeedbackParams: LangsmithCreateFeedbackParams = {
  apiKey: 'test-key',
  runId: 'run-1',
  key: 'correctness',
}

const getRunParams: LangsmithGetRunParams = { apiKey: 'test-key', runId: 'run-1' }

const updateRunParams: LangsmithUpdateRunParams = {
  apiKey: 'test-key',
  runId: 'run-1',
  status: 'success',
}

describe('langsmith tool request URLs', () => {
  it('targets the versioned runs endpoint for create run', () => {
    expect(resolveUrl(langsmithCreateRunTool as never, createRunParams)).toBe(
      'https://api.smith.langchain.com/api/v1/runs'
    )
  })

  it('targets the versioned batch endpoint for create runs batch', () => {
    expect(resolveUrl(langsmithCreateRunsBatchTool as never, createRunsBatchParams)).toBe(
      'https://api.smith.langchain.com/api/v1/runs/batch'
    )
  })

  it('targets the versioned feedback endpoint for create feedback', () => {
    expect(resolveUrl(langsmithCreateFeedbackTool as never, createFeedbackParams)).toBe(
      'https://api.smith.langchain.com/api/v1/feedback'
    )
  })

  it('targets the versioned run endpoint for get run', () => {
    expect(resolveUrl(langsmithGetRunTool as never, getRunParams)).toBe(
      'https://api.smith.langchain.com/api/v1/runs/run-1'
    )
  })

  it('targets the versioned run endpoint for update run', () => {
    expect(resolveUrl(langsmithUpdateRunTool as never, updateRunParams)).toBe(
      'https://api.smith.langchain.com/api/v1/runs/run-1'
    )
  })
})

const forbidden = () => new Response('{"detail":"Forbidden"}', { status: 403 })

describe('langsmith transformResponse error handling', () => {
  it('rejects a 403 from create run', async () => {
    await expect(
      langsmithCreateRunTool.transformResponse!(forbidden(), createRunParams)
    ).rejects.toThrow(/403/)
  })

  it('rejects a 403 from create runs batch', async () => {
    await expect(
      langsmithCreateRunsBatchTool.transformResponse!(forbidden(), createRunsBatchParams)
    ).rejects.toThrow(/403/)
  })

  it('rejects a 403 from create feedback', async () => {
    await expect(
      langsmithCreateFeedbackTool.transformResponse!(forbidden(), createFeedbackParams)
    ).rejects.toThrow(/403/)
  })

  it('rejects a 403 from get run', async () => {
    await expect(langsmithGetRunTool.transformResponse!(forbidden(), getRunParams)).rejects.toThrow(
      /403/
    )
  })

  it('rejects a 403 from update run', async () => {
    await expect(
      langsmithUpdateRunTool.transformResponse!(forbidden(), updateRunParams)
    ).rejects.toThrow(/403/)
  })
})

describe('langsmith run id path traversal', () => {
  const traversingRunId = '../sessions/00000000-0000-4000-8000-000000000000'

  it('keeps a traversing get-run id inside /api/v1/runs/', () => {
    const url = new URL(
      resolveUrl(langsmithGetRunTool as never, {
        apiKey: 'test-key',
        runId: traversingRunId,
      } satisfies LangsmithGetRunParams)
    )

    expect(url.pathname.startsWith('/api/v1/runs/')).toBe(true)
    expect(url.pathname).toBe('/api/v1/runs/..%2Fsessions%2F00000000-0000-4000-8000-000000000000')
  })

  it('keeps a traversing update-run id inside /api/v1/runs/', () => {
    const url = new URL(
      resolveUrl(langsmithUpdateRunTool as never, {
        apiKey: 'test-key',
        runId: traversingRunId,
        status: 'success',
      } satisfies LangsmithUpdateRunParams)
    )

    expect(url.pathname.startsWith('/api/v1/runs/')).toBe(true)
    expect(url.pathname).toBe('/api/v1/runs/..%2Fsessions%2F00000000-0000-4000-8000-000000000000')
  })

  it('leaves a legitimate uuid run id unchanged', () => {
    const runId = '3f0c7f4e-9d3a-4f2b-8f6a-1d2c3b4a5e6f'
    const url = new URL(
      resolveUrl(langsmithGetRunTool as never, {
        apiKey: 'test-key',
        runId,
      } satisfies LangsmithGetRunParams)
    )

    expect(url.pathname).toBe(`/api/v1/runs/${runId}`)
  })
})

const jsonOk = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

describe('langsmith transformResponse success handling', () => {
  it('maps a 200 get run response', async () => {
    const result = await langsmithGetRunTool.transformResponse!(
      jsonOk({
        id: 'run-1',
        name: 'my run',
        run_type: 'chain',
        status: 'success',
        start_time: '2026-01-01T00:00:00Z',
        end_time: '2026-01-01T00:00:05Z',
        inputs: { question: 'hi' },
        outputs: { answer: 'hello' },
        tags: ['prod'],
        session_id: 'session-1',
        trace_id: 'trace-1',
        total_tokens: 42,
        total_cost: '0.01',
      }),
      getRunParams
    )

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      id: 'run-1',
      runId: 'run-1',
      name: 'my run',
      runType: 'chain',
      status: 'success',
      inputs: { question: 'hi' },
      outputs: { answer: 'hello' },
      tags: ['prod'],
      sessionId: 'session-1',
      traceId: 'trace-1',
      totalTokens: 42,
      totalCost: '0.01',
    })
  })

  it('maps a 200 create run response', async () => {
    const result = await langsmithCreateRunTool.transformResponse!(
      jsonOk({ message: 'Runs accepted' }),
      createRunParams
    )

    expect(result.success).toBe(true)
    expect(result.output).toEqual({
      accepted: true,
      runId: 'run-1',
      message: 'Runs accepted',
    })
  })

  it('maps a 200 create runs batch response', async () => {
    const result = await langsmithCreateRunsBatchTool.transformResponse!(
      jsonOk({ message: 'Runs accepted' }),
      createRunsBatchParams
    )

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      accepted: true,
      runIds: ['run-1'],
      message: 'Runs accepted',
    })
  })

  it('maps a 200 create feedback response', async () => {
    const result = await langsmithCreateFeedbackTool.transformResponse!(
      jsonOk({
        id: 'feedback-1',
        key: 'correctness',
        run_id: 'run-1',
        score: 1,
        value: 'good',
        comment: 'looks right',
        created_at: '2026-01-01T00:00:00Z',
      }),
      createFeedbackParams
    )

    expect(result.success).toBe(true)
    expect(result.output).toEqual({
      id: 'feedback-1',
      key: 'correctness',
      runId: 'run-1',
      score: 1,
      value: 'good',
      comment: 'looks right',
      createdAt: '2026-01-01T00:00:00Z',
    })
  })

  it('maps a 200 update run response', async () => {
    const result = await langsmithUpdateRunTool.transformResponse!(
      jsonOk({ message: 'Run updated' }),
      updateRunParams
    )

    expect(result.success).toBe(true)
    expect(result.output).toEqual({
      accepted: true,
      runId: 'run-1',
      message: 'Run updated',
    })
  })
})

describe('langsmith error body truncation', () => {
  const hugeBody = 'x'.repeat(5000)

  const cases: Array<[string, () => Promise<unknown>]> = [
    [
      'create run',
      () =>
        langsmithCreateRunTool.transformResponse!(oversized(), createRunParams) as Promise<never>,
    ],
    [
      'create runs batch',
      () =>
        langsmithCreateRunsBatchTool.transformResponse!(
          oversized(),
          createRunsBatchParams
        ) as Promise<never>,
    ],
    [
      'create feedback',
      () =>
        langsmithCreateFeedbackTool.transformResponse!(
          oversized(),
          createFeedbackParams
        ) as Promise<never>,
    ],
    [
      'get run',
      () => langsmithGetRunTool.transformResponse!(oversized(), getRunParams) as Promise<never>,
    ],
    [
      'update run',
      () =>
        langsmithUpdateRunTool.transformResponse!(oversized(), updateRunParams) as Promise<never>,
    ],
  ]

  function oversized() {
    return new Response(hugeBody, { status: 500 })
  }

  it.each(cases)('caps the echoed upstream error body for %s', async (_name, run) => {
    const error = await run().then(
      () => null,
      (thrown: unknown) => toError(thrown)
    )

    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toMatch(/x{500}\.\.\.$/)
    expect(error!.message).not.toMatch(/x{501}/)
  })
})
