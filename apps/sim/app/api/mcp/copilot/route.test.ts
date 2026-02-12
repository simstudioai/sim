/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('mcp copilot route manifest contract', () => {
  const previousInternalSecret = process.env.INTERNAL_API_SECRET
  const previousAgentUrl = process.env.SIM_AGENT_API_URL
  const previousFetch = global.fetch

  beforeEach(() => {
    vi.resetModules()
    process.env.INTERNAL_API_SECRET = 'x'.repeat(32)
    process.env.SIM_AGENT_API_URL = 'https://copilot.sim.ai'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    global.fetch = previousFetch
    if (previousInternalSecret === undefined) {
      delete process.env.INTERNAL_API_SECRET
    } else {
      process.env.INTERNAL_API_SECRET = previousInternalSecret
    }
    if (previousAgentUrl === undefined) {
      delete process.env.SIM_AGENT_API_URL
    } else {
      process.env.SIM_AGENT_API_URL = previousAgentUrl
    }
  })

  it('loads and caches tool manifest from copilot backend', async () => {
    const payload = {
      directTools: [
        {
          name: 'list_workspaces',
          description: 'List workspaces',
          inputSchema: { type: 'object', properties: {} },
          toolId: 'list_user_workspaces',
        },
      ],
      subagentTools: [
        {
          name: 'sim_build',
          description: 'Build workflows',
          inputSchema: { type: 'object', properties: {} },
          agentId: 'build',
        },
      ],
      generatedAt: '2026-02-12T00:00:00Z',
    }

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const mod = await import('./route')
    mod.clearMcpToolManifestCacheForTests()

    const first = await mod.getMcpToolManifest()
    const second = await mod.getMcpToolManifest()

    expect(first).toEqual(payload)
    expect(second).toEqual(payload)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://copilot.sim.ai/api/mcp/tools/manifest')
  })

  it('rejects invalid manifest payloads from copilot backend', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ tools: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const mod = await import('./route')
    mod.clearMcpToolManifestCacheForTests()

    await expect(mod.fetchMcpToolManifestFromCopilot()).rejects.toThrow(
      'invalid manifest payload from copilot'
    )
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
