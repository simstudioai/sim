/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { read, mint } = vi.hoisted(() => ({ read: vi.fn(), mint: vi.fn() }))
vi.mock('node:fs/promises', () => ({ readFile: read }))
vi.mock('@/lib/mothership/chat/delegation', () => ({ mintDelegationToken: mint }))
vi.mock('@/lib/core/config/env', () => ({
  env: { MOTHERSHIP_SANDBOX_CLI_ENDPOINT: 'https://sim.test' },
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://unused.test' }))

import { buildMothershipSandboxSession } from '@/lib/mothership/tools/sandbox-session'

const request = { sessionKey: 'chat', workspaceId: 'workspace', userId: 'user' }

describe('deployment-owned workbench tooling', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mint.mockResolvedValue('test-delegation')
  })

  it('stages the current deployment bundle and keeps credentials out of installed files', async () => {
    read.mockResolvedValueOnce('bundle-one').mockResolvedValueOnce('bundle-two')
    const first = await buildMothershipSandboxSession(request)
    const second = await buildMothershipSandboxSession(request)
    expect(first.cli).toMatchObject({
      content: 'bundle-one',
      path: expect.stringMatching(/^\/home\/user\/\.sim-cli\/[a-f0-9]{64}\/cli\.mjs$/),
    })
    expect(second.cli?.path).not.toBe(first.cli?.path)
    expect(JSON.stringify(first.cli)).not.toContain('test-delegation')
    expect(first.envs).toEqual({
      SIM_API_KEY: 'test-delegation',
      SIM_WORKSPACE: 'workspace',
      SIM_ENDPOINT: 'https://sim.test',
    })
  })

  it('refuses setup when the deployment artifact is missing instead of fetching another CLI release', async () => {
    read.mockRejectedValue(new Error('missing workbench bundle'))
    await expect(buildMothershipSandboxSession(request)).rejects.toThrow('missing workbench bundle')
    expect(mint).not.toHaveBeenCalled()
  })
})
