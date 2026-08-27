/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { TriggerDevBlock } from '@/blocks/blocks/trigger_dev'
import { triggerDevGetEnvVarTool } from '@/tools/trigger_dev/get_env_var'
import { triggerDevListEnvVarsTool } from '@/tools/trigger_dev/list_env_vars'

/** Builds a JSON Response the way the executor hands one to transformResponse. */
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

describe('trigger.dev env var secret disambiguation', () => {
  it('surfaces isSecret from the retrieve endpoint, which returns it top-level', async () => {
    const result = await triggerDevGetEnvVarTool.transformResponse!(
      jsonResponse({ name: 'SLACK_API_KEY', value: 'tr_redacted', isSecret: true }),
      {} as never
    )

    expect(result.output).toEqual({
      name: 'SLACK_API_KEY',
      value: 'tr_redacted',
      isSecret: true,
    })
  })

  it('surfaces isSecret false for a non-secret variable', async () => {
    const result = await triggerDevGetEnvVarTool.transformResponse!(
      jsonResponse({ name: 'LOG_LEVEL', value: 'debug', isSecret: false }),
      {} as never
    )

    expect(result.output.isSecret).toBe(false)
  })

  it('surfaces isSecret per item from the list endpoint, which returns an array', async () => {
    const result = await triggerDevListEnvVarsTool.transformResponse!(
      jsonResponse([
        { name: 'SLACK_API_KEY', value: 'redacted', isSecret: true },
        { name: 'LOG_LEVEL', value: 'debug', isSecret: false },
      ]),
      {} as never
    )

    expect(result.output.variables).toEqual([
      { name: 'SLACK_API_KEY', value: 'redacted', isSecret: true },
      { name: 'LOG_LEVEL', value: 'debug', isSecret: false },
    ])
  })

  it('declares isSecret on both tools so it is selectable downstream', () => {
    expect(triggerDevGetEnvVarTool.outputs).toHaveProperty('isSecret')

    const variables = triggerDevListEnvVarsTool.outputs!.variables as {
      items: { properties: Record<string, unknown> }
    }
    expect(variables.items.properties).toHaveProperty('isSecret')
  })

  it('treats a missing isSecret as secret, never as a real plaintext value', async () => {
    const result = await triggerDevGetEnvVarTool.transformResponse!(
      jsonResponse({ name: 'MYSTERY', value: 'something' }),
      {} as never
    )

    expect(result.output.isSecret).toBe(true)
  })
})

describe('trigger.dev block env var outputs', () => {
  it('declares isSecret alongside its sibling value output', () => {
    expect(TriggerDevBlock.outputs).toHaveProperty('value')
    expect(TriggerDevBlock.outputs).toHaveProperty('isSecret')
  })
})
