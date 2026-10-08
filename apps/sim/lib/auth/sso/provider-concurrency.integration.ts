import { createDeferred } from '@sim/testing/helpers/deferred'
import { generateId } from '@sim/utils/id'
import { beforeAll, describe, expect, it, vi } from 'vitest'

async function loadRuntime() {
  const [
    { db },
    schema,
    { eq, sql },
    { configuredSsoPlugin },
    providers,
    adapters,
    locks,
    ssoLocks,
  ] = await Promise.all([
    import('@sim/db'),
    import('@sim/db/schema'),
    import('drizzle-orm'),
    import('@/lib/auth/sso/plugin'),
    import('@/lib/auth/sso/provider-repository'),
    import('@/lib/auth/sim-auth-adapter'),
    import('@/lib/db/advisory-locks'),
    import('@/lib/auth/sso/provider-lock'),
  ])
  return {
    db,
    schema,
    eq,
    sql,
    configuredSsoPlugin,
    ...providers,
    ...adapters,
    ...locks,
    ...ssoLocks,
  }
}

describe('SSO account link concurrency', () => {
  let runtime: Awaited<ReturnType<typeof loadRuntime>>

  beforeAll(async () => {
    runtime = await loadRuntime()
  }, 60_000)

  it.each([false, true])(
    'allows a non-SSO account link while an SSO mutation lock is held with transactional adapter=%s',
    async (transactional) => {
      const { db, schema, eq, sql } = runtime
      const userId = generateId()
      const providerId = `social-${generateId()}`
      const held = createDeferred<number>()
      const release = createDeferred<void>()
      const pending: Promise<unknown>[] = []
      try {
        const now = new Date()
        await db.insert(schema.user).values({
          id: userId,
          name: 'Account concurrency',
          email: `${userId}@example.com`,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        })
        const gate = db.transaction(async (tx) => {
          await runtime.lockSsoProvider(tx, providerId)
          const [connection] = await tx.execute<{ pid: number }>(
            sql`SELECT pg_backend_pid() AS pid`
          )
          held.resolve(connection.pid)
          await release.promise
        })
        pending.push(gate)
        void gate.catch((error: unknown) => held.reject(error))
        const blockerPid = await held.promise
        const adapter = runtime.createSimAuthAdapter({})
        const accountInput = {
          model: 'account',
          forceAllowId: true,
          data: {
            id: generateId(),
            accountId: generateId(),
            userId,
            providerId,
            createdAt: now,
            updatedAt: now,
          },
        }
        let inserted = false
        const insertion = (
          transactional
            ? adapter.transaction((tx) => tx.create(accountInput))
            : adapter.create(accountInput)
        ).then((account) => {
          inserted = true
          return account
        })
        pending.push(insertion)
        void insertion.catch(() => undefined)
        const completedWithoutSsoLock = await vi.waitFor(
          async () => {
            const [waiting] = await db.execute<{ pid: number }>(sql`
              SELECT pid FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event = 'advisory'
                AND ${blockerPid}::int = ANY(pg_blocking_pids(pid))
            `)
            expect(inserted || Boolean(waiting)).toBe(true)
            return inserted
          },
          { timeout: 5_000, interval: 25 }
        )
        expect(completedWithoutSsoLock).toBe(true)
        const linked = await db
          .select({ userId: schema.account.userId })
          .from(schema.account)
          .where(eq(schema.account.providerId, providerId))
        expect(linked).toEqual([{ userId }])
      } finally {
        release.resolve()
        await Promise.allSettled(pending)
        await db.delete(schema.account).where(eq(schema.account.providerId, providerId))
        await db.delete(schema.user).where(eq(schema.user.id, userId))
      }
    },
    30_000
  )

  it.each([false, true])(
    'preserves the original identity with a transactional adapter=%s',
    async (transactional) => {
      const { db, schema, eq, sql } = runtime
      const userId = generateId()
      const organizationId = generateId()
      const providerId = `sso-${generateId()}`
      const issuer = 'https://original.example.com'
      const fixture = `sso_account_gate_${generateId().replaceAll('-', '')}`
      const gateKey = `sso-account-fixture:${providerId}`
      const held = createDeferred<number>()
      const release = createDeferred<void>()
      const pending: Promise<unknown>[] = []
      try {
        const now = new Date()
        await db.insert(schema.user).values({
          id: userId,
          name: 'SSO account concurrency',
          email: `${userId}@example.com`,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        })
        await db.insert(schema.organization).values({
          id: organizationId,
          name: 'SSO account concurrency',
          slug: organizationId,
          createdAt: now,
        })
        const repository = runtime.createSsoProviderRepository(
          userId,
          organizationId,
          runtime.configuredSsoPlugin,
          { reservedProviderIds: [] }
        )
        await repository.register({
          organizationId,
          providerId,
          issuer,
          domain: 'example.com',
          samlConfig: {
            entryPoint: 'https://original.example.com/sso',
            cert: 'fixture certificate',
            callbackUrl: 'https://app.example.com/api/auth/sso/saml2/callback',
            spMetadata: { metadata: '' },
            mapping: { id: 'sub', email: 'email', name: 'name' },
          },
        })
        await db.execute(sql`CREATE FUNCTION ${sql.identifier(fixture)}()
          RETURNS trigger LANGUAGE plpgsql AS $body$
          BEGIN
            PERFORM pg_advisory_xact_lock(hashtextextended(TG_ARGV[0], 0));
            RETURN NEW;
          END;
          $body$`)
        await db.execute(
          sql.raw(`CREATE TRIGGER "${fixture}" BEFORE INSERT ON account
            FOR EACH ROW WHEN (NEW.provider_id = '${providerId}')
            EXECUTE FUNCTION "${fixture}"('${gateKey}')`)
        )
        const gate = db.transaction(async (tx) => {
          await runtime.acquireAdvisoryXactLock(tx, 'sso_account_fixture', gateKey)
          const [connection] = await tx.execute<{ pid: number }>(
            sql`SELECT pg_backend_pid() AS pid`
          )
          held.resolve(connection.pid)
          await release.promise
        })
        pending.push(gate)
        void gate.catch((error: unknown) => held.reject(error))
        const blockerPid = await held.promise
        const adapter = runtime.createSimAuthAdapter({})
        const accountInput = {
          model: 'account',
          forceAllowId: true,
          data: {
            id: generateId(),
            accountId: generateId(),
            userId,
            providerId,
            createdAt: now,
            updatedAt: now,
          },
        }
        const insertion = transactional
          ? adapter.transaction((tx) => tx.create(accountInput))
          : adapter.create(accountInput)
        pending.push(insertion)
        void insertion.catch(() => undefined)
        const accountPid = await vi.waitFor(
          async () => {
            const [waiting] = await db.execute<{ pid: number }>(sql`
              SELECT pid FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event = 'advisory'
                AND ${blockerPid}::int = ANY(pg_blocking_pids(pid))
            `)
            expect(waiting).toBeDefined()
            return waiting.pid
          },
          { timeout: 5_000, interval: 25 }
        )
        let updateSettled = false
        const update = repository
          .update({ providerId, issuer: 'https://changed.example.com' })
          .then(
            (value) => {
              updateSettled = true
              return { status: 'fulfilled' as const, value }
            },
            (reason: unknown) => {
              updateSettled = true
              return { status: 'rejected' as const, reason }
            }
          )
        pending.push(update)
        const waitedForAccount = await vi.waitFor(
          async () => {
            const [waiting] = await db.execute<{ pid: number }>(sql`
              SELECT pid FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event = 'advisory'
                AND ${accountPid}::int = ANY(pg_blocking_pids(pid))
            `)
            expect(Boolean(waiting) || updateSettled).toBe(true)
            return Boolean(waiting)
          },
          { timeout: 5_000, interval: 25 }
        )
        release.resolve()
        await gate
        await insertion
        expect(await update).toMatchObject({ status: 'rejected', reason: { statusCode: 409 } })
        expect(waitedForAccount).toBe(true)
        const [provider] = await db
          .select({ issuer: schema.ssoProvider.issuer })
          .from(schema.ssoProvider)
          .where(eq(schema.ssoProvider.providerId, providerId))
        expect(provider.issuer).toBe(issuer)
        const linked = await db
          .select({ userId: schema.account.userId })
          .from(schema.account)
          .where(eq(schema.account.providerId, providerId))
        expect(linked).toEqual([{ userId }])
      } finally {
        release.resolve()
        await Promise.allSettled(pending)
        await db.execute(sql`DROP TRIGGER IF EXISTS ${sql.identifier(fixture)} ON account`)
        await db.execute(sql`DROP FUNCTION IF EXISTS ${sql.identifier(fixture)}()`)
        await db.delete(schema.account).where(eq(schema.account.providerId, providerId))
        await db.delete(schema.organization).where(eq(schema.organization.id, organizationId))
        await db.delete(schema.user).where(eq(schema.user.id, userId))
      }
    },
    30_000
  )
})
