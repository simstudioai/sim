import { flushMicrotasks } from '@sim/testing'
import { mcpUseCasesMock, mcpUseCasesMockFns } from '@sim/testing/mocks/mcp-use-cases.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { discoverServerTools } = vi.hoisted(() => ({
  discoverServerTools: vi.fn(),
}))

vi.mock('@/lib/internal/mcp/discover-tools', () => ({
  discoverMcpServerToolsAsExecutor: discoverServerTools,
}))
vi.mock('@/lib/mcp/application/use-cases', () => mcpUseCasesMock)

import { DeadlineExceededError } from '@/lib/core/utils/deadline'
import { buildMcpToolSchemas } from '@/lib/mothership/mcp-tools'

mcpUseCasesMockFns.mockDiscoverMcpServerToolsUseCase.mockImplementation(async (args: unknown) => ({
  tools: await discoverServerTools(args),
}))

describe('mothership MCP tool schemas', () => {
  it('discovers tools only for explicitly tagged servers', async () => {
    discoverServerTools.mockResolvedValue([
      {
        serverId: 'mcp-server-1',
        serverName: 'Docs',
        name: 'search',
        description: 'Search docs',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      },
    ])

    const { tools, failures } = await buildMcpToolSchemas('user-1', 'ws-1', {
      complete: ['mcp-server-1'],
    })

    expect(discoverServerTools).toHaveBeenCalledTimes(1)
    expect(discoverServerTools).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ serverId: 'mcp-server-1', workspaceId: 'ws-1' }),
      })
    )
    expect(tools).toEqual([
      {
        name: 'mcp-server-1-search',
        description: 'Search docs',
        input_schema: { type: 'object', properties: { query: { type: 'string' } } },
        service: 'mcp:mcp-server-1',
      },
    ])
    expect(failures).toEqual([])
  })

  it('reports a failing or tool-less server without discarding the other servers', async () => {
    discoverServerTools.mockImplementation(async ({ input: { serverId } }) => {
      if (serverId === 'mcp-down') throw new Error('connect ECONNREFUSED')
      if (serverId === 'mcp-empty') return []
      return [{ serverId, name: 'search', inputSchema: { type: 'object' } }]
    })

    const discovery = await buildMcpToolSchemas('user-1', 'ws-1', {
      complete: ['mcp-down', 'mcp-server-1', 'mcp-empty'],
    })

    expect(discovery.tools.map((tool) => tool.name)).toEqual(['mcp-server-1-search'])
    expect(discovery.failures.map(({ serverId, error }) => [serverId, error.message])).toEqual([
      ['mcp-down', 'connect ECONNREFUSED'],
      ['mcp-empty', 'No permitted MCP operations are available for mcp-empty'],
    ])
  })

  it('treats a best-effort server with no permitted operations as contributing nothing', async () => {
    discoverServerTools.mockImplementation(async ({ input: { serverId } }) =>
      serverId === 'mcp-empty' ? [] : [{ serverId, name: 'search', inputSchema: {} }]
    )

    const discovery = await buildMcpToolSchemas('user-1', 'ws-1', {
      complete: [],
      bestEffort: ['mcp-empty', 'mcp-server-1'],
    })

    expect(discovery.tools.map((tool) => tool.name)).toEqual(['mcp-server-1-search'])
    expect(discovery.failures).toEqual([])
  })
})

/**
 * Broad chat discovery reaches every usable workspace server. Its failure modes are fan-out
 * (every server's connect started at once), latency that grows with the server count, a slow
 * server cut short by a wait that began before it started, and a down server reattempted on
 * every query. None of it may touch the servers the request names.
 */
describe('mothership MCP best-effort discovery bounds', () => {
  const hanging = () => new Promise<never>(() => undefined)
  const toolsOf = (serverId: string) => [{ serverId, name: 'search', inputSchema: {} }]
  const serverIdOf = (args: unknown) => (args as { input: { serverId: string } }).input.serverId
  const startedServers = () => discoverServerTools.mock.calls.map(([args]) => serverIdOf(args))
  const ids = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`)

  let clockStart = 0
  let clockOffset = 0
  /**
   * `lru-cache` captures `performance` at load, so fake timers cannot move the memo's clock: spy it
   * forward with the faked `Date` and timers.
   */
  async function advanceClock(ms: number): Promise<void> {
    clockOffset += ms
    vi.spyOn(performance, 'now').mockImplementation(() => clockStart + clockOffset)
    await vi.advanceTimersByTimeAsync(ms)
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    clockStart = performance.now()
    clockOffset = 0
    discoverServerTools.mockReset()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('starts at most eight best-effort discoveries at once and skips the rest once the start window closes', async () => {
    discoverServerTools.mockImplementation(hanging)
    const servers = ids('mcp-hang', 20)

    const pending = buildMcpToolSchemas('user-cap', 'ws-cap', { complete: [], bestEffort: servers })
    await flushMicrotasks(10)
    expect(startedServers()).toEqual(servers.slice(0, 8))

    await vi.advanceTimersByTimeAsync(3_000)
    const discovery = await pending
    expect(startedServers()).toEqual(servers.slice(0, 8))
    expect(discovery.failures.map(({ serverId }) => serverId)).toEqual(servers)
    expect(discovery.failures.every(({ error }) => error instanceof DeadlineExceededError)).toBe(
      true
    )
  })

  it('keeps discovering fast servers while slow ones hold their slots', async () => {
    const fast = ids('mcp-fast', 10)
    discoverServerTools.mockImplementation(async (args: unknown) => {
      const serverId = serverIdOf(args)
      return serverId === 'mcp-slow' ? hanging() : toolsOf(serverId)
    })

    const pending = buildMcpToolSchemas('user-fast', 'ws-fast', {
      complete: [],
      bestEffort: ['mcp-slow', ...fast],
    })
    await flushMicrotasks(50)
    expect(startedServers()).toEqual(['mcp-slow', ...fast])

    await vi.advanceTimersByTimeAsync(3_000)
    const discovery = await pending
    expect(discovery.tools.map((tool) => tool.service)).toEqual(
      fast.map((serverId) => `mcp:${serverId}`)
    )
    expect(discovery.failures.map(({ serverId }) => serverId)).toEqual(['mcp-slow'])
  })

  it("measures each server's wait from its own start, not the query's", async () => {
    const blockers = ids('mcp-block', 8)
    discoverServerTools.mockImplementation((args: unknown) => {
      const serverId = serverIdOf(args)
      if (serverId === 'mcp-block-1')
        return new Promise((resolve) => setTimeout(() => resolve(toolsOf(serverId)), 1_000))
      if (serverId === 'mcp-late') {
        const resolveAt = 3_500 - (Date.now() - startedAt)
        return new Promise((resolve) => setTimeout(() => resolve(toolsOf(serverId)), resolveAt))
      }
      return hanging()
    })
    const startedAt = Date.now()

    const pending = buildMcpToolSchemas('user-own', 'ws-own', {
      complete: [],
      bestEffort: [...blockers, 'mcp-late'],
    })
    await vi.advanceTimersByTimeAsync(4_000)
    const discovery = await pending

    expect(discovery.tools.map((tool) => tool.service)).toEqual(['mcp:mcp-block-1', 'mcp:mcp-late'])
    expect(discovery.failures.map(({ serverId }) => serverId)).toEqual(blockers.slice(1))
  })

  it('lists every named server at once and waits for each however long it takes', async () => {
    const named = ids('mcp-named', 12)
    discoverServerTools.mockImplementation((args: unknown) => {
      const serverId = serverIdOf(args)
      return serverId.startsWith('mcp-named')
        ? new Promise((resolve) => setTimeout(() => resolve(toolsOf(serverId)), 30_000))
        : hanging()
    })

    const pending = buildMcpToolSchemas('user-named', 'ws-named', {
      complete: named,
      bestEffort: ids('mcp-optional', 10),
    })
    await flushMicrotasks(10)
    expect(startedServers()).toEqual([...named, ...ids('mcp-optional', 8)])

    await vi.advanceTimersByTimeAsync(30_000)
    const discovery = await pending
    expect(discovery.tools.map((tool) => tool.service)).toEqual(
      named.map((serverId) => `mcp:${serverId}`)
    )
    expect(discovery.failures.map(({ serverId }) => serverId)).toEqual(ids('mcp-optional', 10))
  })

  it('does not reattempt a failed best-effort server for the same requester until the memo expires', async () => {
    discoverServerTools.mockRejectedValue(new Error('connect ECONNREFUSED'))
    const query = (userId: string) =>
      buildMcpToolSchemas(userId, 'ws-memo', { complete: [], bestEffort: ['mcp-down'] })

    expect((await query('user-memo-a')).failures.map(({ error }) => error.message)).toEqual([
      'connect ECONNREFUSED',
    ])
    expect((await query('user-memo-a')).failures.map(({ error }) => error.message)).toEqual([
      'connect ECONNREFUSED',
    ])
    expect(discoverServerTools).toHaveBeenCalledTimes(1)

    await query('user-memo-b')
    expect(discoverServerTools).toHaveBeenCalledTimes(2)

    await advanceClock(61_000)
    await query('user-memo-a')
    expect(discoverServerTools).toHaveBeenCalledTimes(3)
  })

  it('skips a server whose discovery outlived the wait until that discovery settles, then serves it', async () => {
    discoverServerTools.mockImplementation(
      (args: unknown) =>
        new Promise((resolve) => setTimeout(() => resolve(toolsOf(serverIdOf(args))), 5_000))
    )
    const query = () =>
      buildMcpToolSchemas('user-slow', 'ws-slow', { complete: [], bestEffort: ['mcp-slow'] })

    const first = query()
    await vi.advanceTimersByTimeAsync(3_000)
    expect((await first).failures.map(({ serverId }) => serverId)).toEqual(['mcp-slow'])

    const second = query()
    await flushMicrotasks(10)
    expect(discoverServerTools).toHaveBeenCalledTimes(1)
    expect((await second).failures.map(({ serverId }) => serverId)).toEqual(['mcp-slow'])

    await vi.advanceTimersByTimeAsync(2_000)
    discoverServerTools.mockResolvedValueOnce(toolsOf('mcp-slow'))
    expect((await query()).tools.map((tool) => tool.service)).toEqual(['mcp:mcp-slow'])
    expect(discoverServerTools).toHaveBeenCalledTimes(2)
  })

  it("keeps a newer attempt's failure when an older attempt succeeds late", async () => {
    discoverServerTools
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve(toolsOf('mcp-flaky')), 70_000))
      )
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
    const query = () =>
      buildMcpToolSchemas('user-race-a', 'ws-race', { complete: [], bestEffort: ['mcp-flaky'] })

    const first = query()
    await advanceClock(3_000)
    expect((await first).failures.map(({ serverId }) => serverId)).toEqual(['mcp-flaky'])
    await advanceClock(61_000)
    expect((await query()).failures.map(({ error }) => error.message)).toEqual([
      'connect ECONNREFUSED',
    ])

    await advanceClock(6_000)
    const third = query()
    await flushMicrotasks(10)
    expect(discoverServerTools).toHaveBeenCalledTimes(2)
    expect((await third).failures.map(({ error }) => error.message)).toEqual([
      'connect ECONNREFUSED',
    ])
  })

  it('does not remember a server whose older attempt fails late after a newer one succeeded', async () => {
    discoverServerTools
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error('connect ETIMEDOUT')), 70_000)
          )
      )
      .mockResolvedValueOnce(toolsOf('mcp-flaky'))
      .mockResolvedValueOnce(toolsOf('mcp-flaky'))
    const query = () =>
      buildMcpToolSchemas('user-race-b', 'ws-race', { complete: [], bestEffort: ['mcp-flaky'] })

    const first = query()
    await advanceClock(3_000)
    expect((await first).failures.map(({ serverId }) => serverId)).toEqual(['mcp-flaky'])
    await advanceClock(61_000)
    expect((await query()).tools.map((tool) => tool.service)).toEqual(['mcp:mcp-flaky'])

    await advanceClock(6_000)
    expect((await query()).tools.map((tool) => tool.service)).toEqual(['mcp:mcp-flaky'])
    expect(discoverServerTools).toHaveBeenCalledTimes(3)
  })
})
