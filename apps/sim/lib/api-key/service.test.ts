/**
 * Tests for authenticateApiKeyFromHeader.
 *
 * The path was rewritten to look up rows by the SHA-256 hash of the incoming
 * API key. A fallback loop — full scan + decrypt — is preserved while the
 * `key_hash` backfill runs, and emits a warn log whenever it actually matches
 * a row so we can tell when it's safe to delete.
 *
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

const { serviceLogger } = vi.hoisted(() => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    withMetadata: vi.fn(),
  }
  logger.child.mockReturnValue(logger)
  logger.withMetadata.mockReturnValue(logger)
  return { serviceLogger: logger }
})

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => serviceLogger),
  logger: serviceLogger,
  runWithRequestContext: vi.fn(<T>(_ctx: unknown, fn: () => T): T => fn()),
  getRequestContext: vi.fn(() => undefined),
}))

const { mockAuthenticateApiKey } = vi.hoisted(() => ({
  mockAuthenticateApiKey: vi.fn(),
}))

vi.mock('@/lib/api-key/auth', () => ({
  authenticateApiKey: mockAuthenticateApiKey,
}))

const { mockGetWorkspaceBillingSettings } = vi.hoisted(() => ({
  mockGetWorkspaceBillingSettings: vi.fn(),
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBillingSettings: mockGetWorkspaceBillingSettings,
}))

const { mockGetUserEntityPermissions } = vi.hoisted(() => ({
  mockGetUserEntityPermissions: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

import { hashApiKey } from '@/lib/api-key/crypto'
import { authenticateApiKeyFromHeader } from '@/lib/api-key/service'

const warnSpy = serviceLogger.warn

function personalKeyRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'key-1',
    userId: 'user-1',
    workspaceId: null as string | null,
    type: 'personal',
    key: 'encrypted:stored:value',
    expiresAt: null as Date | null,
    ...overrides,
  }
}

describe('authenticateApiKeyFromHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticateApiKey.mockReset()
    mockGetWorkspaceBillingSettings.mockReset()
    mockGetUserEntityPermissions.mockReset()
  })

  it('returns error when no header is provided', async () => {
    const result = await authenticateApiKeyFromHeader('')
    expect(result).toEqual({ success: false, error: 'API key required' })
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })

  it('resolves on the fast path when the hash lookup finds a row', async () => {
    const record = personalKeyRecord()
    dbChainMockFns.where.mockResolvedValueOnce([record])

    const result = await authenticateApiKeyFromHeader('sk-sim-plain-key', {
      userId: 'user-1',
    })

    expect(result).toEqual({
      success: true,
      userId: 'user-1',
      keyId: 'key-1',
      keyType: 'personal',
      workspaceId: undefined,
    })
    expect(dbChainMockFns.where).toHaveBeenCalledTimes(1)
    expect(mockAuthenticateApiKey).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('returns invalid when the hash lookup finds a row that fails scope checks', async () => {
    const record = personalKeyRecord({ userId: 'other-user' })
    dbChainMockFns.where.mockResolvedValueOnce([record])

    const result = await authenticateApiKeyFromHeader('sk-sim-plain-key', {
      userId: 'user-1',
    })

    expect(result).toEqual({ success: false, error: 'Invalid API key' })
    expect(dbChainMockFns.where).toHaveBeenCalledTimes(1)
    expect(mockAuthenticateApiKey).not.toHaveBeenCalled()
  })

  it('falls back to the decrypt loop when no row matches the hash, and warns on success', async () => {
    const record = personalKeyRecord()
    dbChainMockFns.where.mockResolvedValueOnce([]).mockResolvedValueOnce([record])
    mockAuthenticateApiKey.mockResolvedValueOnce(true)

    const result = await authenticateApiKeyFromHeader('sk-sim-plain-key', {
      userId: 'user-1',
    })

    expect(result).toEqual({
      success: true,
      userId: 'user-1',
      keyId: 'key-1',
      keyType: 'personal',
      workspaceId: undefined,
    })
    expect(dbChainMockFns.where).toHaveBeenCalledTimes(2)
    expect(mockAuthenticateApiKey).toHaveBeenCalledWith(
      'sk-sim-plain-key',
      'encrypted:stored:value'
    )
    expect(warnSpy).toHaveBeenCalledWith('API key matched via fallback decrypt loop', {
      keyId: 'key-1',
    })
  })

  it('returns invalid when the hash lookup misses and the fallback scan also misses', async () => {
    dbChainMockFns.where.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const result = await authenticateApiKeyFromHeader('sk-sim-plain-key', {
      userId: 'user-1',
    })

    expect(result).toEqual({ success: false, error: 'Invalid API key' })
    expect(dbChainMockFns.where).toHaveBeenCalledTimes(2)
    expect(mockAuthenticateApiKey).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('returns invalid when the hash lookup misses and every fallback candidate fails decrypt comparison', async () => {
    const record = personalKeyRecord()
    dbChainMockFns.where.mockResolvedValueOnce([]).mockResolvedValueOnce([record])
    mockAuthenticateApiKey.mockResolvedValueOnce(false)

    const result = await authenticateApiKeyFromHeader('sk-sim-plain-key', {
      userId: 'user-1',
    })

    expect(result).toEqual({ success: false, error: 'Invalid API key' })
    expect(mockAuthenticateApiKey).toHaveBeenCalledTimes(1)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('queries by the sha256 hash of the incoming header on the fast path', async () => {
    dbChainMockFns.where.mockResolvedValueOnce([personalKeyRecord()])

    await authenticateApiKeyFromHeader('sk-sim-plain-key', { userId: 'user-1' })

    const [filter] = dbChainMockFns.where.mock.calls[0]
    const expected = hashApiKey('sk-sim-plain-key')
    expect(JSON.stringify(filter)).toContain(expected)
  })
})
