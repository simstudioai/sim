import { createServer } from 'node:http'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * End-to-end proof against real PostgreSQL: seed a deployment's own ledger and
 * execution logs, aggregate them with the real collector SQL, deliver the
 * buckets through the receiver's upsert, and value them at a per-deployment
 * rate — the same path a deployed on-prem instance takes.
 *
 * The collector's aggregate queries (jsonb token extraction, day bucketing) and
 * the receiver's `ON CONFLICT` upsert only exist as SQL, so a unit test with a
 * mocked driver cannot execute either. This suite is where they actually run.
 */
readTestDatabaseUrl()

const ACTOR = 'onprem-it-user'
const WORKSPACE = 'onprem-it-workspace'
const WORKFLOW = 'onprem-it-workflow'
const SNAPSHOT = 'onprem-it-snapshot'
const DEPLOYMENT = 'onprem-it-deployment'

const DAY_26 = new Date('2026-09-26T00:00:00Z')
const DAY_27 = new Date('2026-09-27T00:00:00Z')
const NOW = new Date('2026-09-27T12:00:00Z')

/**
 * The real env module captures these at import time, so every variable the
 * routes and the reporter read must be set before the dynamic imports below —
 * including the bridge's port, which is why the server binds at module scope
 * (the same ordering `vitest.integration.setup.ts` uses for its realtime fixture).
 */
const ADMIN_KEY = 'onprem-integration-admin-key-not-a-real-credential'
process.env.ADMIN_API_KEY = ADMIN_KEY
const DEPLOYMENT_API_KEY = 'simot_onprem_integration_key'

/** Late-bound so the bridge can serve the receiver route once beforeAll has imported it. */
let receiveReport: ((request: NextRequest) => Promise<Response>) | null = null

/**
 * Stands in for the receiving Sim instance: accepts the sender's real HTTP
 * request and hands the body to the actual receiver route. Only the network
 * hop's destination is local — auth, parsing and the upsert are all real.
 */
const bridge = createServer((request, response) => {
  const chunks: Buffer[] = []
  request.on('data', (chunk) => chunks.push(chunk as Buffer))
  request.on('end', () => {
    if (!receiveReport) {
      response.writeHead(503).end()
      return
    }
    void receiveReport(
      new NextRequest(`http://127.0.0.1${request.url}`, {
        method: 'POST',
        headers: request.headers as Record<string, string>,
        body: Buffer.concat(chunks).toString('utf8'),
      })
    ).then(async (result) => {
      response.writeHead(result.status, { 'content-type': 'application/json' })
      response.end(await result.text())
    })
  })
})
await new Promise<void>((resolve) => bridge.listen(0, '127.0.0.1', resolve))
const bridgeAddress = bridge.address()
if (!bridgeAddress || typeof bridgeAddress === 'string') throw new Error('bridge failed to bind')

process.env.ONPREM_TELEMETRY_ENABLED = 'true'
process.env.ONPREM_TELEMETRY_ENDPOINT = `http://127.0.0.1:${bridgeAddress.port}`
process.env.ONPREM_TELEMETRY_DEPLOYMENT_ID = DEPLOYMENT
process.env.ONPREM_TELEMETRY_API_KEY = DEPLOYMENT_API_KEY
process.env.ONPREM_TELEMETRY_LOOKBACK_DAYS = '2'

async function loadRuntime() {
  const [{ db }, schema, drizzle, collect, rates, hash, receiver, adminUsage] = await Promise.all([
    import('@sim/db'),
    import('@sim/db/schema'),
    import('drizzle-orm'),
    import('@/lib/onprem-telemetry/collect'),
    import('@/lib/onprem-telemetry/rates'),
    import('@sim/security/hash'),
    import('@/app/api/onprem-telemetry/report/route'),
    import('@/app/api/v1/admin/onprem-telemetry/deployments/[id]/usage/route'),
  ])
  return { db, schema, drizzle, collect, rates, hash, receiver, adminUsage }
}

type Runtime = Awaited<ReturnType<typeof loadRuntime>>
let runtime: Runtime

/** Ledger row shorthand; `cost` is dollars, matching the decimal column. */
function ledgerRow(
  id: string,
  createdAt: Date,
  category: 'fixed' | 'model' | 'model_unbilled' | 'tool',
  source: string,
  description: string,
  cost: string,
  metadata: Record<string, number> | null = null
) {
  return {
    id,
    userId: ACTOR,
    category,
    source,
    description,
    metadata,
    cost,
    eventKey: id,
    workspaceId: WORKSPACE,
    workflowId: WORKFLOW,
    executionId: `exec-${id}`,
    createdAt,
  }
}

async function seed() {
  const { db, schema } = runtime
  await db.insert(schema.user).values({
    id: ACTOR,
    name: 'On-prem integration actor',
    email: `${ACTOR}@example.test`,
    emailVerified: false,
    createdAt: NOW,
    updatedAt: NOW,
  })
  await db.insert(schema.workspace).values({
    id: WORKSPACE,
    name: 'On-prem integration workspace',
    ownerId: ACTOR,
    billedAccountUserId: ACTOR,
    createdAt: NOW,
    updatedAt: NOW,
  })
  await db.insert(schema.workflow).values({
    id: WORKFLOW,
    userId: ACTOR,
    workspaceId: WORKSPACE,
    name: 'On-prem integration workflow',
    lastSynced: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  })
  await db.insert(schema.workflowExecutionSnapshots).values({
    id: SNAPSHOT,
    workflowId: WORKFLOW,
    stateHash: 'onprem-it-hash',
    stateData: {},
    createdAt: NOW,
  })

  await db.insert(schema.usageLog).values([
    /** 40 runs × $0.005 base execution charge = $0.20 -> 40 credits. */
    ledgerRow('it-fixed-26', DAY_26, 'fixed', 'workflow', 'Base execution charge', '0.20'),
    /** BYOK: the on-prem default. Zero cost, tokens carried in metadata. */
    ledgerRow('it-byok-26', DAY_26, 'model_unbilled', 'workflow', 'gpt-5', '0', {
      inputTokens: 120000,
      outputTokens: 30000,
    }),
    /** Hosted-key model: cost AND tokens. $0.01 -> 2 credits. */
    ledgerRow('it-model-26', DAY_26, 'model', 'knowledge-base', 'text-embedding-3-small', '0.01', {
      inputTokens: 50000,
      outputTokens: 0,
    }),
    /** A second day, so bucketing by day is actually exercised. */
    ledgerRow('it-fixed-27', DAY_27, 'fixed', 'workflow', 'Base execution charge', '0.015'),
    /** Outside the reporting window entirely. */
    ledgerRow('it-old', new Date('2026-08-01T00:00:00Z'), 'fixed', 'workflow', 'Base', '9.99'),
  ])

  await db.insert(schema.workflowExecutionLogs).values(
    [
      { id: 'it-exec-ok', status: 'completed', startedAt: DAY_26, duration: 111_000 },
      { id: 'it-exec-fail', status: 'failed', startedAt: DAY_26, duration: 9_000 },
      { id: 'it-exec-day27', status: 'completed', startedAt: DAY_27, duration: 3_000 },
    ].map((row) => ({
      id: row.id,
      workflowId: WORKFLOW,
      workspaceId: WORKSPACE,
      executionId: row.id,
      stateSnapshotId: SNAPSHOT,
      level: row.status === 'failed' ? 'error' : 'info',
      status: row.status,
      trigger: 'api',
      startedAt: row.startedAt,
      endedAt: new Date(row.startedAt.getTime() + row.duration),
      totalDurationMs: row.duration,
      executionData: {},
      createdAt: row.startedAt,
    }))
  )
}

async function cleanup() {
  const { db, schema, drizzle } = runtime
  const { eq, inArray } = drizzle
  await db
    .delete(schema.onpremUsageReport)
    .where(eq(schema.onpremUsageReport.deploymentId, DEPLOYMENT))
  await db
    .delete(schema.onpremDeploymentRate)
    .where(eq(schema.onpremDeploymentRate.deploymentId, DEPLOYMENT))
  await db.delete(schema.onpremDeployment).where(eq(schema.onpremDeployment.id, DEPLOYMENT))
  await db
    .delete(schema.workflowExecutionLogs)
    .where(inArray(schema.workflowExecutionLogs.workflowId, [WORKFLOW]))
  await db.delete(schema.usageLog).where(eq(schema.usageLog.userId, ACTOR))
  await db
    .delete(schema.workflowExecutionSnapshots)
    .where(eq(schema.workflowExecutionSnapshots.id, SNAPSHOT))
  await db.delete(schema.workflow).where(eq(schema.workflow.id, WORKFLOW))
  await db.delete(schema.workspace).where(eq(schema.workspace.id, WORKSPACE))
  await db.delete(schema.user).where(eq(schema.user.id, ACTOR))
}

afterAll(
  () =>
    new Promise<void>((resolve) => {
      bridge.closeAllConnections()
      bridge.close(() => resolve())
    })
)

beforeAll(async () => {
  runtime = await loadRuntime()
  receiveReport = runtime.receiver.POST
  await cleanup()
  await seed()
  await runtime.db.insert(runtime.schema.onpremDeployment).values({
    id: DEPLOYMENT,
    name: 'Integration deployment',
    apiKeyHash: runtime.hash.sha256Hex(DEPLOYMENT_API_KEY),
    createdAt: NOW,
    updatedAt: NOW,
  })
  return cleanup
})

describe('on-prem usage telemetry against real PostgreSQL', () => {
  it('aggregates the ledger into per-day buckets with credits and tokens', async () => {
    const { collect } = runtime
    const window = collect.reportWindow(NOW, 2)

    const buckets = await collect.collectUsageBuckets(window)

    expect(buckets.map((b) => b.periodStart)).toEqual([
      '2026-09-26T00:00:00.000Z',
      '2026-09-27T00:00:00.000Z',
    ])

    const [day26, day27] = buckets
    /** $0.20 + $0 + $0.01 = $0.21 -> 42 credits. */
    expect(day26.credits).toBe(42)
    /** 120k + 50k input across both model rows; the `fixed` row contributes none. */
    expect(day26.inputTokens).toBe(170_000)
    expect(day26.outputTokens).toBe(30_000)
    expect(day26.workflowExecutions).toBe(2)
    expect(day26.workflowExecutionsFailed).toBe(1)
    expect(day26.workflowDurationMs).toBe(120_000)

    expect(day26.models).toEqual(
      expect.arrayContaining([
        { model: 'gpt-5', events: 1, inputTokens: 120_000, outputTokens: 30_000, credits: 0 },
        {
          model: 'text-embedding-3-small',
          events: 1,
          inputTokens: 50_000,
          outputTokens: 0,
          credits: 2,
        },
      ])
    )
    /** `fixed` is a source line but never a model line. */
    expect(day26.models.map((m) => m.model)).not.toContain('Base execution charge')

    expect(day27.credits).toBe(3)
    expect(day27.workflowExecutions).toBe(1)
  })

  it('excludes rows outside the window rather than misfiling them', async () => {
    const { collect } = runtime
    const buckets = await collect.collectUsageBuckets(collect.reportWindow(NOW, 2))
    const total = buckets.reduce((sum, b) => sum + b.credits, 0)
    /** The August row is 9.99 -> 1998 credits; its absence is the assertion. */
    expect(total).toBe(45)
  })

  it('accepts a report through the real receiver route and upserts on re-report', async () => {
    const { db, schema, drizzle, collect, receiver } = runtime
    const { eq } = drizzle
    const buckets = await collect.collectUsageBuckets(collect.reportWindow(NOW, 2))

    const post = (body: unknown, token = DEPLOYMENT_API_KEY) =>
      receiver.POST(
        new NextRequest('http://localhost:3000/api/onprem-telemetry/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        })
      )

    const rejected = await post(
      { schemaVersion: 1, deploymentId: DEPLOYMENT, reportedAt: NOW.toISOString(), buckets },
      'simot_wrong'
    )
    expect(rejected.status).toBe(401)

    const first = await post({
      schemaVersion: 1,
      deploymentId: DEPLOYMENT,
      reportedAt: NOW.toISOString(),
      buckets,
    })
    expect(first.status).toBe(200)
    await expect(first.json()).resolves.toEqual({ accepted: 2 })

    /** A later run re-sends the same window with a day revised upward. */
    const later = new Date('2026-09-27T18:00:00Z')
    const revised = buckets.map((bucket) =>
      bucket.periodStart === '2026-09-27T00:00:00.000Z'
        ? { ...bucket, workflowExecutions: 99, credits: 77 }
        : bucket
    )
    const second = await post({
      schemaVersion: 1,
      deploymentId: DEPLOYMENT,
      reportedAt: later.toISOString(),
      buckets: revised,
    })
    expect(second.status).toBe(200)

    const stored = await db
      .select()
      .from(schema.onpremUsageReport)
      .where(eq(schema.onpremUsageReport.deploymentId, DEPLOYMENT))
      .orderBy(schema.onpremUsageReport.periodStart)

    /** Two days, not four: the re-report replaced rather than appended. */
    expect(stored).toHaveLength(2)
    expect(Number(stored[0].credits)).toBe(42)
    expect(stored[1].workflowExecutions).toBe(99)
    expect(Number(stored[1].credits)).toBe(77)
    expect((stored[0].breakdown as { models: unknown[] }).models).toHaveLength(2)
  })

  it('serves credits, the applied rate and dollars through the real admin route', async () => {
    const { db, schema, adminUsage } = runtime
    await db.insert(schema.onpremDeploymentRate).values([
      {
        id: 'it-rate-list',
        deploymentId: DEPLOYMENT,
        usdPerCredit: '0.00500000',
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        createdAt: NOW,
      },
      {
        id: 'it-rate-discount',
        deploymentId: DEPLOYMENT,
        usdPerCredit: '0.00300000',
        effectiveFrom: DAY_27,
        createdAt: NOW,
      },
    ])

    const get = (key = ADMIN_KEY) =>
      adminUsage.GET(
        new NextRequest(
          `http://localhost:3000/api/v1/admin/onprem-telemetry/deployments/${DEPLOYMENT}/usage?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z`,
          { headers: { 'x-admin-key': key } }
        ),
        { params: Promise.resolve({ id: DEPLOYMENT }) }
      )

    expect((await get('wrong-key')).status).toBe(401)

    const response = await get()
    expect(response.status).toBe(200)
    const { data } = (await response.json()) as {
      data: {
        rows: Array<{
          periodStart: string
          credits: number
          usd: number | null
          rate: { id: string } | null
        }>
        totals: {
          credits: number
          usd: number
          unvaluedCredits: number
          workflowExecutions: number
        }
      }
    }

    /** Sept 26 predates the discount: 42 credits x $0.005 = $0.21. */
    expect(data.rows[0]).toMatchObject({ credits: 42, usd: 0.21 })
    expect(data.rows[0].rate?.id).toBe('it-rate-list')
    /** Sept 27 starts exactly at the discount's effectiveFrom: 77 x $0.003 = $0.231. */
    expect(data.rows[1]).toMatchObject({ credits: 77, usd: 0.231 })
    expect(data.rows[1].rate?.id).toBe('it-rate-discount')

    expect(data.totals.credits).toBe(119)
    expect(data.totals.usd).toBe(0.441)
    expect(data.totals.unvaluedCredits).toBe(0)
    expect(data.totals.workflowExecutions).toBe(101)
  })

  it('completes the full loop: cron reporter -> HTTP -> receiver -> admin route', async () => {
    const { db, schema, drizzle, adminUsage } = runtime
    const { eq } = drizzle

    await db
      .delete(schema.onpremUsageReport)
      .where(eq(schema.onpremUsageReport.deploymentId, DEPLOYMENT))

    const { runOnPremUsageReport } = await import('@/lib/onprem-telemetry/report')
    const result = await runOnPremUsageReport(NOW)

    expect(result).toEqual({ status: 'delivered', buckets: 2, accepted: 2 })

    /** The data is now readable through the admin route, which is the deliverable. */
    const response = await adminUsage.GET(
      new NextRequest(
        `http://localhost:3000/api/v1/admin/onprem-telemetry/deployments/${DEPLOYMENT}/usage?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z`,
        { headers: { 'x-admin-key': ADMIN_KEY } }
      ),
      { params: Promise.resolve({ id: DEPLOYMENT }) }
    )
    expect(response.status).toBe(200)
    const { data } = (await response.json()) as {
      data: { rows: Array<{ credits: number; usd: number | null }>; totals: { credits: number } }
    }
    /** Straight from the seeded ledger, through the wire, to a valued figure. */
    expect(data.rows.map((row) => row.credits)).toEqual([42, 3])
    expect(data.totals.credits).toBe(45)
  })

  it('reports credits as unvalued rather than guessing when no rate covers a day', async () => {
    const { rates } = runtime
    const effective = [
      {
        id: 'r1',
        usdPerCredit: 0.005,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        createdAt: NOW,
      },
    ]
    const valued = rates.valueUsage(
      [{ periodStart: new Date('2025-01-01T00:00:00Z'), credits: 100 }],
      effective
    )
    expect(valued[0]).toMatchObject({ rate: null, usd: null })
  })
})
