/**
 * @vitest-environment node
 *
 * The tool request transport reads `params.timeout` as the outbound fetch deadline in
 * MILLISECONDS. Any tool that also declares a user-facing `timeout` param shadows it, so a
 * seconds-valued or duration-valued entry silently becomes a millisecond fetch deadline.
 * These tests pin the rename for every tool that hit that collision: the provider must still
 * receive the same value in the same place, and no built param set may carry a live `timeout`.
 */
import { describe, expect, it } from 'vitest'
import { ApifyBlock } from '@/blocks/blocks/apify'
import { DaytonaBlock } from '@/blocks/blocks/daytona'
import { NewRelicBlock } from '@/blocks/blocks/new_relic'
import { TriggerDevBlock } from '@/blocks/blocks/trigger_dev'
import { TwilioVoiceBlock } from '@/blocks/blocks/twilio_voice'
import type { BlockConfig } from '@/blocks/types'
import { apifyRunActorAsyncTool } from '@/tools/apify/run_actor_async'
import { apifyRunActorSyncTool } from '@/tools/apify/run_actor_sync'
import { apifyRunTaskTool } from '@/tools/apify/run_task'
import { APIFY_SYNC_TRANSPORT_TIMEOUT_MS } from '@/tools/apify/types'
import { daytonaExecuteCommandTool } from '@/tools/daytona/execute_command'
import { daytonaRunCodeTool } from '@/tools/daytona/run_code'
import { newRelicNrqlQueryTool } from '@/tools/new_relic/nrql_query'
import { triggerDevCreateWaitpointTokenTool } from '@/tools/trigger_dev/create_waitpoint_token'
import { makeCallTool } from '@/tools/twilio_voice/make_call'
import type { ToolConfig } from '@/tools/types'

function transform(block: BlockConfig, params: Record<string, unknown>): Record<string, unknown> {
  const build = block.tools.config?.params
  if (!build) throw new Error(`${block.type} tools.config.params is not defined`)
  return build(params) as Record<string, unknown>
}

/**
 * `generic-handler` merges `{ ...inputs, ...transformedParams }`, so a mapper that merely omits
 * `timeout` still lets the raw subBlock value through to the transport. The key must be present
 * and explicitly undefined.
 */
function expectTransportTimeoutCleared(result: Record<string, unknown>) {
  expect(Object.hasOwn(result, 'timeout')).toBe(true)
  expect(result.timeout).toBeUndefined()
}

function buildBody(tool: ToolConfig<any, any>, params: Record<string, unknown>) {
  if (!tool.request.body) throw new Error(`${tool.id} has no request body builder`)
  return tool.request.body(params as any) as Record<string, unknown>
}

/**
 * Some surfaces legitimately want a transport deadline. The invariant is that it is a
 * deliberate millisecond constant, never the user's seconds value promoted onto the
 * reserved key.
 */
function expectDeliberateTransportTimeout(
  result: Record<string, unknown>,
  expectedMs: number,
  userSeconds: number
) {
  expect(result.timeout).toBe(expectedMs)
  expect(result.timeout).not.toBe(userSeconds)
  expect(result.timeout).not.toBe(userSeconds * 1000)
}

function buildUrl(tool: ToolConfig<any, any>, params: Record<string, unknown>): string {
  const { url } = tool.request
  return typeof url === 'function' ? url(params as any) : url
}

describe('daytona timeout collision', () => {
  it('declares no reserved timeout param on either sandbox execution tool', () => {
    expect(daytonaRunCodeTool.params.timeout).toBeUndefined()
    expect(daytonaRunCodeTool.params.runTimeout).toBeDefined()
    expect(daytonaExecuteCommandTool.params.timeout).toBeUndefined()
    expect(daytonaExecuteCommandTool.params.commandTimeout).toBeDefined()
  })

  it('still sends the seconds value as body.timeout for run_code', () => {
    const body = buildBody(daytonaRunCodeTool, {
      sandboxId: 'sb-1',
      code: 'print(1)',
      language: 'python',
      runTimeout: 10,
    })
    expect(body.timeout).toBe(10)
  })

  it('still sends the seconds value as body.timeout for execute_command', () => {
    const body = buildBody(daytonaExecuteCommandTool, {
      sandboxId: 'sb-1',
      command: 'ls',
      commandTimeout: 10,
    })
    expect(body.timeout).toBe(10)
  })

  it('maps the run_code subBlock to runTimeout and clears the transport deadline', () => {
    const result = transform(DaytonaBlock, {
      operation: 'run_code',
      apiKey: 'k',
      sandboxId: 'sb-1',
      code: 'print(1)',
      language: 'python',
      timeout: '10',
    })
    expect(result.runTimeout).toBe(10)
    expectTransportTimeoutCleared(result)
  })

  it('maps the execute_command subBlock to commandTimeout and clears the transport deadline', () => {
    const result = transform(DaytonaBlock, {
      operation: 'execute_command',
      apiKey: 'k',
      sandboxId: 'sb-1',
      command: 'ls',
      timeout: '10',
    })
    expect(result.commandTimeout).toBe(10)
    expectTransportTimeoutCleared(result)
  })

  it('clears the transport deadline on operations that never expose a timeout', () => {
    expectTransportTimeoutCleared(
      transform(DaytonaBlock, { operation: 'list_sandboxes', apiKey: 'k' })
    )
  })
})

describe('apify timeout collision', () => {
  it('declares no reserved timeout param on any run tool', () => {
    expect(apifyRunActorSyncTool.params.timeout).toBeUndefined()
    expect(apifyRunActorSyncTool.params.actorTimeout).toBeDefined()
    expect(apifyRunActorAsyncTool.params.timeout).toBeUndefined()
    expect(apifyRunActorAsyncTool.params.actorTimeout).toBeDefined()
    expect(apifyRunTaskTool.params.timeout).toBeUndefined()
    expect(apifyRunTaskTool.params.taskTimeout).toBeDefined()
  })

  it('still sends the seconds value as the timeout query param', () => {
    expect(buildUrl(apifyRunActorSyncTool, { actorId: 'me/actor', actorTimeout: 300 })).toContain(
      'timeout=300'
    )
    expect(buildUrl(apifyRunActorAsyncTool, { actorId: 'me/actor', actorTimeout: 300 })).toContain(
      'timeout=300'
    )
    expect(buildUrl(apifyRunTaskTool, { taskId: 'me/task', taskTimeout: 300 })).toContain(
      'timeout=300'
    )
  })

  it('maps the subBlock to actorTimeout for actor runs and never onto the transport', () => {
    const result = transform(ApifyBlock, {
      operation: 'apify_run_actor_sync',
      apiKey: 'k',
      actorId: 'me/actor',
      timeout: '10',
    })
    expect(result.actorTimeout).toBe(10)
    expect(result.taskTimeout).toBeUndefined()
    expectDeliberateTransportTimeout(result, APIFY_SYNC_TRANSPORT_TIMEOUT_MS, 10)
  })

  it('maps the subBlock to taskTimeout for task runs and never onto the transport', () => {
    const result = transform(ApifyBlock, {
      operation: 'apify_run_task',
      apiKey: 'k',
      taskId: 'me/task',
      timeout: '10',
    })
    expect(result.taskTimeout).toBe(10)
    expect(result.actorTimeout).toBeUndefined()
    expectDeliberateTransportTimeout(result, APIFY_SYNC_TRANSPORT_TIMEOUT_MS, 10)
  })

  it('clears the transport deadline for the async run, which is not the sync endpoint', () => {
    expectTransportTimeoutCleared(
      transform(ApifyBlock, {
        operation: 'apify_run_actor_async',
        apiKey: 'k',
        actorId: 'me/actor',
        timeout: '10',
      })
    )
  })

  it('clears the transport deadline when the subBlock is untouched', () => {
    expectTransportTimeoutCleared(
      transform(ApifyBlock, { operation: 'apify_get_run', apiKey: 'k', runId: 'r' })
    )
  })
})

describe('twilio voice timeout collision', () => {
  it('declares no reserved timeout param', () => {
    expect(makeCallTool.params.timeout).toBeUndefined()
    expect(makeCallTool.params.callTimeout).toBeDefined()
  })

  it('still sends the seconds value as the Timeout form field', () => {
    const body = makeCallTool.request.body?.({
      to: '+15551230000',
      from: '+15551239999',
      accountSid: 'AC',
      authToken: 't',
      twiml: '<Response/>',
      callTimeout: 10,
    } as any) as unknown as string
    expect(String(body)).toContain('Timeout=10')
  })

  it('maps the subBlock to callTimeout and clears the transport deadline', () => {
    const result = transform(TwilioVoiceBlock, {
      operation: 'make_call',
      to: '+15551230000',
      from: '+15551239999',
      timeout: '10',
    })
    expect(result.callTimeout).toBe(10)
    expectTransportTimeoutCleared(result)
  })

  it('clears the transport deadline on non-call operations', () => {
    expectTransportTimeoutCleared(transform(TwilioVoiceBlock, { operation: 'list_calls' }))
  })
})

describe('new relic timeout collision', () => {
  it('declares no reserved timeout param', () => {
    expect(newRelicNrqlQueryTool.params.timeout).toBeUndefined()
    expect(newRelicNrqlQueryTool.params.queryTimeout).toBeDefined()
  })

  it('still embeds the seconds value in the NRQL query', () => {
    const body = buildBody(newRelicNrqlQueryTool, {
      apiKey: 'k',
      accountId: 1,
      nrql: 'SELECT 1',
      queryTimeout: 10,
    })
    expect(String(body.query)).toContain('timeout: 10')
  })

  it('maps the subBlock to queryTimeout and clears the transport deadline', () => {
    const result = transform(NewRelicBlock, {
      operation: 'new_relic_nrql_query',
      apiKey: 'k',
      accountId: 1,
      nrql: 'SELECT 1',
      timeout: '10',
    })
    expect(result.queryTimeout).toBe(10)
    expectTransportTimeoutCleared(result)
  })

  it('clears the transport deadline on other operations', () => {
    expectTransportTimeoutCleared(
      transform(NewRelicBlock, { operation: 'new_relic_search_entities', apiKey: 'k', query: 'x' })
    )
  })
})

describe('trigger.dev waitpoint timeout collision', () => {
  it('declares no reserved timeout param', () => {
    expect(triggerDevCreateWaitpointTokenTool.params.timeout).toBeUndefined()
    expect(triggerDevCreateWaitpointTokenTool.params.tokenTimeout).toBeDefined()
  })

  it('still sends the duration as body.timeout', () => {
    const body = buildBody(triggerDevCreateWaitpointTokenTool, {
      apiKey: 'tr_x',
      tokenTimeout: '1m',
    })
    expect(body.timeout).toBe('1m')
  })

  it('maps the subBlock to tokenTimeout and clears the transport deadline', () => {
    const result = transform(TriggerDevBlock, {
      operation: 'trigger_dev_create_waitpoint_token',
      apiKey: 'tr_x',
      timeout: '1m',
    })
    expect(result.tokenTimeout).toBe('1m')
    expectTransportTimeoutCleared(result)
  })

  it('does not leak the waitpoint duration into other operations', () => {
    const result = transform(TriggerDevBlock, {
      operation: 'trigger_dev_list_runs',
      apiKey: 'tr_x',
      timeout: '1m',
    })
    expect(result.tokenTimeout).toBeUndefined()
    expectTransportTimeoutCleared(result)
  })
})
