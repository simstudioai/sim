import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  authenticatePiSearchCapability,
  cleanupExpiredPiSearchCapabilities,
  createPiSearchCapability,
  releasePiSearchCall,
  reservePiSearchCall,
  revokePiSearchCapability,
  settlePiSearchCall,
} from '@/lib/pi/exa-search/capabilities'

const databaseUrl = process.env.DATABASE_URL
const sql = databaseUrl ? postgres(databaseUrl, { max: 1 }) : null
const suffix = Date.now().toString(36)
const userId = `pi-search-user-${suffix}`
const workspaceId = `pi-search-workspace-${suffix}`

describe.skipIf(!databaseUrl)('Pi search capability PostgreSQL fencing', () => {
  beforeAll(async () => {
    await sql!`
      INSERT INTO "user" (
        id, name, email, normalized_email, email_verified, created_at, updated_at
      ) VALUES (
        ${userId}, 'Pi Search Test', ${`${userId}@example.com`},
        ${`${userId}@example.com`}, true, now(), now()
      )
    `
    await sql!`
      INSERT INTO workspace (id, name, owner_id, billed_account_user_id)
      VALUES (${workspaceId}, 'Pi Search Test', ${userId}, ${userId})
    `
  })

  afterAll(async () => {
    await sql!`DELETE FROM workspace WHERE id = ${workspaceId}`
    await sql!`DELETE FROM "user" WHERE id = ${userId}`
    await sql!.end()
  })

  it('allows only one concurrent lease and fences release by token', async () => {
    const created = await createPiSearchCapability({
      workspaceId,
      providerKeyId: `exa-key-${suffix}`,
      executionId: `execution-${suffix}`,
      protectedSecrets: ['model-secret', 'github-secret'],
    })
    const capability = await authenticatePiSearchCapability(created.token)
    expect(capability).not.toBeNull()

    const leases = await Promise.all([
      reservePiSearchCall(capability!),
      reservePiSearchCall(capability!),
    ])
    const acquired = leases.filter((lease) => lease !== null)
    expect(acquired).toHaveLength(1)

    const lease = acquired[0]!
    expect(await releasePiSearchCall({ ...lease, token: 'wrong-token' })).toBe(false)
    expect(await reservePiSearchCall(capability!)).toBeNull()
    expect(await releasePiSearchCall(lease)).toBe(true)
    const settledLease = await reservePiSearchCall(capability!)
    expect(settledLease).not.toBeNull()
    expect(await settlePiSearchCall(settledLease!, 123)).toBe(true)
    const [accounting] = await sql!`
      SELECT settled_output_bytes, reserved_output_bytes
      FROM pi_search_capabilities
      WHERE id = ${created.id}
    `
    expect(Number(accounting.settled_output_bytes)).toBe(123)
    expect(Number(accounting.reserved_output_bytes)).toBe(0)

    await revokePiSearchCapability(created.id)
  })

  it('fences a stale lease takeover and cleans retained rows', async () => {
    const created = await createPiSearchCapability({
      workspaceId,
      providerKeyId: `exa-key-${suffix}`,
      executionId: `stale-execution-${suffix}`,
      protectedSecrets: ['secret'],
    })
    const capability = await authenticatePiSearchCapability(created.token)
    const stale = await reservePiSearchCall(capability!)
    expect(stale).not.toBeNull()
    await sql!`
      UPDATE pi_search_capabilities
      SET lease_expires_at = NOW() - INTERVAL '1 minute'
      WHERE id = ${created.id}
    `
    expect(await settlePiSearchCall(stale!, 10)).toBe(false)
    const replacement = await reservePiSearchCall(capability!)
    expect(replacement).not.toBeNull()
    expect(replacement!.generation).toBeGreaterThan(stale!.generation)
    expect(await releasePiSearchCall(stale!)).toBe(false)
    expect(await releasePiSearchCall(replacement!)).toBe(true)

    await revokePiSearchCapability(created.id)
    await sql!`
      UPDATE pi_search_capabilities
      SET expires_at = NOW() - INTERVAL '2 days',
          revoked_at = NOW() - INTERVAL '2 days'
      WHERE id = ${created.id}
    `
    expect(
      await cleanupExpiredPiSearchCapabilities({
        batchSize: 10,
        retentionBefore: new Date(Date.now() - 24 * 60 * 60 * 1000),
      })
    ).toBeGreaterThanOrEqual(1)
    expect(await authenticatePiSearchCapability(created.token)).toBeNull()
  })
})
