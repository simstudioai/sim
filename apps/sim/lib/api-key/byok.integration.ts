import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { classifyDatabaseFailure } from '@sim/utils/errors'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  schema: `byok_resolution_${process.pid}`,
  client: null as Sql | null,
}))

vi.mock('@sim/db', async () => {
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const { default: postgres } = await import('postgres')
  const { readTestDatabaseUrl } = await import('@sim/db/testing/test-infrastructure')
  fixture.client = postgres(readTestDatabaseUrl(), {
    max: 1,
    prepare: false,
    connection: { search_path: fixture.schema },
  })
  return { db: drizzle(fixture.client) }
})
vi.mock('@/lib/core/config/env-flags', () => ({ isHosted: true }))
vi.mock('@/providers/models', () => ({ getHostedModels: () => ['gpt-4.1-mini'] }))
vi.mock('@/providers/utils', () => ({ PROVIDER_PLACEHOLDER_KEY: 'fixture-placeholder' }))
vi.mock('@/lib/api-key/byok-entitlement', () => ({
  isOrganizationBYOKEntitledCached: async () => true,
}))

import { getApiKeyWithBYOK } from '@/lib/api-key/byok'
import { env } from '@/lib/core/config/env'
import { encryptSecret } from '@/lib/core/security/encryption'

/** Real PostgreSQL socket loss and ciphertext; only model availability and entitlement are fixtures. */
describe('BYOK resolution across database failures', () => {
  const admin = postgres(readTestDatabaseUrl(), {
    max: 1,
    connection: { search_path: fixture.schema },
    onnotice: () => {},
  })
  const priorPlatformKey = env.OPENAI_API_KEY
  let encryptedKey = ''

  beforeAll(async () => {
    Object.assign(env, { OPENAI_API_KEY: 'platform-fixture-key' })
    encryptedKey = (await encryptSecret('customer-fixture-key')).encrypted
    await admin`CREATE SCHEMA ${admin(fixture.schema)}`
    await admin.unsafe(`
      CREATE SEQUENCE lookup_attempt;
      CREATE TABLE failure_policy (failures integer, code text);
      CREATE TABLE stored_keys (
        id text, workspace_id text, provider_id text, encrypted_api_key text, created_at timestamp
      );
      CREATE TABLE workspace (id text, organization_id text);
      CREATE TABLE organization_byok_keys (
        id text, organization_id text, provider_id text, encrypted_api_key text, created_at timestamp
      );
      CREATE FUNCTION guard_lookup() RETURNS boolean LANGUAGE plpgsql AS $$
      DECLARE policy failure_policy; attempt bigint;
      BEGIN
        SELECT * INTO policy FROM failure_policy;
        attempt := nextval('lookup_attempt');
        IF attempt <= policy.failures THEN
          IF policy.code = '57P01' THEN
            PERFORM pg_terminate_backend(pg_backend_pid());
          ELSE
            RAISE EXCEPTION 'synthetic lookup failure' USING ERRCODE = policy.code;
          END IF;
        END IF;
        RETURN true;
      END $$;
      CREATE VIEW workspace_byok_keys AS SELECT * FROM stored_keys WHERE guard_lookup();
    `)
  })

  beforeEach(async () => {
    await admin`TRUNCATE stored_keys, failure_policy`
    await admin`ALTER SEQUENCE lookup_attempt RESTART WITH 1`
    await admin`INSERT INTO failure_policy VALUES (0, '57P01')`
    await admin`INSERT INTO stored_keys VALUES ('fixture-key', 'fixture-workspace', 'openai', ${encryptedKey}, now())`
  })

  afterAll(async () => {
    Object.assign(env, { OPENAI_API_KEY: priorPlatformKey })
    await fixture.client?.end({ timeout: 1 })
    await admin`DROP SCHEMA IF EXISTS ${admin(fixture.schema)} CASCADE`
    await admin.end()
  })

  const resolve = () => getApiKeyWithBYOK('openai', 'gpt-4.1-mini', 'fixture-workspace')
  async function attempts() {
    const [row] = await admin`SELECT last_value FROM lookup_attempt`
    return Number(row.last_value)
  }

  it('reconnects after a lost lookup connection and keeps the customer credential', async () => {
    await admin`UPDATE failure_policy SET failures = 1`
    await expect(resolve()).resolves.toEqual({
      apiKey: 'customer-fixture-key',
      isBYOK: true,
      scope: 'workspace',
    })
    expect(await attempts()).toBe(2)
  })

  it('rejects persistent connection failures after bounded attempts without selecting a platform key', async () => {
    await admin`UPDATE failure_policy SET failures = 100, code = '08006'`
    let failure: unknown
    try {
      await resolve()
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect(classifyDatabaseFailure(failure)).toBe('connection')
    expect(failure instanceof Error && failure.message).not.toContain('select')
    expect(await attempts()).toBe(3)
  })

  it('rejects a permanent query error without retrying or selecting a platform key', async () => {
    await admin`UPDATE failure_policy SET failures = 100, code = '42P01'`
    await expect(resolve()).rejects.toThrow()
    expect(await attempts()).toBe(1)
  })

  it('rejects an undecryptable configured pool instead of changing credential ownership', async () => {
    await admin`UPDATE stored_keys SET encrypted_api_key = 'invalid-ciphertext'`
    await expect(resolve()).rejects.toThrow('Configured BYOK credentials are unavailable')
    expect(await attempts()).toBe(1)
  })

  it('permits a platform credential after successfully confirming customer keys are absent', async () => {
    await admin`TRUNCATE stored_keys`
    await expect(resolve()).resolves.toEqual({ apiKey: 'platform-fixture-key', isBYOK: false })
  })
})
