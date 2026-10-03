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
import { ERROR_TEXT_MAX_LENGTH } from '@/tools/langsmith/utils'
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

const forbidden = () => new Response('{"detail":"Forbidden"}', { status: 403 })

describe('langsmith transformResponse error handling', () => {
  it('rejects a 403 from create run', async () => {
    await expect(
      langsmithCreateRunTool.transformResponse!(forbidden(), createRunParams)
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
    const echoed = error!.message.slice(error!.message.indexOf('x'))
    expect(echoed).toMatch(/^x{497}\.\.\.$/)
    expect(echoed).toHaveLength(ERROR_TEXT_MAX_LENGTH)
  })
})

const resolveBody = <P>(tool: ToolConfig<P, never>, params: P): Record<string, unknown> =>
  tool.request.body!(params) as Record<string, unknown>

describe('langsmith credential containment', () => {
  const secret = 'lsv2_pt_super_secret_key'

  it('keeps the api key out of the create run body', () => {
    const body = resolveBody(langsmithCreateRunTool as never, {
      ...createRunParams,
      apiKey: secret,
      run_outputs: { answer: 'hello' },
    } satisfies LangsmithCreateRunParams)

    expect(JSON.stringify(body)).not.toContain(secret)
    expect(JSON.stringify(body)).not.toContain('apiKey')
    expect(body.outputs).toEqual({ answer: 'hello' })
    expect(body).not.toHaveProperty('run_outputs')
  })

  it('keeps the api key out of the create runs batch body', () => {
    const body = resolveBody(langsmithCreateRunsBatchTool as never, {
      apiKey: secret,
      post: [{ id: 'run-1', name: 'my run', run_type: 'chain' }],
      patch: [
        { id: 'run-0', name: 'older run', run_type: 'chain', end_time: '2026-01-01T00:00:05Z' },
      ],
    } satisfies LangsmithCreateRunsBatchParams)

    expect(JSON.stringify(body)).not.toContain(secret)
    expect(JSON.stringify(body)).not.toContain('apiKey')
  })

  it('drops unknown caller-supplied fields rather than forwarding them', () => {
    const body = resolveBody(
      langsmithCreateRunTool as never,
      {
        ...createRunParams,
        apiKey: secret,
        futureCredential: secret,
      } as unknown as LangsmithCreateRunParams
    )

    expect(JSON.stringify(body)).not.toContain(secret)
    expect(body).not.toHaveProperty('futureCredential')
  })
})

describe('langsmith reported run id matches the sent run id', () => {
  it('reports the generated id that was actually sent for create run', async () => {
    const params: LangsmithCreateRunParams = {
      apiKey: 'test-key',
      name: 'my run',
      run_type: 'chain',
    }

    const body = resolveBody(langsmithCreateRunTool as never, params)
    const sentId = body.id as string

    expect(sentId).toEqual(expect.any(String))

    const result = await langsmithCreateRunTool.transformResponse!(
      jsonOk({ [sentId]: { message: 'Run accepted' } }),
      params
    )

    expect(result.output.runId).toBe(sentId)
    expect(result.output.message).toBe('Run accepted')
  })

  it('reports the generated ids that were actually sent for create runs batch', async () => {
    const params: LangsmithCreateRunsBatchParams = {
      apiKey: 'test-key',
      post: [
        { name: 'first', run_type: 'chain' },
        { name: 'second', run_type: 'llm' },
      ],
    }

    const body = resolveBody(langsmithCreateRunsBatchTool as never, params)
    const sentIds = (body.post as Array<Record<string, unknown>>).map((run) => run.id)

    const result = await langsmithCreateRunsBatchTool.transformResponse!(
      jsonOk({ message: 'Runs accepted' }),
      params
    )

    expect(result.output.runIds).toEqual(sentIds)
  })
})

describe('langsmith batch patch entries', () => {
  it('passes patch entries through without fabricating identity or trace fields', () => {
    const body = resolveBody(langsmithCreateRunsBatchTool as never, {
      apiKey: 'test-key',
      patch: [{ id: 'run-1', name: 'my run', run_type: 'chain', end_time: '2026-01-01T00:00:05Z' }],
    } satisfies LangsmithCreateRunsBatchParams)

    expect(body.patch).toEqual([
      { id: 'run-1', name: 'my run', run_type: 'chain', end_time: '2026-01-01T00:00:05Z' },
    ])
  })

  it('rejects a patch entry that carries no run id', () => {
    expect(() =>
      resolveBody(langsmithCreateRunsBatchTool as never, {
        apiKey: 'test-key',
        patch: [{ name: 'my run', run_type: 'chain', end_time: '2026-01-01T00:00:05Z' }],
      } satisfies LangsmithCreateRunsBatchParams)
    ).toThrow(/patch entries must carry the id of an existing run/i)
  })
})
