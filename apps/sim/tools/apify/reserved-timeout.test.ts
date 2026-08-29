/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ApifyBlock } from '@/blocks/blocks/apify'
import { apifyRunActorAsyncTool } from '@/tools/apify/run_actor_async'
import { apifyRunActorSyncTool } from '@/tools/apify/run_actor_sync'
import { apifyRunTaskTool } from '@/tools/apify/run_task'
import { prepareToolRequest } from '@/tools/request-transport'

const ACTOR_TOOLS = [
  ['run actor (sync)', apifyRunActorSyncTool] as const,
  ['run actor (async)', apifyRunActorAsyncTool] as const,
]

describe('Apify run timeout is not the transport deadline', () => {
  it.each(ACTOR_TOOLS)('%s sends runTimeout as the Apify timeout query param', (_name, tool) => {
    const request = prepareToolRequest(tool, {
      apiKey: 'token',
      actorId: 'apify/web-scraper',
      runTimeout: 300,
    })

    expect(new URL(request.url).searchParams.get('timeout')).toBe('300')
    expect(request.timeout).toBeUndefined()
  })

  it('run task sends runTimeout as the Apify timeout query param', () => {
    const request = prepareToolRequest(apifyRunTaskTool, {
      apiKey: 'token',
      taskId: 'janedoe/my-task',
      runTimeout: 300,
    })

    expect(new URL(request.url).searchParams.get('timeout')).toBe('300')
    expect(request.timeout).toBeUndefined()
  })

  it('declares runTimeout and no reserved timeout param', () => {
    for (const [, tool] of ACTOR_TOOLS) {
      expect(tool.params.runTimeout).toBeDefined()
      expect(tool.params.timeout).toBeUndefined()
    }
    expect(apifyRunTaskTool.params.runTimeout).toBeDefined()
    expect(apifyRunTaskTool.params.timeout).toBeUndefined()
  })

  it('maps the timeout subBlock onto runTimeout and clears the reserved key', () => {
    const params = ApifyBlock.tools.config?.params?.({
      operation: 'apify_run_actor_sync',
      apiKey: 'token',
      actorId: 'apify/web-scraper',
      timeout: '300',
    }) as Record<string, unknown>

    expect(params.runTimeout).toBe(300)
    expect(Object.hasOwn(params, 'timeout')).toBe(true)
    expect(params.timeout).toBeUndefined()
  })

  it('keeps the timeout subBlock id so saved workflows still resolve', () => {
    expect(ApifyBlock.subBlocks.some((subBlock) => subBlock.id === 'timeout')).toBe(true)
  })
})
