import { Resolver } from 'node:dns/promises'
import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { envFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)

async function loadRuntime() {
  const [{ db }, schema, { eq, sql }, domains, membership, locks, primary] = await Promise.all([
    import('@sim/db'),
    import('@sim/db/schema'),
    import('drizzle-orm'),
    import('@/lib/organizations/application/domain-settings'),
    import('@/lib/billing/organizations/membership'),
    import('@/lib/db/advisory-locks'),
    import('@sim/db/sso-primary-provider'),
  ])
  return { db, schema, eq, sql, ...domains, ...membership, ...locks, ...primary }
}

describe('Organization domain mutation concurrency in PostgreSQL', () => {
  let runtime: Awaited<ReturnType<typeof loadRuntime>>
  let organizationId: string
  let userId: string
  let domainId: string
  let providerId: string
  let principal: ReturnType<typeof createPersonalApiKeyPrincipal>

  beforeAll(async () => {
    setEnvFlags({ isHosted: true, isBillingEnabled: false, isOrganizationsEnabled: true })
    runtime = await loadRuntime()
  }, 60_000)

  beforeEach(async () => {
    const { db, schema } = runtime
    organizationId = generateId()
    userId = generateId()
    domainId = generateId()
    providerId = generateId()
    principal = createPersonalApiKeyPrincipal({ userId })
    const now = new Date()
    await db.insert(schema.user).values({
      id: userId,
      name: 'Domain concurrency',
      email: `${userId}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(schema.organization).values({
      id: organizationId,
      name: 'Domain concurrency',
      slug: organizationId,
      createdAt: now,
    })
    await db
      .insert(schema.member)
      .values({ id: generateId(), organizationId, userId, role: 'owner' })
    await db.insert(schema.ssoDomain).values({
      id: domainId,
      organizationId,
      domain: `${organizationId}.test`,
      status: 'verified',
      verificationToken: generateId(),
      verifiedAt: now,
      primaryProviderId: providerId,
    })
    await db.insert(schema.ssoProvider).values({
      id: generateId(),
      providerId,
      organizationId,
      userId,
      issuer: 'https://idp.example.com',
      domain: `${organizationId}.test`,
      domainVerified: true,
    })
  })

  afterEach(async () => {
    const { db, schema, eq } = runtime
    await db.delete(schema.organization).where(eq(schema.organization.id, organizationId))
    await db.delete(schema.user).where(eq(schema.user.id, userId))
  })

  it('allows provider deletion to commit while domain removal waits for organization mutation', async () => {
    const { db, schema, eq, sql } = runtime
    const held = createDeferred<number>()
    const release = createDeferred<void>()
    const pending: Promise<unknown>[] = []
    try {
      const deletion = db.transaction(async (tx) => {
        await runtime.acquireOrganizationMutationLock(tx, organizationId)
        await tx.delete(schema.ssoProvider).where(eq(schema.ssoProvider.providerId, providerId))
        const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        held.resolve(connection.pid)
        await release.promise
        await tx
          .select({ id: schema.ssoDomain.id })
          .from(schema.ssoDomain)
          .where(eq(schema.ssoDomain.id, domainId))
          .for('update', { noWait: true })
        await runtime.forgetPrimaryProvider(tx, organizationId, providerId)
      })
      pending.push(deletion)
      void deletion.catch((error: unknown) => held.reject(error))
      const blockerPid = await held.promise
      const removal = runtime.removeOrganizationDomain.execute({
        principal,
        input: { organizationId, domainId },
      })
      pending.push(removal)
      void removal.catch(() => undefined)
      await vi.waitFor(
        async () => {
          const [waiting] = await db.execute<{ pid: number }>(sql`
            SELECT pid FROM pg_stat_activity
            WHERE datname = current_database()
              AND ${blockerPid}::int = ANY(pg_blocking_pids(pid))
          `)
          expect(waiting).toBeDefined()
        },
        { timeout: 5_000, interval: 25 }
      )
      release.resolve()
      await deletion
      await expect(removal).resolves.toEqual({ domain: `${organizationId}.test` })
      expect(
        await db.select().from(schema.ssoDomain).where(eq(schema.ssoDomain.id, domainId))
      ).toEqual([])
      expect(
        await db
          .select()
          .from(schema.ssoProvider)
          .where(eq(schema.ssoProvider.providerId, providerId))
      ).toEqual([])
    } finally {
      release.resolve()
      await Promise.allSettled(pending)
    }
  })

  it('admits only one concurrent distinct claim at the organization domain cap', async () => {
    const { db, schema, eq, sql } = runtime
    await db.insert(schema.ssoDomain).values(
      Array.from({ length: 23 }, (_, index) => ({
        id: generateId(),
        organizationId,
        domain: `existing-${index}-${organizationId}.test`,
        status: 'pending',
        verificationToken: generateId(),
      }))
    )
    const fixture = `domain_cap_gate_${generateId().replaceAll('-', '')}`
    const gateKey = `domain-cap-fixture:${organizationId}`
    const held = createDeferred<number>()
    const release = createDeferred<void>()
    const pending: Promise<unknown>[] = []
    try {
      await db.execute(sql`CREATE FUNCTION ${sql.identifier(fixture)}()
        RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN
          PERFORM pg_advisory_xact_lock(hashtextextended(TG_ARGV[0], 0));
          RETURN NEW;
        END;
        $body$`)
      await db.execute(
        sql.raw(`CREATE TRIGGER "${fixture}" BEFORE INSERT ON sso_domain
          FOR EACH ROW WHEN (NEW.organization_id = '${organizationId}')
          EXECUTE FUNCTION "${fixture}"('${gateKey}')`)
      )
      const gate = db.transaction(async (tx) => {
        await runtime.acquireAdvisoryXactLock(tx, 'domain_cap_fixture', gateKey)
        const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        held.resolve(connection.pid)
        await release.promise
      })
      pending.push(gate)
      void gate.catch((error: unknown) => held.reject(error))
      const blockerPid = await held.promise
      const claims = [0, 1].map((index) =>
        runtime.addOrganizationDomain
          .execute({
            principal,
            input: { organizationId, domain: `new-${index}-${organizationId}.test` },
          })
          .then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (reason: unknown) => ({ status: 'rejected' as const, reason })
          )
      )
      pending.push(...claims)
      await vi.waitFor(
        async () => {
          const waiting = await db.execute<{ pid: number }>(sql`
            WITH RECURSIVE blocked(pid) AS (
              SELECT pid FROM pg_stat_activity
              WHERE datname = current_database()
                AND ${blockerPid}::int = ANY(pg_blocking_pids(pid))
              UNION
              SELECT activity.pid FROM pg_stat_activity AS activity
              JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
              WHERE activity.datname = current_database()
            ) SELECT pid FROM blocked
          `)
          expect(waiting).toHaveLength(2)
        },
        { timeout: 5_000, interval: 25 }
      )
      release.resolve()
      await gate
      const outcomes = await Promise.all(claims)
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toMatchObject([
        { reason: { code: 'validation' } },
      ])
      expect(
        await db
          .select()
          .from(schema.ssoDomain)
          .where(eq(schema.ssoDomain.organizationId, organizationId))
      ).toHaveLength(25)
      await expect(
        runtime.addOrganizationDomain.execute({
          principal,
          input: { organizationId, domain: `${organizationId}.test` },
        })
      ).resolves.toMatchObject({ created: false, domain: { id: domainId } })
    } finally {
      release.resolve()
      await Promise.allSettled(pending)
      await db.execute(sql`DROP TRIGGER IF EXISTS ${sql.identifier(fixture)} ON sso_domain`)
      await db.execute(sql`DROP FUNCTION IF EXISTS ${sql.identifier(fixture)}()`)
    }
  })

  it('refuses verification when administrator membership changes during DNS lookup', async () => {
    const { db, schema, eq } = runtime
    await db
      .update(schema.ssoDomain)
      .set({ status: 'pending', verifiedAt: null })
      .where(eq(schema.ssoDomain.id, domainId))
    await db
      .update(schema.ssoProvider)
      .set({ domainVerified: false })
      .where(eq(schema.ssoProvider.providerId, providerId))
    const dns = vi.spyOn(Resolver.prototype, 'resolveTxt').mockImplementation(async () => {
      await db
        .update(schema.member)
        .set({ role: 'member' })
        .where(eq(schema.member.organizationId, organizationId))
      const [claim] = await db
        .select()
        .from(schema.ssoDomain)
        .where(eq(schema.ssoDomain.id, domainId))
      return [[`sim-domain-verification=${claim.verificationToken}`]]
    })
    try {
      await expect(
        runtime.verifyOrganizationDomain.execute({
          principal,
          input: { organizationId, domainId },
        })
      ).rejects.toMatchObject({ detailCode: 'ORGANIZATION_ADMIN_REQUIRED' })
      const [claim] = await db
        .select()
        .from(schema.ssoDomain)
        .where(eq(schema.ssoDomain.id, domainId))
      const [provider] = await db
        .select()
        .from(schema.ssoProvider)
        .where(eq(schema.ssoProvider.providerId, providerId))
      expect(claim.status).toBe('pending')
      expect(provider.domainVerified).toBe(false)
    } finally {
      dns.mockRestore()
    }
  })
})
