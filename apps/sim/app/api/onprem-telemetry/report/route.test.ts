import { sha256Hex } from '@sim/security/hash'
import {
  createMockRequest,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { POST } from '@/app/api/onprem-telemetry/report/route'

const API_KEY = 'simot_test_key'
const URL = 'http://localhost:3000/api/onprem-telemetry/report'

const bucket = {
  periodStart: '2026-09-26T00:00:00.000Z',
  periodEnd: '2026-09-27T00:00:00.000Z',
  workflowExecutions: 4,
  workflowExecutionsFailed: 1,
  workflowDurationMs: 1000,
  credits: 4,
  inputTokens: 10,
  outputTokens: 5,
  sources: [{ source: 'workflow', category: 'fixed', events: 4, credits: 4 }],
  models: [],
}

function report(body: unknown, headers: Record<string, string> = {}) {
  return createMockRequest('POST', body, { Authorization: `Bearer ${API_KEY}`, ...headers }, URL)
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    deploymentId: 'acme-prod',
    reportedAt: '2026-09-27T06:15:00.000Z',
    buckets: [bucket],
    ...overrides,
  }
}

describe('POST /api/onprem-telemetry/report', () => {
  beforeEach(() => resetDbChainMock())

  it('rejects a request without a bearer token', async () => {
    const response = await POST(createMockRequest('POST', validBody(), {}, URL))
    expect(response.status).toBe(401)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('rejects an unknown key', async () => {
    const response = await POST(report(validBody()))
    expect(response.status).toBe(401)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('looks the deployment up by the hash of the key, never the key', async () => {
    queueTableRows(schemaMock.onpremDeployment, [{ id: 'acme-prod' }])
    await POST(report(validBody()))
    const boundValues = dbChainMockFns.where.mock.calls.flat().map((c) => JSON.stringify(c))
    expect(boundValues.join()).toContain(sha256Hex(API_KEY))
    expect(boundValues.join()).not.toContain(API_KEY)
  })

  it('refuses a body claiming a different deployment', async () => {
    queueTableRows(schemaMock.onpremDeployment, [{ id: 'acme-prod' }])
    const response = await POST(report(validBody({ deploymentId: 'someone-else' })))
    expect(response.status).toBe(403)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('rejects a payload that does not match the contract', async () => {
    queueTableRows(schemaMock.onpremDeployment, [{ id: 'acme-prod' }])
    const response = await POST(report(validBody({ schemaVersion: 2 })))
    expect(response.status).toBe(400)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('upserts one row per day and reports how many were accepted', async () => {
    queueTableRows(schemaMock.onpremDeployment, [{ id: 'acme-prod' }])
    const duplicateDay = { ...bucket, workflowExecutions: 9 }
    const response = await POST(report(validBody({ buckets: [bucket, duplicateDay] })))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ accepted: 1 })
    const [rows] = dbChainMockFns.values.mock.calls[0] as [Array<Record<string, unknown>>]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      deploymentId: 'acme-prod',
      periodStart: new Date(bucket.periodStart),
      workflowExecutions: 9,
      credits: '4',
      breakdown: { sources: bucket.sources, models: [] },
      schemaVersion: 1,
    })
  })
})
