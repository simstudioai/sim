/**
 * @vitest-environment node
 */
import { type ExecFileException, execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { resetEnvFlagsMock, resetEnvMock, setEnv, setEnvFlags } from '@sim/testing'
import { NextRequest } from 'next/server'
import type { Sql } from 'postgres'
import { afterAll, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  databaseUrl: process.env.BILLING_REPLAY_IT_DATABASE_URL,
  workerDirectory: process.env.BILLING_REPLAY_WORKER_DIR,
  client: null as Sql | null,
  schema: `billing_worker_${process.pid}`,
  temporaryFailures: 1,
}))

vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')
vi.mock('@sim/db', async () => {
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const { default: postgres } = await import('postgres')
  const client = postgres(state.databaseUrl ?? 'postgres://127.0.0.1:1/unused', {
    max: 2,
    connection: { search_path: state.schema },
    onnotice: () => {},
  })
  state.client = client
  const db = drizzle(client)
  return { db, dbReplica: db }
})

/** Subscription and payment-provider fixtures; callback, ledger and replay code are real. */
vi.mock('@/lib/billing/core/subscription', () => {
  const subscription = async (userId: string) => {
    if (userId === 'billing-replay-transient' && state.temporaryFailures-- > 0) {
      throw new Error('Temporary subscription lookup failure')
    }
    return {
      id: 'billing-replay-subscription',
      referenceId: userId,
      plan: 'pro',
      status: 'active',
      periodStart: new Date('2025-02-01T00:00:00.000Z'),
      periodEnd: new Date('2025-03-01T00:00:00.000Z'),
    }
  }
  return {
    getHighestPrioritySubscription: subscription,
    getHighestPriorityPersonalSubscription: subscription,
    getOrganizationSubscriptionUsable: vi.fn(),
  }
})
vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPrioritySubscription: vi.fn(),
  getHighestPriorityPersonalSubscription: vi.fn(),
}))
vi.mock('@/lib/billing/core/access', () => ({
  getEffectiveBillingStatus: async () => ({ billingBlocked: false }),
  isOrganizationBillingBlocked: async () => false,
}))
vi.mock('@/lib/billing/core/billing', () => ({
  calculateSubscriptionOverage: async () => 0,
  computeOrgOverageAmount: vi.fn(),
  getOrganizationSubscription: vi.fn(),
}))
vi.mock('@/lib/billing/cycle-close', () => ({ isSubscriptionCycleCloseCurrent: async () => true }))
vi.mock('@/lib/billing/plan-helpers', () => ({ isEnterprise: () => false, isFree: () => false }))
vi.mock('@/lib/billing/subscriptions/utils', () => ({
  hasUsableSubscriptionAccess: () => true,
  isOrgScopedSubscription: () => false,
}))
vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkBillingBlocked: vi.fn(),
  checkBillingEntityBlocked: vi.fn(),
  checkOrganizationMemberUsageLimit: vi.fn(),
  checkUsageStatus: vi.fn(),
}))
vi.mock('@/lib/billing/webhooks/outbox-handlers', () => ({
  OUTBOX_EVENT_TYPES: { STRIPE_THRESHOLD_OVERAGE_INVOICE: 'stripe.threshold-overage-invoice' },
}))
vi.mock('@/lib/core/outbox/service', () => ({ enqueueOutboxEvent: vi.fn() }))
vi.mock('@sim/audit', () => ({ AuditAction: {}, AuditResourceType: {}, recordAudit: vi.fn() }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))
vi.mock('@/lib/mothership/request/otel', () => ({
  withIncomingGoSpan: (
    _headers: unknown,
    _name: unknown,
    _attrs: unknown,
    run: (span: { setAttribute: () => void; setAttributes: () => void }) => unknown
  ) => run({ setAttribute: vi.fn(), setAttributes: vi.fn() }),
}))

import { POST } from '@/app/api/billing/update-cost/route'

const run = promisify(execFile)

afterAll(async () => {
  await state.client?.end()
  resetEnvMock()
  resetEnvFlagsMock()
})

/**
 * Requires an isolated localhost PostgreSQL database and the worker checkout.
 * Runs worker receipt accounting/settlement through HTTP into this route.
 * Provider calls and subscription fixtures are synthetic; both ledgers and callback are real.
 */
describe.skipIf(!state.databaseUrl || !state.workerDirectory)(
  'worker service receipt SQL proof',
  () => {
    it('settles hosted services, BYOK, media and Agent blocks through the real callback and SQL', async () => {
      const databaseUrl = new URL(state.databaseUrl as string)
      expect(['127.0.0.1', 'localhost']).toContain(databaseUrl.hostname)
      const client = state.client
      if (!client) throw new Error('Test database client was not initialized')
      setEnv({ INTERNAL_API_SECRET: 'billing-replay-local-secret-0123456789' })
      setEnvFlags({ isBillingEnabled: true, isHosted: true })
      await client.unsafe(`CREATE SCHEMA "${state.schema}"`)
      const statuses: number[] = []
      const server = createServer(async (request, response) => {
        try {
          const chunks: Buffer[] = []
          let bytes = 0
          for await (const chunk of request) {
            const buffer = Buffer.from(chunk)
            bytes += buffer.length
            if (bytes > 16384) throw new Error('Test request exceeds the callback fixture limit')
            chunks.push(buffer)
          }
          const headers = new Headers()
          for (const [key, value] of Object.entries(request.headers)) {
            if (typeof value === 'string') headers.set(key, value)
          }
          const result = await POST(
            new NextRequest(`http://127.0.0.1${request.url}`, {
              method: 'POST',
              headers,
              body: Buffer.concat(chunks).toString(),
            })
          )
          statuses.push(result.status)
          response.writeHead(result.status, Object.fromEntries(result.headers))
          response.end(await result.text())
        } catch (error) {
          response.writeHead(500)
          response.end(String(error))
        }
      })
      try {
        await client.unsafe(`CREATE TABLE "user" (id text PRIMARY KEY);
      INSERT INTO "user" (id) VALUES ('billing-replay-actor'), ('billing-replay-transient');
      CREATE TABLE usage_log (
        id text PRIMARY KEY, user_id text NOT NULL, category text NOT NULL, source text NOT NULL,
        description text NOT NULL, metadata jsonb, cost numeric NOT NULL, event_key text,
        billing_entity_type text, billing_entity_id text, billing_period_start timestamp,
        billing_period_end timestamp, workspace_id text, workflow_id text, execution_id text,
        created_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT usage_log_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES "user"(id)
      ); CREATE UNIQUE INDEX usage_log_event_key_unique ON usage_log(event_key) WHERE event_key IS NOT NULL`)
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Expected HTTP server port')
        const result = await run('bun', ['test', 'apps/server/test/billing-sim-sql.test.ts'], {
          cwd: state.workerDirectory,
          env: {
            ...process.env,
            INTERNAL_API_SECRET: 'billing-replay-local-secret-0123456789',
            BILLING_WORKER_SIM_URL: `http://127.0.0.1:${address.port}`,
            DATABASE_URL: state.databaseUrl,
          },
          timeout: 60_000,
          maxBuffer: 1024 * 1024,
        }).catch((error: ExecFileException & { stdout?: string; stderr?: string }) => {
          throw new Error([error.message, error.stdout, error.stderr].filter(Boolean).join('\n'), {
            cause: error,
          })
        })
        expect(result.stderr).toContain('0 fail')
        expect(statuses.every((status) => status === 200 || status === 409)).toBe(true)
        const rows =
          await client`SELECT source, cost, billing_entity_id, billing_period_start::text AS period_start, billing_period_end::text AS period_end FROM usage_log ORDER BY cost`
        expect(rows).toHaveLength(4)
        expect(rows.map((row) => Number(row.cost))).toEqual([0.0129, 0.3, 0.3075, 0.3075])
        expect(rows[0].source).toBe('mothership_block')
        for (const row of rows) {
          expect(row.billing_entity_id).toBe('billing-replay-actor')
          expect(row.period_start).toBe('2025-02-01 00:00:00')
          expect(row.period_end).toBe('2025-03-01 00:00:00')
        }
      } finally {
        try {
          if (server.listening) {
            await new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve()))
            )
          }
        } finally {
          await client.unsafe(`DROP SCHEMA "${state.schema}" CASCADE`)
        }
      }
    }, 90_000)
  }
)
