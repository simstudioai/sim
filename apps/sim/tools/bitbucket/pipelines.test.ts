/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeBitbucketGetPipelineStepLogOperation } from '@/lib/internal/bitbucket/operations/get-pipeline-step-log'
import { bitbucketGetPipelineTool } from '@/tools/bitbucket/get_pipeline'
import { bitbucketListPipelineStepsTool } from '@/tools/bitbucket/list_pipeline_steps'
import { bitbucketListPipelinesTool } from '@/tools/bitbucket/list_pipelines'
import { bitbucketStopPipelineTool } from '@/tools/bitbucket/stop_pipeline'
import { bitbucketTriggerPipelineTool } from '@/tools/bitbucket/trigger_pipeline'
import type {
  BitbucketGetPipelineStepLogParams,
  BitbucketListPipelineStepsParams,
  BitbucketListPipelinesParams,
  BitbucketPipelineParams,
  BitbucketTriggerPipelineParams,
} from '@/tools/bitbucket/types'
import type { ToolConfig } from '@/tools/types'

const serverMocks = vi.hoisted(() => ({
  secureBitbucketRead: vi.fn(),
  secureBitbucketPullRequestRedirect: vi.fn(),
}))

vi.mock('@/tools/bitbucket/utils.server', () => serverMocks)

const REPOSITORY_PARAMS = {
  accessToken: 'oauth-token',
  workspaceSlug: 'acme team',
  repoSlug: 'sdk/core',
} as const

const COMMIT_SHA = 'abcdef0123456789abcdef0123456789abcdef01'

/**
 * Drives the live step-log path: the tool reads through the byte-capped server transport, so a
 * test supplies the provider response there rather than to the unreachable request fallback.
 */
async function runStepLog(
  response: Response,
  params: BitbucketGetPipelineStepLogParams
): Promise<{ output: { log: string; truncated: boolean; totalBytes: number | null } }> {
  serverMocks.secureBitbucketRead.mockResolvedValueOnce(response)
  return (await executeBitbucketGetPipelineStepLogOperation(params)) as {
    output: { log: string; truncated: boolean; totalBytes: number | null }
  }
}

const RAW_USER = {
  uuid: '{user-1}',
  account_id: 'account-1',
  type: 'user',
  display_name: 'Ada Lovelace',
  links: { self: { href: 'https://api.bitbucket.org/2.0/users/ada' } },
}

const RAW_PIPELINE = {
  type: 'pipeline',
  uuid: '{pipeline-1}',
  build_number: 42,
  creator: RAW_USER,
  repository: { full_name: 'acme/demo' },
  target: {
    type: 'pipeline_ref_target',
    ref_type: 'branch',
    ref_name: 'main',
    commit: { hash: 'abc123' },
    selector: { type: 'custom', pattern: 'deploy' },
  },
  trigger: { type: 'pipeline_manual_trigger' },
  state: {
    name: 'COMPLETED',
    stage: { name: 'COMPLETED' },
    result: {
      name: 'FAILED',
      error: { key: 'configuration-error', message: 'Invalid pipeline configuration' },
    },
  },
  created_on: '2026-01-01T00:00:00Z',
  completed_on: '2026-01-01T00:02:00Z',
  build_seconds_used: 120,
  links: {
    self: { href: 'https://api.bitbucket.org/2.0/repositories/acme/demo/pipelines/pipeline-1' },
    steps: {
      href: 'https://api.bitbucket.org/2.0/repositories/acme/demo/pipelines/pipeline-1/steps',
    },
  },
}

const RAW_PIPELINE_STEP = {
  type: 'pipeline_step',
  uuid: '{step-1}',
  started_on: '2026-01-01T00:00:00Z',
  completed_on: '2026-01-01T00:02:00Z',
  state: {
    name: 'COMPLETED',
    result: {
      name: 'FAILED',
      error: { key: 'script-error', message: 'Tests failed' },
    },
  },
  image: { name: 'node:22' },
  setup_commands: [{ name: 'setup', command: 'npm install' }],
  script_commands: [
    { name: 'test', command: 'bun test' },
    { name: 'build', command: 'bun run build' },
  ],
}

function requestUrl<P, R>(tool: ToolConfig<P, R>, params: P): string {
  return typeof tool.request.url === 'function' ? tool.request.url(params) : tool.request.url
}

function requestBody<P, R>(tool: ToolConfig<P, R>, params: P): unknown {
  return tool.request.body?.(params)
}

describe('Bitbucket pipeline request builders', () => {
  it('builds every documented list filter and bounded pagination parameter', () => {
    const url = new URL(
      requestUrl(bitbucketListPipelinesTool, {
        ...REPOSITORY_PARAMS,
        refType: 'BRANCH',
        refName: 'main',
        commitHash: COMMIT_SHA.toUpperCase(),
        selectorType: 'CUSTOM',
        selectorPattern: 'deploy',
        triggerType: 'MANUAL',
        status: 'FAILED',
        sort: '-created_on,creator.uuid',
        pageLen: 25,
      } satisfies BitbucketListPipelinesParams)
    )

    expect(url.pathname).toBe('/2.0/repositories/acme%20team/sdk%2Fcore/pipelines')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      'target.ref_type': 'BRANCH',
      'target.ref_name': 'main',
      'target.commit.hash': COMMIT_SHA,
      'target.selector.type': 'CUSTOM',
      'target.selector.pattern': 'deploy',
      trigger_type: 'MANUAL',
      status: 'FAILED',
      sort: '-created_on,creator.uuid',
      pagelen: '25',
    })

    for (const [field, value] of [
      ['refType', 'COMMIT'],
      ['selectorType', 'DEPLOYMENT'],
      ['triggerType', 'WEBHOOK'],
      ['status', 'CANCELLED'],
    ] as const) {
      expect(() =>
        requestUrl(bitbucketListPipelinesTool, {
          ...REPOSITORY_PARAMS,
          [field]: value,
        } as unknown as BitbucketListPipelinesParams)
      ).toThrow(new RegExp(`${field} must be one of`))
    }
    expect(() =>
      requestUrl(bitbucketListPipelinesTool, {
        ...REPOSITORY_PARAMS,
        sort: { malformed: true },
      } as unknown as BitbucketListPipelinesParams)
    ).toThrow(/sort must be a non-empty string/)
    for (const [field, value] of [
      ['refName', false],
      ['selectorPattern', 7],
    ] as const) {
      expect(() =>
        requestUrl(bitbucketListPipelinesTool, {
          ...REPOSITORY_PARAMS,
          [field]: value,
        } as unknown as BitbucketListPipelinesParams)
      ).toThrow(new RegExp(`${field} must be a non-empty string`))
    }
    expect(() =>
      requestUrl(bitbucketListPipelinesTool, {
        ...REPOSITORY_PARAMS,
        commitHash: 'abc123',
      } satisfies BitbucketListPipelinesParams)
    ).toThrow(/commitHash must be a full 40-character SHA-1/)
  })

  it('binds a pipeline cursor to the selected repository list endpoint', () => {
    const next =
      'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/pipelines?page=2'
    expect(
      requestUrl(bitbucketListPipelinesTool, {
        ...REPOSITORY_PARAMS,
        nextUrl: next,
      } satisfies BitbucketListPipelinesParams)
    ).toBe(next)
    expect(() =>
      requestUrl(bitbucketListPipelinesTool, {
        ...REPOSITORY_PARAMS,
        nextUrl:
          'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/pullrequests?page=2',
      } satisfies BitbucketListPipelinesParams)
    ).toThrow(/does not belong/)
  })

  it('encodes pipeline and step UUID path segments', async () => {
    const pipelineParams = {
      ...REPOSITORY_PARAMS,
      pipelineUuid: '{pipeline/one ?#}',
    } satisfies BitbucketPipelineParams
    expect(requestUrl(bitbucketGetPipelineTool, pipelineParams)).toBe(
      'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/pipelines/%7Bpipeline%2Fone%20%3F%23%7D'
    )
    expect(requestUrl(bitbucketStopPipelineTool, pipelineParams)).toBe(
      'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/pipelines/%7Bpipeline%2Fone%20%3F%23%7D/stopPipeline'
    )
    await runStepLog(new Response(''), {
      ...pipelineParams,
      stepUuid: '{step/one ?#}',
    } satisfies BitbucketGetPipelineStepLogParams)
    expect(serverMocks.secureBitbucketRead).toHaveBeenCalledWith(
      'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/pipelines/%7Bpipeline%2Fone%20%3F%23%7D/steps/%7Bstep%2Fone%20%3F%23%7D/log',
      expect.any(Object),
      expect.any(Number),
      expect.any(Object)
    )
  })

  it('builds the restricted pipeline ref target and excludes administration fields', () => {
    const params = {
      ...REPOSITORY_PARAMS,
      refType: 'branch',
      refName: ' main ',
      commitHash: ` ${COMMIT_SHA.toUpperCase()} `,
    } satisfies BitbucketTriggerPipelineParams
    expect(requestBody(bitbucketTriggerPipelineTool, params)).toEqual({
      target: {
        type: 'pipeline_ref_target',
        ref_type: 'branch',
        ref_name: 'main',
        commit: { type: 'commit', hash: COMMIT_SHA },
      },
    })
    expect(bitbucketTriggerPipelineTool.params).not.toHaveProperty('variables')
    expect(bitbucketTriggerPipelineTool.params).not.toHaveProperty('selector')
    expect(bitbucketTriggerPipelineTool.params).not.toHaveProperty('runner')
    expect(bitbucketTriggerPipelineTool.oauth?.requiredScopes).toEqual(['pipeline'])
    expect(() => requestBody(bitbucketTriggerPipelineTool, { ...params, refName: '   ' })).toThrow(
      /refName must be a non-empty string/
    )
    expect(() =>
      requestBody(bitbucketTriggerPipelineTool, {
        ...params,
        refType: 'commit',
      } as unknown as BitbucketTriggerPipelineParams)
    ).toThrow(/refType must be one of/)
    expect(() =>
      requestBody(bitbucketTriggerPipelineTool, {
        ...params,
        commitHash: 'main',
      })
    ).toThrow(/commitHash must be a full 40-character SHA-1/)
  })

  it('uses pipeline:write only for stopping and never retries either mutation', () => {
    expect(bitbucketStopPipelineTool.oauth?.requiredScopes).toEqual(['pipeline:write'])
    expect(bitbucketTriggerPipelineTool.request.retry).toBeUndefined()
    expect(bitbucketStopPipelineTool.request.retry).toBeUndefined()
  })
})

describe('Bitbucket pipeline response normalization', () => {
  it('normalizes pipeline lists, details, and trigger responses consistently', async () => {
    const listed = await bitbucketListPipelinesTool.transformResponse!(
      Response.json({ values: [RAW_PIPELINE], size: 1, page: 1, pagelen: 20 })
    )
    const fetched = await bitbucketGetPipelineTool.transformResponse!(Response.json(RAW_PIPELINE))
    const triggered = await bitbucketTriggerPipelineTool.transformResponse!(
      Response.json(RAW_PIPELINE)
    )

    expect(listed.output.items[0]).toEqual({
      type: 'pipeline',
      uuid: '{pipeline-1}',
      buildNumber: 42,
      creator: {
        uuid: '{user-1}',
        accountId: 'account-1',
        type: 'user',
        displayName: 'Ada Lovelace',
        createdOn: null,
        selfUrl: 'https://api.bitbucket.org/2.0/users/ada',
        htmlUrl: null,
        avatarUrl: null,
      },
      repositoryFullName: 'acme/demo',
      target: {
        type: 'pipeline_ref_target',
        refType: 'branch',
        refName: 'main',
        commitHash: 'abc123',
        selectorType: 'custom',
        selectorPattern: 'deploy',
      },
      triggerType: 'pipeline_manual_trigger',
      state: {
        name: 'COMPLETED',
        stage: 'COMPLETED',
        result: 'FAILED',
        errorKey: 'configuration-error',
        errorMessage: 'Invalid pipeline configuration',
      },
      createdOn: '2026-01-01T00:00:00Z',
      completedOn: '2026-01-01T00:02:00Z',
      buildSecondsUsed: 120,
      selfUrl: 'https://api.bitbucket.org/2.0/repositories/acme/demo/pipelines/pipeline-1',
      stepsUrl: 'https://api.bitbucket.org/2.0/repositories/acme/demo/pipelines/pipeline-1/steps',
    })
    expect(fetched.output.pipeline).toEqual(listed.output.items[0])
    expect(triggered.output.pipeline).toEqual(listed.output.items[0])
  })

  it('normalizes pipeline steps and their documented commands and errors', async () => {
    const result = await bitbucketListPipelineStepsTool.transformResponse!(
      Response.json({ values: [RAW_PIPELINE_STEP], size: 1 })
    )
    expect(result.output.items[0]).toEqual({
      type: 'pipeline_step',
      uuid: '{step-1}',
      startedOn: '2026-01-01T00:00:00Z',
      completedOn: '2026-01-01T00:02:00Z',
      state: {
        name: 'COMPLETED',
        result: 'FAILED',
        errorKey: 'script-error',
        errorMessage: 'Tests failed',
      },
      imageName: 'node:22',
      setupCommands: [{ name: 'setup', command: 'npm install' }],
      scriptCommands: [
        { name: 'test', command: 'bun test' },
        { name: 'build', command: 'bun run build' },
      ],
    })
  })

  it('requires top-level resource types while preserving future type values', async () => {
    await expect(
      bitbucketGetPipelineTool.transformResponse!(
        Response.json({ ...RAW_PIPELINE, type: undefined })
      )
    ).rejects.toThrow(/pipeline\.type must be a non-empty string/)
    await expect(
      bitbucketListPipelineStepsTool.transformResponse!(
        Response.json({ values: [{ ...RAW_PIPELINE_STEP, type: '' }] })
      )
    ).rejects.toThrow(/pipeline step\.type must be a non-empty string/)

    const futurePipeline = await bitbucketGetPipelineTool.transformResponse!(
      Response.json({ ...RAW_PIPELINE, type: 'future_pipeline_variant' })
    )
    const futureStep = await bitbucketListPipelineStepsTool.transformResponse!(
      Response.json({ values: [{ ...RAW_PIPELINE_STEP, type: 'future_step_variant' }] })
    )
    expect(futurePipeline.output.pipeline.type).toBe('future_pipeline_variant')
    expect(futureStep.output.items[0].type).toBe('future_step_variant')
  })

  it('distinguishes absent, empty, and malformed optional command collections', async () => {
    const absent = await bitbucketListPipelineStepsTool.transformResponse!(
      Response.json({
        values: [{ ...RAW_PIPELINE_STEP, setup_commands: undefined, script_commands: undefined }],
      })
    )
    const empty = await bitbucketListPipelineStepsTool.transformResponse!(
      Response.json({ values: [{ ...RAW_PIPELINE_STEP, setup_commands: [], script_commands: [] }] })
    )
    expect(absent.output.items[0]).toMatchObject({ setupCommands: null, scriptCommands: null })
    expect(empty.output.items[0]).toMatchObject({ setupCommands: [], scriptCommands: [] })

    await expect(
      bitbucketListPipelineStepsTool.transformResponse!(
        Response.json({ values: [{ ...RAW_PIPELINE_STEP, setup_commands: null }] })
      )
    ).rejects.toThrow(/setup_commands must be an array when present/)
    await expect(
      bitbucketListPipelineStepsTool.transformResponse!(
        Response.json({ values: [{ ...RAW_PIPELINE_STEP, script_commands: [null] }] })
      )
    ).rejects.toThrow(/script_commands\[0\] must be an object/)
  })

  it('treats a successful stopPipeline 204 as completion', async () => {
    const result = await bitbucketStopPipelineTool.transformResponse!(
      new Response(null, { status: 204 })
    )
    expect(result).toEqual({ success: true, output: { stopped: true } })
    for (const status of [200, 202, 205]) {
      await expect(
        bitbucketStopPipelineTool.transformResponse!(new Response(null, { status }))
      ).rejects.toThrow(`unexpected HTTP ${status}`)
    }
  })

  it('builds and transforms paginated pipeline steps', async () => {
    const params = {
      ...REPOSITORY_PARAMS,
      pipelineUuid: '{pipeline-1}',
      pageLen: 30,
    } satisfies BitbucketListPipelineStepsParams
    expect(requestUrl(bitbucketListPipelineStepsTool, params)).toBe(
      'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/pipelines/%7Bpipeline-1%7D/steps?pagelen=30'
    )
    expect(bitbucketListPipelineStepsTool.request.retry).toMatchObject({
      enabled: true,
      retryIdempotentOnly: true,
    })
  })
})

describe('Bitbucket pipeline step logs', () => {
  it('requests a bounded byte tail and drops authorization on redirects', async () => {
    const params = {
      ...REPOSITORY_PARAMS,
      pipelineUuid: '{pipeline-1}',
      stepUuid: '{step-1}',
      maxCharacters: 4_096,
    } satisfies BitbucketGetPipelineStepLogParams
    await runStepLog(new Response(''), params)
    expect(serverMocks.secureBitbucketRead).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        Accept: '*/*',
        Authorization: 'Bearer oauth-token',
        Range: 'bytes=-16384',
      }),
      expect.any(Number),
      expect.objectContaining({ stripAuthOnRedirect: true })
    )
  })

  it('overfetches a provider-compatible minimum for small log tails', async () => {
    const params = {
      ...REPOSITORY_PARAMS,
      pipelineUuid: '{pipeline-1}',
      stepUuid: '{step-1}',
      maxCharacters: 100,
    } satisfies BitbucketGetPipelineStepLogParams

    await runStepLog(new Response(''), params)
    expect(serverMocks.secureBitbucketRead).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ Range: 'bytes=-4096' }),
      expect.any(Number),
      expect.any(Object)
    )
  })

  it('trims the partial leading line of a ranged log and reports total bytes', async () => {
    const body = 'ise\nFAILED: expected 1 to be 2\n'
    const result = await runStepLog(
      new Response(body, {
        status: 206,
        headers: { 'Content-Range': 'bytes 969-999/1000' },
      }),
      { ...REPOSITORY_PARAMS, pipelineUuid: '{pipeline-1}', stepUuid: '{step-1}' }
    )
    expect(result.output).toEqual({
      log: 'FAILED: expected 1 to be 2\n',
      truncated: true,
      totalBytes: 1000,
    })
  })

  it('locally retains only the useful tail when Range is ignored', async () => {
    const body = `${'noise line\n'.repeat(20)}FAILED\n`
    const result = await runStepLog(
      new Response(body, { headers: { 'Content-Length': String(Buffer.byteLength(body)) } }),
      {
        ...REPOSITORY_PARAMS,
        pipelineUuid: '{pipeline-1}',
        stepUuid: '{step-1}',
        maxCharacters: 10,
      }
    )
    expect(result.output).toEqual({
      log: 'FAILED\n',
      truncated: true,
      totalBytes: Buffer.byteLength(body),
    })
  })

  it('rejects log caps outside the supported range', async () => {
    await expect(
      runStepLog(new Response('log'), {
        ...REPOSITORY_PARAMS,
        pipelineUuid: '{pipeline-1}',
        stepUuid: '{step-1}',
        maxCharacters: 0,
      })
    ).rejects.toThrow(/maxCharacters must be an integer between 1 and 200000/)
  })
})

describe('Bitbucket pipeline step log transfer boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const LOG_PARAMS = {
    ...REPOSITORY_PARAMS,
    pipelineUuid: '{pipeline-1}',
    stepUuid: '{step-1}',
    maxCharacters: 10,
  }

  it('reads through the capped server path instead of the buffered tool request', async () => {
    serverMocks.secureBitbucketRead.mockResolvedValue(new Response('done\n'))

    await executeBitbucketGetPipelineStepLogOperation(LOG_PARAMS)

    const [url, headers, maxBytes, options] = serverMocks.secureBitbucketRead.mock.calls[0]
    expect(url).toContain('/pipelines/%7Bpipeline-1%7D/steps/%7Bstep-1%7D/log')
    expect(headers.Range).toBe('bytes=-4096')
    expect(maxBytes).toBe(16 * 1024 * 1024)
    expect(options.stripAuthOnRedirect).toBe(true)
  })

  it('treats an unsatisfiable range over an empty log as an empty log, not a failure', async () => {
    serverMocks.secureBitbucketRead.mockResolvedValue(
      new Response('', { status: 416, headers: { 'Content-Range': 'bytes */0' } })
    )

    const result = await executeBitbucketGetPipelineStepLogOperation(LOG_PARAMS)

    expect(result).toEqual({
      success: true,
      output: { log: '', truncated: false, totalBytes: 0 },
    })
  })

  it('still surfaces genuine step-log failures', async () => {
    serverMocks.secureBitbucketRead.mockResolvedValue(
      Response.json({ error: { message: 'No such step' } }, { status: 404 })
    )

    await expect(executeBitbucketGetPipelineStepLogOperation(LOG_PARAMS)).rejects.toThrow(
      /No such step/
    )
  })

  it('does not report an empty log when a 416 came from something other than an empty log', async () => {
    serverMocks.secureBitbucketRead.mockResolvedValue(
      Response.json(
        { error: { message: 'Range rejected', detail: 'proxy does not support ranges' } },
        { status: 416, headers: { 'Content-Range': 'bytes */12345' } }
      )
    )

    await expect(executeBitbucketGetPipelineStepLogOperation(LOG_PARAMS)).rejects.toThrow(
      /Range rejected: proxy does not support ranges/
    )
  })
})
