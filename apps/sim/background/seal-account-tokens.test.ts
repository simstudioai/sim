/**
 * @vitest-environment node
 */

import { sealingKeyId } from '@sim/security/encryption'
import { databaseMockFns } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPostgres } = vi.hoisted(() => ({ mockPostgres: vi.fn() }))

vi.mock('postgres', () => ({ default: mockPostgres }))
/** The pass derives each column's sealing context from the real column definitions. */
vi.unmock('@sim/db/schema')

import { runSealAccountTokens } from '@/background/seal-account-tokens'

const ENCRYPTION_KEY = 'ab'.repeat(32)
const WORKER_KEY_ID = sealingKeyId(Buffer.from(ENCRYPTION_KEY, 'hex'))

/** A postgres.js client over an empty `account` table. */
function emptyAccountTable() {
  return Object.assign(async () => [], { end: vi.fn(async () => {}) })
}

describe('runSealAccountTokens', () => {
  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', ENCRYPTION_KEY)
    vi.stubEnv('ENCRYPT_ACCOUNT_TOKENS', 'true')
    databaseMockFns.mockResolveDbUrl.mockReturnValue('postgresql://fixture/sim')
    mockPostgres.mockReset()
    mockPostgres.mockImplementation(emptyAccountTable)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('refuses a real seal under a key id other than the worker’s, before connecting', async () => {
    await expect(
      runSealAccountTokens({ mode: 'seal', dryRun: false, expectedKeyId: 'deadbeef' })
    ).rejects.toThrow(`ENCRYPTION_KEY has key id ${WORKER_KEY_ID}, not the expected deadbeef`)
    expect(mockPostgres).not.toHaveBeenCalled()
  })

  it('refuses to seal while this worker writes plaintext tokens, before connecting', async () => {
    vi.stubEnv('ENCRYPT_ACCOUNT_TOKENS', 'false')

    await expect(
      runSealAccountTokens({ mode: 'seal', dryRun: false, expectedKeyId: WORKER_KEY_ID })
    ).rejects.toThrow('ENCRYPT_ACCOUNT_TOKENS is not enabled')
    expect(mockPostgres).not.toHaveBeenCalled()
  })

  it('still allows unsealing while writers store plaintext, which is the rollback', async () => {
    vi.stubEnv('ENCRYPT_ACCOUNT_TOKENS', 'false')

    await expect(
      runSealAccountTokens({ mode: 'unseal', dryRun: false, expectedKeyId: WORKER_KEY_ID })
    ).resolves.toEqual({ keyId: WORKER_KEY_ID, scanned: 0, pending: 0, updated: 0, foreignKey: 0 })
  })
})
