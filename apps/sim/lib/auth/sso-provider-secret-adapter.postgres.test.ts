/**
 * @vitest-environment node
 */
import { sso } from '@better-auth/sso'
import * as schema from '@sim/db/schema'
import { withUtcTimestamps } from '@sim/db/timestamps'
import { resetEnvMock, setEnv } from '@sim/testing'
import { generateId } from '@sim/utils/id'
import type { BetterAuthOptions } from 'better-auth'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createSimAuthAdapter } from '@/lib/auth/sim-auth-adapter'

vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')

/** The guard suites cover authorization; this exercises the secret encoding against the real table. */
vi.mock('@/lib/auth/oauth-provider-adapter-guard', () => ({
  guardOAuthProviderWrites: (adapter: object) => adapter,
}))
vi.mock('@/lib/auth/stripe-adapter-guard', () => ({
  guardSubscriptionPlanWrites: (adapter: object) => adapter,
}))

const OPTIONS: BetterAuthOptions = { plugins: [sso()] }
const databaseUrl = process.env.OAUTH_TOKEN_FAMILY_TEST_DATABASE_URL

const CLIENT_SECRET = 'super-secret-value'
const oidcConfig = (clientSecret: string) =>
  JSON.stringify({ clientId: 'client', clientSecret, pkce: true })

describe.skipIf(!databaseUrl)('SSO provider secrets in PostgreSQL', () => {
  const client = postgres(
    databaseUrl ?? '',
    withUtcTimestamps({ max: 1, prepare: false, fetch_types: false })
  )
  const database = drizzle(client, { schema })
  const adapter = createSimAuthAdapter(OPTIONS, database)
  const userId = generateId()

  beforeAll(async () => {
    /** The shared env mock's ENCRYPTION_KEY is not usable AES material. */
    setEnv({ ENCRYPTION_KEY: '0'.repeat(64) })
    await database.insert(schema.user).values({
      id: userId,
      name: 'SSO Secret Owner',
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  })

  afterAll(async () => {
    await client`DELETE FROM sso_provider WHERE user_id = ${userId}`
    await client`DELETE FROM "user" WHERE id = ${userId}`
    await client.end()
    resetEnvMock()
  })

  async function storedConfig(providerId: string): Promise<string> {
    const [row] = await client<{ oidc_config: string }[]>`
      SELECT oidc_config FROM sso_provider WHERE provider_id = ${providerId}
    `
    return row.oidc_config
  }

  /** Cleanup is by `user_id`, so each case just needs a distinct provider id. */
  function register(): string {
    return `acme-${generateId()}`
  }

  it('writes the client secret encrypted and reads it back usable', async () => {
    const providerId = register()

    await adapter.create({
      model: 'ssoProvider',
      data: {
        id: generateId(),
        providerId,
        issuer: 'https://idp.example.test',
        domain: 'example.test',
        userId,
        oidcConfig: oidcConfig(CLIENT_SECRET),
      },
      forceAllowId: true,
    })

    const atRest = JSON.parse(await storedConfig(providerId))
    expect(atRest.clientSecret).not.toBe(CLIENT_SECRET)
    expect(atRest.clientSecret).toMatch(/^sim\.sso\.v1:[0-9a-f]{32}:[0-9a-f]+:[0-9a-f]{32}$/)
    expect(atRest.clientId).toBe('client')

    const loaded = await adapter.findOne<{ oidcConfig: string }>({
      model: 'ssoProvider',
      where: [{ field: 'providerId', value: providerId }],
    })
    expect(JSON.parse(loaded!.oidcConfig).clientSecret).toBe(CLIENT_SECRET)
  })

  it('re-encrypts on update without double-wrapping the value it read', async () => {
    const providerId = register()
    await adapter.create({
      model: 'ssoProvider',
      data: {
        id: generateId(),
        providerId,
        issuer: 'https://idp.example.test',
        domain: 'example.test',
        userId,
        oidcConfig: oidcConfig(CLIENT_SECRET),
      },
      forceAllowId: true,
    })

    /** What Better Auth's own update merge does: read the row, write it back. */
    const current = await adapter.findOne<{ oidcConfig: string }>({
      model: 'ssoProvider',
      where: [{ field: 'providerId', value: providerId }],
    })
    const updated = await adapter.update<{ oidcConfig: string }>({
      model: 'ssoProvider',
      where: [{ field: 'providerId', value: providerId }],
      update: { oidcConfig: current!.oidcConfig },
    })

    expect(JSON.parse(updated!.oidcConfig).clientSecret).toBe(CLIENT_SECRET)
    const atRest = JSON.parse(await storedConfig(providerId))
    expect(atRest.clientSecret).toMatch(/^sim\.sso\.v1:[0-9a-f]{32}:[0-9a-f]+:[0-9a-f]{32}$/)
  })

  it('reads a row written before the secret was encrypted', async () => {
    const providerId = register()
    await client`
      INSERT INTO sso_provider (id, issuer, domain, oidc_config, user_id, provider_id)
      VALUES (${generateId()}, 'https://idp.example.test', 'example.test',
              ${oidcConfig(CLIENT_SECRET)}, ${userId}, ${providerId})
    `

    const loaded = await adapter.findOne<{ oidcConfig: string }>({
      model: 'ssoProvider',
      where: [{ field: 'providerId', value: providerId }],
    })

    expect(JSON.parse(loaded!.oidcConfig).clientSecret).toBe(CLIENT_SECRET)
  })
})
