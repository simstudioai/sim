import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { createMockRedis } from '@sim/testing/mocks/redis.mock'
import { redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_ICON_BYTES } from '@/lib/favicon/probe'
import { resolveFavicon } from '@/lib/favicon/resolve.server'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const DAY = 24 * 60 * 60

type Answer = 'icon' | 'none' | 'timeout'

/** Each host's answer at both providers; any host not listed has no icon. */
let answers: Record<string, Answer> = {}
let stored: Map<string, { value: Buffer; ttl: number }>

function hostOf(url: string): string {
  const match = url.match(/url=https:\/\/([^&]+)&/) ?? url.match(/\/ip3\/(.+)\.ico$/)
  if (!match) throw new Error(`Unexpected provider URL ${url}`)
  return match[1]
}

beforeEach(() => {
  answers = {}
  stored = new Map()
  const redis = createMockRedis()
  redis.getBuffer.mockImplementation(async (key: string) => stored.get(key)?.value ?? null)
  redis.set.mockImplementation(
    async (key: string, value: Buffer | string, _ex: string, ttl: number) => {
      stored.set(key, { value: Buffer.from(value), ttl })
      return 'OK'
    }
  )
  redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis)
  inputValidationMockFns.mockSecureFetchWithValidation.mockImplementation(async (url: string) => {
    const answer = answers[hostOf(url)] ?? 'none'
    if (answer === 'timeout') throw new Error('timed out')
    return {
      status: answer === 'icon' ? 200 : 404,
      arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
      body: { cancel: async () => {} },
    }
  })
})

const ttlOf = (host: string) => stored.get(`favicon:v3:${host}`)?.ttl

describe('resolveFavicon', () => {
  it('keeps a parent icon chosen after a timeout provisional when a child host reuses it', async () => {
    answers = { 'gitlab.acme-internal.io': 'timeout', 'gitlab.com': 'icon' }
    expect((await resolveFavicon('gitlab.acme-internal.io')).kind).toBe('hit')
    expect(ttlOf('gitlab.acme-internal.io')).toBe(DAY)

    expect((await resolveFavicon('docs.gitlab.acme-internal.io')).kind).toBe('hit')
    expect(ttlOf('docs.gitlab.acme-internal.io')).toBe(DAY)
  })

  it('still reaches the product fallback after its parent was cached as a miss', async () => {
    answers = { 'atlassian.com': 'icon' }
    expect((await resolveFavicon('acme-internal.io')).kind).toBe('miss')

    expect((await resolveFavicon('jira.acme-internal.io')).kind).toBe('hit')
  })

  it('remembers a definite icon for a month', async () => {
    answers = { 'acme.example.com': 'icon' }
    expect((await resolveFavicon('acme.example.com')).kind).toBe('hit')
    expect(ttlOf('acme.example.com')).toBe(30 * DAY)
  })

  it('asks no provider and caches nothing when a lookup is not admitted', async () => {
    answers = { 'acme.example.com': 'icon' }
    expect((await resolveFavicon('acme.example.com', async () => false)).kind).toBe('unavailable')
    expect(inputValidationMockFns.mockSecureFetchWithValidation).not.toHaveBeenCalled()
    expect(ttlOf('acme.example.com')).toBeUndefined()
  })

  it('serves a cached icon without asking to admit a lookup', async () => {
    answers = { 'acme.example.com': 'icon' }
    await resolveFavicon('acme.example.com')
    const admit = vi.fn(async () => false)
    expect((await resolveFavicon('acme.example.com', admit)).kind).toBe('hit')
    expect(admit).not.toHaveBeenCalled()
  })

  it('looks up an icon cached under an earlier, larger cap again instead of serving it', async () => {
    answers = { 'acme.example.com': 'icon' }
    const oversized = Buffer.concat([Buffer.from('h'), PNG, Buffer.alloc(MAX_ICON_BYTES)])
    stored.set('favicon:v3:acme.example.com', { value: oversized, ttl: 30 * DAY })
    const result = await resolveFavicon('acme.example.com')
    expect(result.kind === 'hit' && result.bytes.length).toBe(PNG.length)
    expect(inputValidationMockFns.mockSecureFetchWithValidation).toHaveBeenCalled()
  })

  it("never lets one caller's refused budget answer another caller's lookup", async () => {
    answers = { 'acme.example.com': 'icon' }
    const [refused, admitted] = await Promise.all([
      resolveFavicon('acme.example.com', async () => false),
      resolveFavicon('acme.example.com', async () => true),
    ])
    expect(refused.kind).toBe('unavailable')
    expect(admitted.kind).toBe('hit')
  })

  it('does not charge a caller who joins a lookup already asking the providers', async () => {
    answers = { 'acme.example.com': 'icon' }
    const fetchProvider = inputValidationMockFns.mockSecureFetchWithValidation
    const answerProvider = fetchProvider.getMockImplementation()
    let release = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    fetchProvider.mockImplementation(
      async (...args: Parameters<NonNullable<typeof answerProvider>>) => {
        await released
        return answerProvider?.(...args)
      }
    )
    const first = resolveFavicon('acme.example.com')
    await vi.waitFor(() => expect(fetchProvider).toHaveBeenCalled())
    const joinerAdmit = vi.fn(async () => true)
    const joined = resolveFavicon('acme.example.com', joinerAdmit)
    release()
    expect((await joined).kind).toBe('hit')
    expect((await first).kind).toBe('hit')
    expect(joinerAdmit).not.toHaveBeenCalled()
  })
})
