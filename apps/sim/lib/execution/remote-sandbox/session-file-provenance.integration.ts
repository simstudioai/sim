import { createHash } from 'node:crypto'
import { generateShortId } from '@sim/utils/id'
import { afterAll, describe, expect, it, vi } from 'vitest'

const { redisUrl } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const redisUrl = readTestRedisUrl()
  if (redisUrl) process.env.REDIS_URL = redisUrl
  return { redisUrl }
})

import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  PROVENANCE_MAX_ENTRIES,
  PROVENANCE_MAX_SERIALIZED_BYTES,
} from '@/lib/execution/provenance-limits'
import {
  initializeSessionFileProvenance,
  isSessionFileProvenanceClean,
  readSessionSecretProvenance,
  recordSessionFileInput,
} from '@/lib/execution/remote-sandbox/session-file-provenance'

const keys: string[] = []
function fixture() {
  const session = `history-${generateShortId(16)}`
  const machine = { providerId: 'e2b' as const, sandboxId: generateShortId(16) }
  const key = `mothership:workbench-provenance:v2:${createHash('sha256')
    .update(JSON.stringify([session, machine.providerId, machine.sandboxId]))
    .digest('hex')}`
  keys.push(key)
  return { session, machine, key }
}
afterAll(async () => {
  if (keys.length) await getRedisClient()?.del(...keys)
  await closeRedisConnection()
})

describe.skipIf(!redisUrl)('physical workbench history with real Redis', () => {
  it('atomically retains distinct encrypted inputs under concurrent calls and retries', async () => {
    const { session, machine } = fixture()
    await initializeSessionFileProvenance(session, machine)
    const entries = await Promise.all(
      Array.from({ length: 32 }, async (_, index) => ({
        name: `TOKEN_${index}`,
        encryptedValue: (await encryptSecret(`synthetic-token-value-${index}`)).encrypted,
      }))
    )
    await Promise.all(
      entries.map((entry) =>
        recordSessionFileInput(session, machine, { status: 'exact', entries: [entry] })
      )
    )
    await recordSessionFileInput(session, machine, { status: 'exact', entries })
    await recordSessionFileInput(session, machine, true)
    await initializeSessionFileProvenance(session, machine)
    const history = await readSessionSecretProvenance(session, machine)
    expect(history.status).toBe('exact')
    if (history.status !== 'exact') throw new Error('Expected exact history')
    expect(history.entries).toHaveLength(32)
    expect(JSON.stringify(history)).not.toContain('synthetic-token-value-')
    expect(await isSessionFileProvenanceClean(session, machine)).toBe(false)
  })
  it('keeps unknown permanent and never initializes recovered or expired history from current inputs', async () => {
    const { session, machine, key } = fixture()
    await recordSessionFileInput(session, machine, true)
    await initializeSessionFileProvenance(session, machine)
    expect(await readSessionSecretProvenance(session, machine)).toEqual({ status: 'unknown' })
    await getRedisClient()!.del(key)
    await recordSessionFileInput(session, machine, true)
    expect(await readSessionSecretProvenance(session, machine)).toEqual({ status: 'unknown' })
  })
  it('does not trust legacy history or another chat or physical machine', async () => {
    const { session, machine, key } = fixture()
    const legacy = key.replace(':v2:', ':v1:')
    keys.push(legacy)
    await getRedisClient()!.set(legacy, 'clean')
    expect(await isSessionFileProvenanceClean(session, machine)).toBe(false)
    await initializeSessionFileProvenance(session, machine)
    expect(await isSessionFileProvenanceClean(session, machine)).toBe(true)
    expect(await isSessionFileProvenanceClean(`${session}-other`, machine)).toBe(false)
    expect(
      await isSessionFileProvenanceClean(session, { ...machine, sandboxId: 'replacement' })
    ).toBe(false)
  })
  it.each(['{"status":"exact","entries":{}}', '{"status":"exact","entries":[{}]}', 'not-json'])(
    'fails closed on malformed stored history %s',
    async (value) => {
      const { session, machine, key } = fixture()
      await getRedisClient()!.set(key, value)
      await recordSessionFileInput(session, machine, true)
      expect(await readSessionSecretProvenance(session, machine)).toEqual({ status: 'unknown' })
    }
  )
  it('folds many source bindings into one machine secret without spending the distinct-secret budget', async () => {
    const { session, machine } = fixture()
    await initializeSessionFileProvenance(session, machine)
    const entries = Array.from({ length: PROVENANCE_MAX_ENTRIES + 1 }, (_, index) => ({
      encryptedValue: 'one-encrypted-secret',
      sourceValueHash: `source-${index}`,
    }))
    await recordSessionFileInput(session, machine, { status: 'exact', entries })
    expect(await readSessionSecretProvenance(session, machine)).toEqual({
      status: 'exact',
      entries: [{ encryptedValue: 'one-encrypted-secret' }],
    })
  })
  it('makes cumulative entry overflow permanently unknown', async () => {
    const { session, machine } = fixture()
    await initializeSessionFileProvenance(session, machine)
    const entries = Array.from({ length: PROVENANCE_MAX_ENTRIES }, (_, index) => ({
      encryptedValue: `bounded-ciphertext-${index}`,
    }))
    await recordSessionFileInput(session, machine, { status: 'exact', entries })
    expect((await readSessionSecretProvenance(session, machine)).status).toBe('exact')
    await recordSessionFileInput(session, machine, {
      status: 'exact',
      entries: [{ encryptedValue: 'additional-distinct-ciphertext' }],
    })
    await recordSessionFileInput(session, machine, true)
    expect(await readSessionSecretProvenance(session, machine)).toEqual({ status: 'unknown' })
  })
  it('makes cumulative byte overflow permanently unknown even when each receipt fits', async () => {
    const { session, machine } = fixture()
    await initializeSessionFileProvenance(session, machine)
    const halfBudget = PROVENANCE_MAX_SERIALIZED_BYTES / 2
    await recordSessionFileInput(session, machine, {
      status: 'exact',
      entries: [{ encryptedValue: 'a'.repeat(halfBudget) }],
    })
    expect((await readSessionSecretProvenance(session, machine)).status).toBe('exact')
    await recordSessionFileInput(session, machine, {
      status: 'exact',
      entries: [{ encryptedValue: 'b'.repeat(halfBudget) }],
    })
    await recordSessionFileInput(session, machine, true)
    expect(await readSessionSecretProvenance(session, machine)).toEqual({ status: 'unknown' })
  })
  it('withholds classification when an encrypted history exceeds its byte budget', async () => {
    const { session, machine } = fixture()
    await initializeSessionFileProvenance(session, machine)
    await recordSessionFileInput(session, machine, {
      status: 'exact',
      entries: [{ encryptedValue: 'x'.repeat(PROVENANCE_MAX_SERIALIZED_BYTES) }],
    })
    await recordSessionFileInput(session, machine, true)
    expect(await readSessionSecretProvenance(session, machine)).toEqual({ status: 'unknown' })
  })
})
