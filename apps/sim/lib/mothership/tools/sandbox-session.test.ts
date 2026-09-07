/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { read, mint, fetchBootstrap, baseURL } = vi.hoisted(() => ({
  read: vi.fn(),
  mint: vi.fn(),
  fetchBootstrap: vi.fn(),
  baseURL: vi.fn(),
}))
vi.mock('node:fs/promises', () => ({ readFile: read }))
vi.mock('@/lib/mothership/chat/delegation', () => ({ mintDelegationToken: mint }))
vi.mock('@/lib/core/config/env', () => ({
  env: { MOTHERSHIP_SANDBOX_CLI_ENDPOINT: 'https://sim.test' },
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://unused.test' }))
vi.mock('@/lib/mothership/request/go/fetch', () => ({ fetchGo: fetchBootstrap }))
vi.mock('@/lib/mothership/request/headers', () => ({
  mothershipRequestHeaders: () => ({ 'x-api-key': 'worker-test-key' }),
}))
vi.mock('@/lib/mothership/server/agent-url', () => ({ getMothershipBaseURL: baseURL }))

import { buildMothershipSandboxSession } from '@/lib/mothership/tools/sandbox-session'

const request = { sessionKey: 'chat', workspaceId: 'workspace', userId: 'user' }

describe('deployment-owned workbench tooling', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mint.mockResolvedValue('test-delegation')
    baseURL.mockResolvedValue('https://worker.test')
    fetchBootstrap.mockImplementation(async () =>
      Response.json({ version: 1, entrypoint: 'private-entry' })
    )
  })

  it('stages the current deployment bundle and keeps credentials out of installed files', async () => {
    read.mockResolvedValueOnce('bundle-one').mockResolvedValueOnce('bundle-two')
    const first = await buildMothershipSandboxSession(request)
    const second = await buildMothershipSandboxSession(request)
    expect(first.cli).toMatchObject({
      content: 'private-entry',
      path: expect.stringMatching(/^\/home\/user\/\.sim-cli\/[a-f0-9]{64}\/cli\.mjs$/),
      runtime: { content: 'bundle-one', path: expect.stringMatching(/\/runtime\.mjs$/) },
    })
    expect(read).toHaveBeenCalledWith(expect.stringContaining('/dist/runtime.js'), 'utf8')
    expect(baseURL).toHaveBeenCalledWith({ userId: 'user' })
    expect(fetchBootstrap).toHaveBeenCalledWith(
      'https://worker.test/api/workbench/bootstrap',
      expect.objectContaining({
        headers: { 'x-api-key': 'worker-test-key' },
        redirect: 'error',
      })
    )
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

  it('pins both policy and runtime versions and refuses unavailable or malformed private bootstrap', async () => {
    read.mockResolvedValue('same-public-runtime')
    const first = await buildMothershipSandboxSession(request)
    fetchBootstrap.mockResolvedValueOnce(
      Response.json({ version: 1, entrypoint: 'private-entry-v2' })
    )
    const second = await buildMothershipSandboxSession(request)
    expect(second.cli?.path).not.toBe(first.cli?.path)
    for (const response of [
      new Response('Unavailable', { status: 503 }),
      Response.json({ version: 2, entrypoint: 'unknown' }),
    ]) {
      mint.mockClear()
      fetchBootstrap.mockResolvedValueOnce(response)
      await expect(buildMothershipSandboxSession(request)).rejects.toThrow()
      expect(mint).not.toHaveBeenCalled()
    }
  })

  it('cancels private bootstrap loading before provider or credential work', async () => {
    const controller = new AbortController()
    controller.abort(new Error('Stopped'))
    await expect(
      buildMothershipSandboxSession({ ...request, signal: controller.signal })
    ).rejects.toThrow('Stopped')
    expect(read).not.toHaveBeenCalled()
    expect(fetchBootstrap).not.toHaveBeenCalled()
    expect(mint).not.toHaveBeenCalled()
  })
})
