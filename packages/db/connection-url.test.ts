/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveDbUrl } from './connection-url'

describe('resolveDbUrl', () => {
  const KEYS = [
    'DATABASE_URL',
    'DATABASE_URL_WEB',
    'DATABASE_URL_TRIGGER',
    'DATABASE_REPLICA_URL',
    'DATABASE_REPLICA_URL_TRIGGER',
  ] as const
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  it('prefers the role-keyed primary URL over the base', () => {
    process.env.DATABASE_URL = 'postgres://base/db'
    process.env.DATABASE_URL_TRIGGER = 'postgres://trigger/db'
    expect(resolveDbUrl('DATABASE_URL', 'trigger')).toBe('postgres://trigger/db')
  })

  it('falls back to the base URL when the keyed var is unset', () => {
    process.env.DATABASE_URL = 'postgres://base/db'
    expect(resolveDbUrl('DATABASE_URL', 'web')).toBe('postgres://base/db')
  })

  it('returns undefined when neither keyed nor base is set', () => {
    expect(resolveDbUrl('DATABASE_URL', 'realtime')).toBeUndefined()
  })

  it('resolves the replica variant independently of the primary', () => {
    process.env.DATABASE_REPLICA_URL = 'postgres://replica/db'
    process.env.DATABASE_REPLICA_URL_TRIGGER = 'postgres://trigger-replica/db'
    expect(resolveDbUrl('DATABASE_REPLICA_URL', 'trigger')).toBe('postgres://trigger-replica/db')
    expect(resolveDbUrl('DATABASE_REPLICA_URL', 'web')).toBe('postgres://replica/db')
  })

  it('uppercases the role to build the keyed var name', () => {
    process.env.DATABASE_URL_WEB = 'postgres://web/db'
    expect(resolveDbUrl('DATABASE_URL', 'web')).toBe('postgres://web/db')
  })
})
