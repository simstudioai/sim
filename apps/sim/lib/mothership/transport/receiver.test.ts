import { createDeferred } from '@sim/testing/helpers/deferred'
import { setEnv } from '@sim/testing/mocks/env.mock'
import { setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import {
  mothershipAgentUrlMock,
  mothershipAgentUrlMockFns,
} from '@sim/testing/mocks/mothership-agent-url.mock'
import {
  mothershipGoFetchMock,
  mothershipGoFetchMockFns,
} from '@sim/testing/mocks/mothership-go-fetch.mock'
import { utilsHelpersMock, utilsHelpersMockFns } from '@sim/testing/mocks/utils-helpers.mock'
import { generateId } from '@sim/utils/id'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/lib/mothership/request/go/fetch', () => mothershipGoFetchMock)
vi.mock('@/lib/mothership/request/headers', () => ({
  mothershipRequestHeaders: () => ({ 'x-api-key': 'worker-key' }),
}))
vi.mock('@/lib/mothership/transport/control', () => ({ executeSimControl: execute }))
vi.mock('@/lib/mothership/server/agent-url', () => mothershipAgentUrlMock)
vi.mock('@sim/utils/helpers', () => utilsHelpersMock)

import { SIM_CONTROL_KINDS } from '@/lib/mothership/generated/sim-transport'
import { receiveSimControls, startSimReceivers } from '@/lib/mothership/transport/receiver'

const mocks = {
  fetch: mothershipGoFetchMockFns.mockFetchGo,
  execute,
  sleep: utilsHelpersMockFns.mockSleep,
}

function request() {
  const chatId = generateId()
  return {
    id: generateId(),
    expiresAt: Date.now() + 5000,
    scope: { chatId, userId: 'user', workspaceId: generateId() },
    operation: { kind: 'run_control', input: { chatId, streamId: generateId() } },
  }
}

describe('outbound receiver lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mothershipAgentUrlMockFns.mockGetMothershipBaseURL.mockResolvedValue('https://worker.test')
    mocks.sleep.mockResolvedValue(undefined)
    mocks.execute.mockResolvedValue({ status: 200, body: '{"stopped":false}' })
  })

  it('reconnects after a lost poll and correlates parallel replies by request ID', async () => {
    const controller = new AbortController()
    const first = request()
    const second = request()
    const replies: unknown[] = []
    let polls = 0
    mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      expect(url.startsWith('https://worker.test/api/sim-transport/')).toBe(true)
      expect(init.headers).toEqual({ 'x-api-key': 'worker-key' })
      expect(init.redirect).toBe('error')
      if (url.endsWith('/poll')) {
        polls++
        if (polls === 1) throw new Error('connection lost')
        if (polls === 2) return Response.json({ requests: [first, second] })
        controller.abort()
        throw new Error('shutdown')
      }
      replies.push(JSON.parse(String(init.body)))
      return Response.json({ accepted: true })
    })
    await receiveSimControls('https://worker.test', 'a'.repeat(64), controller.signal)
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(replies).toEqual(
      expect.arrayContaining([
        {
          channelId: 'a'.repeat(64),
          id: first.id,
          result: { status: 200, body: '{"stopped":false}' },
        },
        {
          channelId: 'a'.repeat(64),
          id: second.id,
          result: { status: 200, body: '{"stopped":false}' },
        },
      ])
    )
    expect(mocks.sleep).toHaveBeenCalledOnce()
  })

  it('does not execute redirected responses or requests it cannot read as Sim operations', async () => {
    const controller = new AbortController()
    const replies: string[] = []
    mocks.fetch
      .mockResolvedValueOnce(new Response(null, { status: 302 }))
      .mockResolvedValueOnce(Response.json({ requests: [{ operation: { kind: 'unknown' } }] }))
      .mockImplementation(async (url: string, init: RequestInit) => {
        if (url.endsWith('/reply')) {
          replies.push(String(init.body))
          return Response.json({ accepted: true })
        }
        controller.abort()
        throw new Error('shutdown')
      })
    await receiveSimControls('https://worker.test', 'a'.repeat(64), controller.signal)
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(replies).toEqual([])
    expect(mocks.sleep).toHaveBeenCalledOnce()
    expect(getMockLogger('MothershipTransportReceiver').warn).toHaveBeenCalledWith(
      'Unreadable Sim control request dropped'
    )
  })

  it('answers an unknown kind 501 and a malformed input 400 while their batch-mates still run', async () => {
    const controller = new AbortController()
    const valid = request()
    const unknown = { ...request(), operation: { kind: 'a_future_kind', input: {} } }
    const malformed = { ...request(), operation: { kind: 'run_control', input: { chatId: 7 } } }
    const kindless = { ...request(), operation: { input: {} } }
    const replies: { id: string; result: { status: number; body: string } }[] = []
    let polls = 0
    mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/reply')) {
        replies.push(JSON.parse(String(init.body)))
        return Response.json({ accepted: true })
      }
      polls++
      if (polls === 1) return Response.json({ requests: [unknown, valid, malformed, kindless] })
      controller.abort()
      throw new Error('shutdown')
    })
    await receiveSimControls('https://worker.test', 'a'.repeat(64), controller.signal)
    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(mocks.execute).toHaveBeenCalledWith(valid)
    expect(replies).toHaveLength(4)
    expect(replies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: valid.id,
          result: { status: 200, body: '{"stopped":false}' },
        }),
        expect.objectContaining({
          id: unknown.id,
          result: {
            status: 501,
            body: JSON.stringify({ error: 'sim_control_unsupported', kind: 'a_future_kind' }),
          },
        }),
        expect.objectContaining({
          id: malformed.id,
          result: { status: 400, body: '{"error":"Invalid Sim control request"}' },
        }),
        expect.objectContaining({
          id: kindless.id,
          result: { status: 400, body: '{"error":"Invalid Sim control request"}' },
        }),
      ])
    )
    expect(mocks.sleep).not.toHaveBeenCalled()
  })

  it('declares on every poll exactly the kinds its generated contract parses', async () => {
    const controller = new AbortController()
    const polls: unknown[] = []
    mocks.fetch.mockImplementation(async (_url: string, init: RequestInit) => {
      polls.push(JSON.parse(String(init.body)))
      if (polls.length === 1) throw new Error('connection lost')
      controller.abort()
      throw new Error('shutdown')
    })
    await receiveSimControls('https://worker.test', 'a'.repeat(64), controller.signal)
    expect(SIM_CONTROL_KINDS).toContain('memory_scope')
    expect(polls).toEqual([
      { channelId: 'a'.repeat(64), accepts: SIM_CONTROL_KINDS },
      { channelId: 'a'.repeat(64), accepts: SIM_CONTROL_KINDS },
    ])
  })

  it('does not repeat an operation when its reply acknowledgement is lost', async () => {
    const controller = new AbortController()
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ requests: [request()] }))
      .mockRejectedValueOnce(new Error('reply lost'))
      .mockImplementationOnce(async () => {
        controller.abort()
        throw new Error('shutdown')
      })
    await receiveSimControls('https://worker.test', 'a'.repeat(64), controller.signal)
    expect(mocks.execute).toHaveBeenCalledOnce()
  })

  it.each(['dev', 'dedicated'])(
    'services %s benchmark controls when ordinary hosted traffic uses direct callbacks',
    async (endpoint) => {
      setEnvFlags({ isHosted: true, isMothershipBenchmarkEnabled: true })
      setEnv({
        COPILOT_API_KEY: 'worker-key',
        COPILOT_DEV_URL: endpoint === 'dev' ? 'https://benchmark-worker.test/' : undefined,
        MOTHERSHIP_BENCHMARK_URL:
          endpoint === 'dedicated' ? 'https://dedicated-benchmark.test/' : undefined,
        MOTHERSHIP_SIM_TRANSPORT: 'direct',
      })
      const shutdown: (() => void)[] = []
      const listeners = vi.spyOn(process, 'once').mockImplementation((_event, listener) => {
        shutdown.push(() => listener())
        return process
      })
      const control = request()
      const reply = createDeferred<{ id: string; result: { body: string } }>()
      let polls = 0
      mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
        if (url.endsWith('/poll')) {
          polls++
          if (polls === 1) return Response.json({ requests: [control] })
          return new Promise<Response>(() => {})
        }
        reply.resolve(JSON.parse(String(init.body)))
        return Response.json({ accepted: true })
      })
      try {
        await startSimReceivers()
        expect(polls).toBe(1)
        expect(await reply.promise).toMatchObject({
          id: control.id,
          result: { body: '{"stopped":false}' },
        })
      } finally {
        for (const stop of shutdown) stop()
        listeners.mockRestore()
      }
    }
  )
})
