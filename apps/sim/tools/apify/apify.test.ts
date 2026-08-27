/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'
import { ApifyBlock } from '@/blocks/blocks/apify'
import { apifyRunActorAsyncTool } from '@/tools/apify/run_actor_async'
import { apifyRunActorSyncTool } from '@/tools/apify/run_actor_sync'
import { apifyRunTaskTool } from '@/tools/apify/run_task'
import { APIFY_SYNC_TRANSPORT_TIMEOUT_MS } from '@/tools/apify/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

vi.mock('@sim/utils/helpers', () => ({
  sleep: vi.fn(async () => {}),
}))

function mapBlockParams(params: Record<string, unknown>): Record<string, unknown> {
  const build = ApifyBlock.tools.config?.params
  if (!build) throw new Error('apify tools.config.params is not defined')
  return build(params) as Record<string, unknown>
}

function buildUrl(tool: ToolConfig<any, any>, params: Record<string, unknown>): string {
  const { url } = tool.request
  return typeof url === 'function' ? url(params as any) : url
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as unknown as Response
}

describe('apify sync transport deadline', () => {
  it('sits above the 300s Apify sync cap so the documented 408 wins the race', () => {
    expect(APIFY_SYNC_TRANSPORT_TIMEOUT_MS).toBeGreaterThan(300_000)
  })

  it('arms a deliberate transport deadline for run_actor_sync', () => {
    const result = mapBlockParams({
      operation: 'apify_run_actor_sync',
      apiKey: 'k',
      actorId: 'me/actor',
    })
    expect(result.timeout).toBe(APIFY_SYNC_TRANSPORT_TIMEOUT_MS)
  })

  it('arms a deliberate transport deadline for run_task', () => {
    const result = mapBlockParams({ operation: 'apify_run_task', apiKey: 'k', taskId: 'me/task' })
    expect(result.timeout).toBe(APIFY_SYNC_TRANSPORT_TIMEOUT_MS)
  })

  it('never derives the transport deadline from the user-facing seconds value', () => {
    const result = mapBlockParams({
      operation: 'apify_run_actor_sync',
      apiKey: 'k',
      actorId: 'me/actor',
      timeout: '3600',
    })
    expect(result.actorTimeout).toBe(3600)
    expect(result.timeout).toBe(APIFY_SYNC_TRANSPORT_TIMEOUT_MS)
    expect(result.timeout).not.toBe(3600)
    expect(result.timeout).not.toBe(3_600_000)
  })

  it('leaves non-sync operations on no transport deadline', () => {
    for (const operation of ['apify_run_actor_async', 'apify_get_run', 'apify_get_dataset_items']) {
      const result = mapBlockParams({ operation, apiKey: 'k', actorId: 'a', runId: 'r' })
      expect(Object.hasOwn(result, 'timeout')).toBe(true)
      expect(result.timeout).toBeUndefined()
    }
  })
})

describe('apify explicit zero timeout', () => {
  it('forwards timeout=0 (Apify: no timeout) on every run tool', () => {
    expect(buildUrl(apifyRunActorSyncTool, { actorId: 'me/actor', actorTimeout: 0 })).toContain(
      'timeout=0'
    )
    expect(buildUrl(apifyRunActorAsyncTool, { actorId: 'me/actor', actorTimeout: 0 })).toContain(
      'timeout=0'
    )
    expect(buildUrl(apifyRunTaskTool, { taskId: 'me/task', taskTimeout: 0 })).toContain('timeout=0')
  })

  it('maps an explicit 0 subBlock value through the block mapper', () => {
    for (const zero of ['0', 0]) {
      expect(
        mapBlockParams({
          operation: 'apify_run_actor_sync',
          apiKey: 'k',
          actorId: 'me/actor',
          timeout: zero,
        }).actorTimeout
      ).toBe(0)
      expect(
        mapBlockParams({
          operation: 'apify_run_task',
          apiKey: 'k',
          taskId: 'me/task',
          timeout: zero,
        }).taskTimeout
      ).toBe(0)
    }
  })

  it('still drops an untouched (empty string) subBlock value', () => {
    const result = mapBlockParams({
      operation: 'apify_run_actor_sync',
      apiKey: 'k',
      actorId: 'me/actor',
      timeout: '',
    })
    expect(result.actorTimeout).toBeUndefined()
    expect(result.taskTimeout).toBeUndefined()
  })
})

describe('apify direct-call timeout guard', () => {
  const RUN_TOOLS = [
    { tool: apifyRunActorSyncTool, base: { actorId: 'me/actor' }, key: 'actorTimeout' },
    { tool: apifyRunActorAsyncTool, base: { actorId: 'me/actor' }, key: 'actorTimeout' },
    { tool: apifyRunTaskTool, base: { taskId: 'me/task' }, key: 'taskTimeout' },
  ] as const

  it.each(RUN_TOOLS)('omits timeout entirely for an absent value on $tool.id', ({ tool, base }) => {
    const url = new URL(buildUrl(tool, { ...base }))
    expect(url.searchParams.has('timeout')).toBe(false)
  })

  it.each(RUN_TOOLS)(
    'omits an empty or whitespace-only timeout on $tool.id instead of sending "timeout="',
    ({ tool, base, key }) => {
      for (const blank of ['', '   ', '\t\n']) {
        const url = new URL(buildUrl(tool, { ...base, [key]: blank }))
        expect(url.searchParams.has('timeout')).toBe(false)
      }
    }
  )

  it.each(RUN_TOOLS)('still forwards an explicit 0 on $tool.id', ({ tool, base, key }) => {
    for (const zero of [0, '0']) {
      const url = new URL(buildUrl(tool, { ...base, [key]: zero }))
      expect(url.searchParams.get('timeout')).toBe('0')
    }
  })

  it.each(RUN_TOOLS)(
    'forwards a real timeout byte-identically on $tool.id',
    ({ tool, base, key }) => {
      expect(new URL(buildUrl(tool, { ...base, [key]: 300 })).searchParams.get('timeout')).toBe(
        '300'
      )
      expect(new URL(buildUrl(tool, { ...base, [key]: '300' })).searchParams.get('timeout')).toBe(
        '300'
      )
    }
  )
})

describe('apify run_actor_sync response contract', () => {
  it('emits no fabricated run id — the sync endpoint returns none', async () => {
    const result = await apifyRunActorSyncTool.transformResponse!(jsonResponse([{ a: 1 }]))
    expect(Object.hasOwn(result.output, 'runId')).toBe(false)
    expect(result.output.items).toEqual([{ a: 1 }])
    expect(apifyRunActorSyncTool.outputs?.runId).toBeUndefined()
  })

  it('emits no fabricated run status — the sync body carries no status field', async () => {
    for (const tool of [apifyRunActorSyncTool, apifyRunTaskTool]) {
      const result = await tool.transformResponse!(jsonResponse([{ a: 1 }]))
      expect(Object.hasOwn(result.output, 'status')).toBe(false)
      expect(tool.outputs?.status).toBeUndefined()
    }
  })

  it('guards a non-array response body', async () => {
    const result = await apifyRunActorSyncTool.transformResponse!(jsonResponse({ error: 'nope' }))
    expect(result.output.items).toEqual([])
  })
})

describe('apify run_actor_async polling', () => {
  const fetchSpy = vi.fn(() => {
    throw new Error('global fetch must not be used inside postProcess')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function startedResult(): ToolResponse {
    return {
      success: true,
      output: { success: true, runId: 'run-1', status: 'RUNNING' },
    }
  }

  it('routes both follow-up requests through the guarded tool transport', async () => {
    const executeTool = vi.fn(async (toolId: string) => {
      if (toolId === 'apify_get_run') {
        return {
          success: true,
          output: { success: true, runId: 'run-1', status: 'SUCCEEDED', datasetId: 'ds-1' },
        }
      }
      return { success: true, output: { success: true, items: [{ a: 1 }], count: 1 } }
    })

    const result = await apifyRunActorAsyncTool.postProcess!(
      startedResult() as any,
      { apiKey: 'k', actorId: 'me/actor' } as any,
      executeTool as any
    )

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(executeTool.mock.calls.map(([toolId]) => toolId)).toEqual([
      'apify_get_run',
      'apify_get_dataset_items',
    ])
    expect(result.output.items).toEqual([{ a: 1 }])
    expect(result.output.status).toBe('SUCCEEDED')
  })

  it('checks the run status before paying the first poll interval', async () => {
    const { sleep } = await import('@sim/utils/helpers')
    const order: string[] = []
    vi.mocked(sleep).mockImplementation(async () => {
      order.push('sleep')
    })
    const executeTool = vi.fn(async () => {
      order.push('status')
      return {
        success: true,
        output: { success: true, runId: 'run-1', status: 'SUCCEEDED' },
      }
    })

    await apifyRunActorAsyncTool.postProcess!(
      startedResult() as any,
      { apiKey: 'k', actorId: 'me/actor' } as any,
      executeTool as any
    )

    expect(order[0]).toBe('status')
    expect(order).not.toContain('sleep')
  })

  it('reports the real polling window rather than a hardcoded five minutes', async () => {
    const executeTool = vi.fn(async () => ({
      success: true,
      output: { success: true, runId: 'run-1', status: 'RUNNING' },
    }))

    const result = await apifyRunActorAsyncTool.postProcess!(
      startedResult() as any,
      { apiKey: 'k', actorId: 'me/actor' } as any,
      executeTool as any
    )

    expect(result.success).toBe(false)
    expect(result.output.status).toBe('TIMEOUT')
    expect(result.error).not.toContain('5 minutes')
    expect(result.error).toContain(`${DEFAULT_EXECUTION_TIMEOUT_MS / 1000}s`)
  })
})
