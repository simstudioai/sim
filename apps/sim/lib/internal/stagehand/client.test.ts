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
    mocks.instances.length = 0
    mocks.init.mockResolvedValue(undefined)
    mocks.close.mockResolvedValue(undefined)
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
