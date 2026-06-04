/**
 * Tests for authenticateApiKeyFromHeader.
 *
 * Authentication looks up a single row by the SHA-256 hash of the incoming
 * API key and applies the scope / expiry / permission gates. Any miss — no
 * matching hash or a failed gate — returns an invalid result.
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

function personalKeyRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'key-1',
    userId: 'user-1',
    workspaceId: null as string | null,
    type: 'personal',
    expiresAt: null as Date | null,
    ...overrides,
  }
}

describe('authenticateApiKeyFromHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWorkspaceBillingSettings.mockReset()
    mockGetUserEntityPermissions.mockReset()
  })

  it('returns error when no header is provided', async () => {
    const result = await authenticateApiKeyFromHeader('')
    expect(result).toEqual({ success: false, error: 'API key required' })
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })

  it('resolves when the hash lookup finds a row', async () => {
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
  })

  it('returns invalid when the hash lookup finds a row that fails scope checks', async () => {
    const record = personalKeyRecord({ userId: 'other-user' })
    dbChainMockFns.where.mockResolvedValueOnce([record])

    const result = await authenticateApiKeyFromHeader('sk-sim-plain-key', {
      userId: 'user-1',
    })

    expect(result).toEqual({ success: false, error: 'Invalid API key' })
    expect(dbChainMockFns.where).toHaveBeenCalledTimes(1)
  })

  it('returns invalid when the hash lookup finds no row', async () => {
    dbChainMockFns.where.mockResolvedValueOnce([])

    const result = await authenticateApiKeyFromHeader('sk-sim-plain-key', {
      userId: 'user-1',
    })

    expect(result).toEqual({ success: false, error: 'Invalid API key' })
    expect(dbChainMockFns.where).toHaveBeenCalledTimes(1)
  })

  it('queries by the sha256 hash of the incoming header', async () => {
    dbChainMockFns.where.mockResolvedValueOnce([personalKeyRecord()])

    await authenticateApiKeyFromHeader('sk-sim-plain-key', { userId: 'user-1' })

    const [filter] = dbChainMockFns.where.mock.calls[0]
    const expected = hashApiKey('sk-sim-plain-key')
    expect(JSON.stringify(filter)).toContain(expected)
  })
})
