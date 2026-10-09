import { once } from 'node:events'
import { createServer } from 'node:http'
import type { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { generateId } from '@sim/utils/id'
import { drizzle } from 'drizzle-orm/postgres-js'
import { NextRequest } from 'next/server'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { primary } = vi.hoisted(() => {
  process.env.BILLING_ENABLED = 'true'
  process.env.NEXT_PUBLIC_FORCE_HOSTED = 'true'
  process.env.ACCESS_CONTROL_ENABLED = 'false'
  return { primary: { select: vi.fn(), execute: vi.fn(), transaction: vi.fn() } }
})
vi.mock('@sim/db', () => ({ db: primary, dbReplica: {} }))
vi.mock('@/lib/auth', () => authMock)

import { getOrganizationPlanSeats } from '@/lib/billing/application/organization-billing/get-organization-plan-seats'
import { GET } from '@/app/api/organizations/[id]/billing-plan/route'

const schemaName = `plan_seats_${generateId().replaceAll('-', '')}`
const connection = postgres(readTestDatabaseUrl(), {
  max: 4,
  prepare: false,
  connection: { search_path: schemaName },
  onnotice: () => undefined,
})
const database = drizzle(connection, { schema }) as typeof db
const principal = { kind: 'session', userId: 'owner', sessionId: 'fixture-session' } as const
const read = (organizationId = 'org-a') =>
  getOrganizationPlanSeats.execute({ principal, input: { organizationId } })
let apiUrl = ''
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', apiUrl)
    const result = await GET(new NextRequest(url, { method: request.method }), {
      params: Promise.resolve({ id: url.pathname.split('/')[3] }),
    })
    response.writeHead(result.status, Object.fromEntries(result.headers))
    response.end(await result.text())
  } catch {
    response.writeHead(500).end()
  }
})

beforeAll(async () => {
  await connection.unsafe(`CREATE SCHEMA "${schemaName}"`)
  for (const table of [
    'organization',
    'member',
    'subscription',
    'user',
    'user_stats',
    'invitation',
    'outbox_event',
  ]) {
    await connection.unsafe(
      `CREATE TABLE "${schemaName}"."${table}" (LIKE public."${table}" INCLUDING ALL)`
    )
  }
  primary.select.mockImplementation((fields) => database.select(fields))
  primary.execute.mockImplementation((query) => database.execute(query))
  primary.transaction.mockImplementation((callback, options) =>
    database.transaction(callback, options)
  )
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('API fixture did not bind')
  apiUrl = `http://127.0.0.1:${address.port}`
})

beforeEach(async () => {
  authMockFns.mockGetSession.mockResolvedValue({
    user: { id: principal.userId },
    session: { id: principal.sessionId },
  })
  await connection`TRUNCATE member, subscription, "user", user_stats, invitation, outbox_event, organization`
  await connection`INSERT INTO organization (id, name, slug, created_at) VALUES ('org-a', 'Fixture A', 'fixture-a', now()), ('org-b', 'Fixture B', 'fixture-b', now())`
  await connection`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('owner', 'Owner', 'owner@example.test', false, now(), now()), ('member', 'Member', 'member@example.test', false, now(), now()), ('foreign', 'Foreign', 'foreign@example.test', false, now(), now())`
  await connection`INSERT INTO member (id, user_id, organization_id, role) VALUES ('owner-a', 'owner', 'org-a', 'owner'), ('member-a', 'member', 'org-a', 'member'), ('foreign-b', 'foreign', 'org-b', 'owner')`
  await connection`INSERT INTO subscription (id, reference_id, plan, status, seats, metadata) VALUES ('sub-a', 'org-a', 'enterprise', 'active', 1, '{"seats":7}'), ('sub-b', 'org-b', 'team', 'active', 99, null)`
  await connection`INSERT INTO invitation (id, email, inviter_id, organization_id, role, token, expires_at, membership_intent, status) VALUES
    ('internal', 'new@example.test', 'owner', 'org-a', 'member', 'internal', now() + interval '1 day', 'internal', 'pending'),
    ('external', 'external@example.test', 'owner', 'org-a', 'member', 'external', now() + interval '1 day', 'external', 'pending'),
    ('expired', 'expired@example.test', 'owner', 'org-a', 'member', 'expired', now() - interval '1 day', 'internal', 'pending'),
    ('accepted', 'accepted@example.test', 'owner', 'org-a', 'member', 'accepted', now() + interval '1 day', 'internal', 'accepted'),
    ('existing', ' MEMBER@example.test ', 'owner', 'org-a', 'member', 'existing', now() + interval '1 day', 'internal', 'pending'),
    ('foreign', 'foreign@example.test', 'owner', 'org-a', 'member', 'foreign', now() + interval '1 day', 'internal', 'pending')`
})

afterAll(async () => {
  const closed = once(server, 'close')
  server.close()
  server.closeAllConnections()
  await closed
  await connection.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
  await connection.end()
})

describe('organization plan and seats without a usage ledger', () => {
  it('serves authorized metadata over HTTP and refuses anonymous and foreign-organization reads', async () => {
    const authorized = await fetch(`${apiUrl}/api/organizations/org-a/billing-plan`)
    expect(authorized.status).toBe(200)
    expect(await authorized.json()).toMatchObject({
      success: true,
      data: { organizationId: 'org-a', totalSeats: 7, usedSeats: 3 },
    })
    const foreign = await fetch(`${apiUrl}/api/organizations/org-b/billing-plan`)
    expect(foreign.status).toBe(403)
    expect(await foreign.json()).not.toHaveProperty('data')
    authMockFns.mockGetSession.mockResolvedValue(null)
    const anonymous = await fetch(`${apiUrl}/api/organizations/org-a/billing-plan`)
    expect(anonymous.status).toBe(401)
    expect(await anonymous.json()).not.toHaveProperty('data')
  })

  it.each([
    { code: '40001', message: 'fixture recovery conflict', status: 503 },
    { code: '57014', message: 'canceling statement due to statement timeout', status: 503 },
    { code: '42P01', message: 'fixture permanent database error', status: 500 },
  ])(
    'projects $code over HTTP without leaking database details',
    async ({ code, message, status }) => {
      await connection`ALTER TABLE subscription RENAME TO unavailable_subscription`
      try {
        await connection.unsafe(`CREATE OR REPLACE FUNCTION fail_billing_read() RETURNS boolean
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE = '${code}', MESSAGE = '${message}'; END $$;
        CREATE VIEW subscription AS SELECT * FROM unavailable_subscription WHERE fail_billing_read()`)
        const result = await fetch(`${apiUrl}/api/organizations/org-a/billing-plan`)
        expect(result.status).toBe(status)
        expect(result.headers.get('retry-after')).toBe(status === 503 ? '5' : null)
        const body = await result.json()
        expect(body).not.toHaveProperty('data')
        expect(JSON.stringify(body)).not.toContain(message)
        expect(JSON.stringify(body)).not.toContain('subscription')
      } finally {
        await connection`DROP VIEW IF EXISTS subscription`
        await connection`ALTER TABLE unavailable_subscription RENAME TO subscription`
      }
    }
  )

  it('reports Enterprise capacity and only seat-consuming reservations without usage SQL', async () => {
    await expect(read()).resolves.toMatchObject({
      organizationId: 'org-a',
      subscriptionPlan: 'enterprise',
      totalSeats: 7,
      membersTotal: 2,
      usedSeats: 3,
      hasEnterprisePlan: true,
    })
  })

  it('denies cross-organization and non-admin reads before exposing payer data', async () => {
    await expect(read('org-b')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      getOrganizationPlanSeats.execute({
        principal: { ...principal, userId: 'member' },
        input: { organizationId: 'org-a' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it.each(['past_due', 'canceled'])(
    'does not grant SSO access to a %s subscription',
    async (status) => {
      await connection`UPDATE subscription SET status = ${status} WHERE id = 'sub-a'`
      await expect(read()).resolves.toMatchObject({
        hasEnterprisePlan: false,
        subscriptionPlan: status === 'past_due' ? 'enterprise' : null,
      })
    }
  )

  it('withholds Enterprise features when the payer is billing-blocked', async () => {
    await connection`INSERT INTO user_stats (id, user_id, billing_blocked, billing_blocked_reason) VALUES ('owner-stats', 'owner', true, 'payment_failed')`
    await expect(read()).resolves.toMatchObject({
      subscriptionPlan: 'enterprise',
      hasEnterprisePlan: false,
      totalSeats: 7,
    })
  })

  it('propagates a failed subscription read instead of inventing a free plan', async () => {
    await connection`ALTER TABLE subscription RENAME TO unavailable_subscription`
    try {
      await expect(read()).rejects.toThrow()
    } finally {
      await connection`ALTER TABLE unavailable_subscription RENAME TO subscription`
    }
  })
})
