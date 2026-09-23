/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamEvent } from '@/lib/mothership/request/types'

const { values, lists, seen, activeOwner, persist, redis } = vi.hoisted(() => {
  const values = new Map<string, string>()
  const lists = new Map<string, string[]>()
  const seen = new Map<string, Set<string>>()
  return {
    values,
    lists,
    seen,
    activeOwner: vi.fn(async () => true),
    persist: vi.fn(async () => {}),
    redis: {
      set: vi.fn(async (key: string, value: string) => {
        values.set(key, value)
      }),
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      exists: vi.fn(async (key: string) => (values.has(key) ? 1 : 0)),
      del: vi.fn(async (key: string) => {
        values.delete(key)
        lists.delete(key)
        seen.delete(key)
        return 1
      }),
      lrange: vi.fn(async (key: string, start: number, end: number) =>
        (lists.get(key) ?? []).slice(start, end + 1)
      ),
      lpop: vi.fn(async (key: string) => lists.get(key)?.shift() ?? null),
      eval: vi.fn(
        async (
          _script: string,
          _count: number,
          key: string,
          inbox: string,
          dedupe: string,
          value: string,
          _ttl: number,
          effectId: string
        ) => {
          if (!values.has(key)) return 0
          const ids = seen.get(dedupe) ?? new Set<string>()
          if (ids.has(effectId)) return 0
          ids.add(effectId)
          seen.set(dedupe, ids)
          lists.set(inbox, [...(lists.get(inbox) ?? []), value])
          return 1
        }
      ),
    },
  }
})
vi.mock('@/lib/core/config/redis', () => ({ getRedisClient: () => redis }))
vi.mock('@/lib/mothership/async-runs/repository', () => ({
  isActiveSandboxResourceOwner: activeOwner,
}))
vi.mock('@/lib/mothership/resources/persist-effect', () => ({ persistResourceEffect: persist }))

import {
  readSandboxResourceScope,
  recordSandboxResourceEffects,
  sandboxResourceEndpoint,
  withSandboxResourceScope,
} from '@/lib/mothership/tools/sandbox-resources'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session-key'

const identity = {
  runId: 'run',
  toolCallId: 'call',
  ownerToken: 'owner',
  userId: 'user',
  chatId: 'chat',
  workspaceId: 'workspace',
}
const args = { sessionKey: chatSandboxSessionKey('chat'), userId: 'user', workspaceId: 'workspace' }
const effect = {
  op: 'upsert' as const,
  resource: { type: 'table' as const, id: 'table', title: 'People' },
  effectId: 'run:call:request:0',
}

beforeEach(() => {
  vi.clearAllMocks()
  values.clear()
  lists.clear()
  seen.clear()
  activeOwner.mockResolvedValue(true)
  persist.mockResolvedValue(undefined)
})

describe('sandbox resource ownership and publication', () => {
  it('keeps chatless sessions on the ordinary endpoint', async () => {
    expect(await sandboxResourceEndpoint('https://sim.test', args, 'secret')).toBe(
      'https://sim.test'
    )
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('persists before the existing owner emits, and revokes the endpoint after final drain', async () => {
    let token = ''
    const events: StreamEvent[] = []
    const result = await withSandboxResourceScope(
      identity,
      new AbortController().signal,
      async (event) => {
        expect(persist).toHaveBeenCalledWith('chat', effect)
        events.push(event)
      },
      async () => {
        const endpoint = await sandboxResourceEndpoint('https://sim.test', args, 'secret')
        expect(endpoint).not.toContain('secret')
        token = endpoint.split('/').at(-1)!
        const scope = await readSandboxResourceScope(token, 'secret')
        expect(scope).toMatchObject(identity)
        expect(await readSandboxResourceScope(token, 'wrong-key')).toBeNull()
        await recordSandboxResourceEffects(token, scope!, [effect])
        return 'code result'
      }
    )
    expect(result).toBe('code result')
    expect(events).toEqual([{ type: 'resource', payload: effect }])
    expect(persist).toHaveBeenCalledTimes(1)
    expect(await readSandboxResourceScope(token, 'secret')).toBeNull()
    expect(lists.size).toBe(0)
  })

  it('publishes while code is still executing, not only at the final tool result', async () => {
    let finish = () => {}
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const emit = vi.fn()
    const execution = withSandboxResourceScope(
      identity,
      new AbortController().signal,
      emit,
      async () => {
        const endpoint = await sandboxResourceEndpoint('https://sim.test', args, 'secret')
        const token = endpoint.split('/').at(-1)!
        const scope = await readSandboxResourceScope(token, 'secret')
        await recordSandboxResourceEffects(token, scope!, [effect])
        await pending
      }
    )
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith({ type: 'resource', payload: effect }))
    finish()
    await execution
  })

  it('persists headless effects without requiring an event sink or changing code output', async () => {
    expect(
      await withSandboxResourceScope(
        identity,
        new AbortController().signal,
        undefined,
        async () => {
          const endpoint = await sandboxResourceEndpoint('https://sim.test', args, 'secret')
          const token = endpoint.split('/').at(-1)!
          const scope = await readSandboxResourceScope(token, 'secret')
          await recordSandboxResourceEffects(token, scope!, [effect])
          return 42
        }
      )
    ).toBe(42)
    expect(persist).toHaveBeenCalledWith('chat', effect)
  })

  it('rejects model-selected sessions and stale execution owners before dispatch', async () => {
    await withSandboxResourceScope(identity, new AbortController().signal, undefined, async () => {
      await expect(
        sandboxResourceEndpoint('https://sim.test', { ...args, sessionKey: 'other-chat' }, 'secret')
      ).rejects.toThrow('scope')
      const endpoint = await sandboxResourceEndpoint('https://sim.test', args, 'secret')
      activeOwner.mockResolvedValue(false)
      expect(await readSandboxResourceScope(endpoint.split('/').at(-1)!, 'secret')).toBeNull()
    })
  })

  it('revokes on cancellation and never emits an abandoned callback', async () => {
    const controller = new AbortController()
    const emit = vi.fn()
    await withSandboxResourceScope(identity, controller.signal, emit, async () => {
      const endpoint = await sandboxResourceEndpoint('https://sim.test', args, 'secret')
      const token = endpoint.split('/').at(-1)!
      const scope = await readSandboxResourceScope(token, 'secret')
      controller.abort()
      expect(await readSandboxResourceScope(token, 'secret')).toBeNull()
      await recordSandboxResourceEffects(token, scope!, [effect])
    })
    expect(persist).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('isolates simultaneous tool endpoints and inboxes', async () => {
    const tokens: string[] = []
    const emissions: string[][] = [[], []]
    await Promise.all(
      [0, 1].map((index) =>
        withSandboxResourceScope(
          { ...identity, toolCallId: `call-${index}`, ownerToken: `owner-${index}` },
          new AbortController().signal,
          (event) => {
            if (event.type === 'resource') emissions[index]!.push(event.payload.effectId!)
          },
          async () => {
            const endpoint = await sandboxResourceEndpoint('https://sim.test', args, 'secret')
            const token = endpoint.split('/').at(-1)!
            tokens.push(token)
            const scope = await readSandboxResourceScope(token, 'secret')
            expect(scope?.toolCallId).toBe(`call-${index}`)
            await recordSandboxResourceEffects(token, scope!, [
              { ...effect, effectId: `effect-${index}` },
            ])
          }
        )
      )
    )
    expect(new Set(tokens).size).toBe(2)
    expect(emissions).toEqual([['effect-0'], ['effect-1']])
  })

  it('does not replace successful code with a resource persistence failure', async () => {
    persist.mockRejectedValue(new Error('database temporarily unavailable'))
    expect(
      await withSandboxResourceScope(
        identity,
        new AbortController().signal,
        undefined,
        async () => {
          const endpoint = await sandboxResourceEndpoint('https://sim.test', args, 'secret')
          const token = endpoint.split('/').at(-1)!
          const scope = await readSandboxResourceScope(token, 'secret')
          await recordSandboxResourceEffects(token, scope!, [effect])
          return 'mutation succeeded'
        }
      )
    ).toBe('mutation succeeded')
  })

  it('deduplicates callback effects and drains every queued batch before completion', async () => {
    const emit = vi.fn()
    await withSandboxResourceScope(identity, new AbortController().signal, emit, async () => {
      const endpoint = await sandboxResourceEndpoint('https://sim.test', args, 'secret')
      const token = endpoint.split('/').at(-1)!
      const scope = await readSandboxResourceScope(token, 'secret')
      const effects = Array.from({ length: 193 }, (_, index) => ({
        ...effect,
        effectId: `effect-${index}`,
      }))
      await recordSandboxResourceEffects(token, scope!, effects)
      await recordSandboxResourceEffects(token, scope!, [effects[0]!])
    })
    expect(emit).toHaveBeenCalledTimes(193)
    expect(lists.size).toBe(0)
    expect(seen.size).toBe(0)
  })

  it('continues later effects after one notification fails without retrying the mutation', async () => {
    persist.mockRejectedValueOnce(new Error('database temporarily unavailable'))
    const emit = vi.fn()
    const execute = vi.fn(async () => {
      const endpoint = await sandboxResourceEndpoint('https://sim.test', args, 'secret')
      const token = endpoint.split('/').at(-1)!
      const scope = await readSandboxResourceScope(token, 'secret')
      await recordSandboxResourceEffects(token, scope!, [
        effect,
        { ...effect, effectId: 'later-effect' },
      ])
      return 'mutation succeeded'
    })
    expect(
      await withSandboxResourceScope(identity, new AbortController().signal, emit, execute)
    ).toBe('mutation succeeded')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledTimes(2)
    expect(emit).toHaveBeenCalledExactlyOnceWith({
      type: 'resource',
      payload: { ...effect, effectId: 'later-effect' },
    })
  })

  it('retries an owned emission failure without persisting the effect twice', async () => {
    const emit = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary sink error'))
      .mockResolvedValue(undefined)
    await withSandboxResourceScope(identity, new AbortController().signal, emit, async () => {
      const endpoint = await sandboxResourceEndpoint('https://sim.test', args, 'secret')
      const token = endpoint.split('/').at(-1)!
      const scope = await readSandboxResourceScope(token, 'secret')
      await recordSandboxResourceEffects(token, scope!, [effect])
    })
    expect(emit).toHaveBeenCalledTimes(2)
    expect(persist).toHaveBeenCalledTimes(1)
  })
})
