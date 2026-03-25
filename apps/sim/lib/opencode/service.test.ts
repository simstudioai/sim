/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => ({
  db: {},
}))

vi.mock('@sim/db/schema', () => ({
  memory: {},
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
}))

vi.mock('@/lib/opencode/client', () => ({
  createOpenCodeClient: vi.fn(),
}))

import { shouldRetryWithFreshOpenCodeSession } from '@/lib/opencode/service'

describe('shouldRetryWithFreshOpenCodeSession', () => {
  it('returns true for stale-session errors', () => {
    expect(shouldRetryWithFreshOpenCodeSession(new Error('404 session not found'))).toBe(true)
    expect(shouldRetryWithFreshOpenCodeSession('session does not exist')).toBe(true)
    expect(shouldRetryWithFreshOpenCodeSession('unknown session')).toBe(true)
  })

  it('returns false for unrelated session errors', () => {
    expect(shouldRetryWithFreshOpenCodeSession(new Error('session limit exceeded'))).toBe(false)
    expect(shouldRetryWithFreshOpenCodeSession('invalid session format')).toBe(false)
    expect(shouldRetryWithFreshOpenCodeSession('model not found')).toBe(false)
    expect(shouldRetryWithFreshOpenCodeSession('provider does not exist')).toBe(false)
  })
})
