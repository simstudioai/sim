/**
 * The level-triggered usage threshold email against real claim state in a disposable PostgreSQL
 * schema. Only delivery is stubbed: the mailer is the external boundary, and a sent email is the
 * outcome under test.
 */
import type { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { emailMailerMock, emailMailerMockFns } from '@sim/testing/mocks/email-mailer.mock'
import { emailTemplatesMock } from '@sim/testing/mocks/email-templates.mock'
import { envFlagsMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { select, update } = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn() }))
const databaseUrl = readTestDatabaseUrl()

vi.mock('@sim/db', () => ({ db: { select, update }, dbReplica: { select } }))
vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)
vi.mock('@/components/emails', () => emailTemplatesMock)
vi.mock('@/lib/messaging/email/mailer', () => emailMailerMock)
vi.mock('@/lib/messaging/email/unsubscribe', () => ({ getEmailPreferences: async () => null }))

import { maybeSendUsageThresholdEmail } from '@/lib/billing/core/usage'

const { mockSendEmail } = emailMailerMockFns

const schemaName = `usage_threshold_${generateId().replaceAll('-', '')}`
const connection = postgres(databaseUrl, {
  max: 4,
  prepare: false,
  connection: { search_path: schemaName },
  onnotice: () => undefined,
})
const database = drizzle(connection, { schema }) as typeof db

const SEPTEMBER = new Date('2026-09-01T00:00:00.000Z')
const OCTOBER = new Date('2026-10-01T00:00:00.000Z')

let organizationId: string
let adminId: string

/** One completion that leaves the organization at `usage`, having recorded `costDelta` of it. */
function notify(
  usage: number,
  { periodStart = SEPTEMBER, limit = 100, costDelta = 1 } = {}
): Promise<void> {
  return maybeSendUsageThresholdEmail({
    scope: 'organization',
    organizationId,
    planName: 'Enterprise',
    periodStart,
    workspaceId: 'workspace',
    usageBefore: usage - costDelta,
    costDelta,
    limit,
  })
}

async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  await connection`INSERT INTO settings VALUES (${adminId}, ${adminId}, ${enabled})
    ON CONFLICT (id) DO UPDATE SET billing_usage_notifications_enabled = ${enabled}`
}

beforeAll(async () => {
  await connection.unsafe(`CREATE SCHEMA "${schemaName}"`)
  await connection.unsafe(`
    CREATE TABLE organization (id text PRIMARY KEY, limit_notifications jsonb);
    CREATE TABLE "user" (id text PRIMARY KEY, email text, name text);
    CREATE TABLE member (id text PRIMARY KEY, organization_id text, user_id text, role text);
    CREATE TABLE settings (id text PRIMARY KEY, user_id text, billing_usage_notifications_enabled boolean);
  `)
  select.mockImplementation((fields) => database.select(fields))
  update.mockImplementation((table) => database.update(table))
  setEnvFlags({ isBillingEnabled: true })
})

beforeEach(async () => {
  mockSendEmail.mockClear()
  organizationId = generateId()
  adminId = generateId()
  await connection`INSERT INTO organization (id) VALUES (${organizationId})`
  await connection`INSERT INTO "user" VALUES (${adminId}, ${`${adminId}@example.com`}, 'Admin')`
  await connection`INSERT INTO member VALUES (${generateId()}, ${organizationId}, ${adminId}, 'owner')`
})

afterAll(async () => {
  resetEnvFlagsMock()
  await connection.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
  await connection.end()
})

describe('usage threshold email', () => {
  it('warns once per period however many completions find usage above 80%', async () => {
    await Promise.all([notify(85), notify(85), notify(86)])
    await notify(90)

    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it('still sends the reached email after the warning, but never the warning after it', async () => {
    await notify(85)
    await notify(100)
    await notify(100)
    await notify(85)

    expect(mockSendEmail).toHaveBeenCalledTimes(2)
  })

  it('re-arms both thresholds whenever the billing period changes, even to an earlier one', async () => {
    await notify(100)
    await notify(85, { periodStart: OCTOBER })
    await notify(100, { periodStart: OCTOBER })
    await notify(85)

    expect(mockSendEmail).toHaveBeenCalledTimes(4)
  })

  it('warns again at a raised limit after the old one was reached', async () => {
    await notify(100)
    await notify(100, { limit: 125 })
    await notify(110, { limit: 125 })

    expect(mockSendEmail).toHaveBeenCalledTimes(2)
  })

  it('keeps the claim for a later completion when nobody can be notified', async () => {
    await setNotificationsEnabled(false)
    await notify(90)
    await setNotificationsEnabled(true)
    await notify(90)

    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it('keeps the claim when a completion recorded no cost', async () => {
    await notify(90, { costDelta: 0 })
    expect(mockSendEmail).not.toHaveBeenCalled()

    await notify(90)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })
})
