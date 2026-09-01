/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { PiSdk } from '@/executor/handlers/pi/core/pi-sdk'
import { createSealedPiResourceLoader } from '@/executor/handlers/pi/core/pi-sdk'

describe('createSealedPiResourceLoader', () => {
  it('exposes no discovered prompt sources or repository resources', async () => {
    const extensionRuntime = { marker: 'runtime' }
    const sdk = {
      createExtensionRuntime: vi.fn(() => extensionRuntime),
    } as unknown as PiSdk

    const loader = createSealedPiResourceLoader(sdk, 'sealed system prompt')

    expect(loader.getExtensions()).toEqual({
      extensions: [],
      errors: [],
      runtime: extensionRuntime,
    })
    expect(loader.getAgentsFiles()).toEqual({ agentsFiles: [] })
    expect(loader.getSystemPrompt()).toBe('sealed system prompt')
    expect(loader.getSystemPromptSource()).toBeUndefined()
    expect(loader.getAppendSystemPrompt()).toEqual([])
    expect(loader.getAppendSystemPromptSources()).toEqual([])
    await expect(loader.reload()).resolves.toBeUndefined()
  })
})
