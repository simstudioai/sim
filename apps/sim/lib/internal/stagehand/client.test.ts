/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  init: vi.fn(),
  instances: [] as Array<{ options: Record<string, unknown> }>,
}))

vi.mock('@/lib/core/config/env', () => ({
  env: { BROWSERBASE_API_KEY: 'browserbase-key', BROWSERBASE_PROJECT_ID: 'project-id' },
}))

vi.mock('@browserbasehq/stagehand', () => ({
  Stagehand: class {
    options: Record<string, unknown>
    close = mocks.close
    init = mocks.init

    constructor(options: Record<string, unknown>) {
      this.options = options
      mocks.instances.push(this)
    }
  },
}))

import { createStagehandSession } from '@/lib/internal/stagehand/client'

describe('Stagehand session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.instances.length = 0
    mocks.init.mockResolvedValue(undefined)
    mocks.close.mockResolvedValue(undefined)
  })

  it('preserves Browserbase and provider configuration', async () => {
    const session = await createStagehandSession({
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      disableApi: true,
    })

    expect(mocks.instances[0].options).toMatchObject({
      env: 'BROWSERBASE',
      apiKey: 'browserbase-key',
      projectId: 'project-id',
      disableAPI: true,
      model: { modelName: 'anthropic/claude-sonnet-4-6', apiKey: 'sk-ant-test' },
    })
    await session.close()
    expect(mocks.close).toHaveBeenCalledOnce()
  })

  it('closes the browser and rejects an in-flight operation on cancellation', async () => {
    const controller = new AbortController()
    const session = await createStagehandSession({
      provider: 'openai',
      apiKey: 'sk-test',
      disableApi: false,
      signal: controller.signal,
    })
    const pending = new Promise<string>(() => {})
    const operation = session.run(pending)

    controller.abort(new Error('execution canceled'))

    await expect(operation).rejects.toThrow('execution canceled')
    await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledOnce())
  })
})
