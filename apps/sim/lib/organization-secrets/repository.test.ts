import { organizationSecret, organizationSecretSource } from '@sim/db/schema'
import {
  dbChainMockFns,
  encryptionMock,
  encryptionMockFns,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

import { materializeSecrets, readSecrets, saveSecrets } from '@/lib/organization-secrets/repository'

const scope = { organizationId: 'org', userId: 'actor' }
beforeEach(() => {
  resetDbChainMock()
  encryptionMockFns.mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
    decrypted: encryptedValue.replace('cipher:', ''),
  }))
  encryptionMockFns.mockEncryptSecret.mockImplementation(async (value: string) => ({
    encrypted: `cipher:${value}`,
    iv: 'iv',
  }))
})
function source(mode = 'member') {
  queueTableRows(organizationSecretSource, [{ id: 'source', mode }])
}
function values() {
  queueTableRows(organizationSecret, [{ count: 1, bytes: 16 }])
  queueTableRows(organizationSecret, [{ name: 'TOKEN', encryptedValue: 'cipher:private' }])
}

describe('Generic Secrets storage and isolation', () => {
  it.each(['member', 'organization'] as const)(
    'reads the %s environment under its exact owner predicate',
    async (mode) => {
      source(mode)
      values()
      expect(await readSecrets(scope, { mode })).toEqual({
        source: { id: 'source', mode },
        variables: { TOKEN: 'private' },
      })
      expect(dbChainMockFns.where).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'eq',
          left: organizationSecretSource.organizationId,
          right: 'org',
        })
      )
      const predicate = {
        type: 'and',
        conditions: [
          { type: 'eq', left: organizationSecret.sourceId, right: 'source' },
          mode === 'member'
            ? { type: 'eq', left: organizationSecret.ownerUserId, right: 'actor' }
            : { type: 'isNull', column: organizationSecret.ownerUserId },
        ],
      }
      expect(dbChainMockFns.where).toHaveBeenCalledWith(
        expect.objectContaining({ conditions: expect.arrayContaining([predicate]) })
      )
    }
  )
  it('rejects a stale mode or replaced source before reading ciphertext', async () => {
    source('member')
    await expect(readSecrets(scope, { mode: 'organization' })).rejects.toMatchObject({
      code: 'conflict',
    })
    source('member')
    await expect(
      saveSecrets(scope, { mode: 'member', id: 'removed-source' }, { upsert: {}, remove: [] })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
  it('refuses partial mounts before decrypting any requested value', async () => {
    source()
    values()
    await expect(materializeSecrets(scope, ['TOKEN', 'MISSING'])).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })
  it('returns encrypted provenance alongside only the selected plaintext', async () => {
    source()
    values()
    expect(await materializeSecrets(scope, ['TOKEN'])).toEqual({
      envVars: { TOKEN: 'private' },
      catalogEntries: [{ name: 'TOKEN', plaintext: 'private', encryptedValue: 'cipher:private' }],
    })
  })
  it('bounds ciphertext before loading it', async () => {
    source()
    queueTableRows(organizationSecret, [{ count: 1, bytes: 2 * 1024 * 1024 }])
    await expect(materializeSecrets(scope, ['TOKEN'])).rejects.toMatchObject({ code: 'validation' })
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })
  it('atomically replaces changed keys with ciphertext in the actor scope', async () => {
    source()
    values()
    await saveSecrets(
      scope,
      { id: 'source', mode: 'member' },
      { upsert: { NEW: 'new-secret' }, remove: ['TOKEN'] }
    )
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.values).toHaveBeenCalledWith([
      expect.objectContaining({
        sourceId: 'source',
        ownerUserId: 'actor',
        name: 'NEW',
        encryptedValue: 'cipher:new-secret',
      }),
    ])
  })
})
