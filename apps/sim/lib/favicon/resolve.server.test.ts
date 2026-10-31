import {
  createMockRedis,
  inputValidationMock,
  inputValidationMockFns,
  redisConfigMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
})
