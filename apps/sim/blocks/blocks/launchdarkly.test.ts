import { describe, expect, it } from 'vitest'
import { LaunchDarklyBlock } from '@/blocks/blocks/launchdarkly'

type Params = Record<string, unknown>

const toolCall = (args: Params, operation: string): Params =>
  LaunchDarklyBlock.tools.config?.params?.(args as never, { operation }) as Params

describe('LaunchDarkly agent tool calls', () => {
  it('keeps the model name, key and boolean temporary flag on create_flag', () => {
    const mapped = toolCall(
      { projectKey: 'default', name: 'New checkout', key: 'new-checkout', temporary: true },
      'create_flag'
    )
    expect(mapped).toMatchObject({ name: 'New checkout', key: 'new-checkout', temporary: true })
  })

  it('keeps a boolean archive on update_flag', () => {
    expect(
      toolCall({ projectKey: 'default', flagKey: 'old-flag', archive: true }, 'update_flag').archive
    ).toBe(true)
  })
})
