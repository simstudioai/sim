import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  authorize: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  test: vi.fn(),
  run: vi.fn(),
  runs: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/data-drains/application/use-cases', async () => {
  const { dataDrainOperations } = await import('@/lib/data-drains/application/operations')
  return {
    authorizeDataDrainOperation: mocks.authorize,
    getDataDrain: { operation: dataDrainOperations.get, execute: mocks.get },
    listDataDrains: { operation: dataDrainOperations.list, execute: mocks.list },
    createDataDrain: { operation: dataDrainOperations.create, execute: mocks.create },
    updateDataDrain: { operation: dataDrainOperations.update, execute: mocks.update },
    deleteDataDrain: { operation: dataDrainOperations.delete, execute: mocks.delete },
    testDataDrain: { operation: dataDrainOperations.test, execute: mocks.test },
    runDataDrain: { operation: dataDrainOperations.run, execute: mocks.run },
    listDataDrainRuns: { operation: dataDrainOperations.runs, execute: mocks.runs },
  }
})
vi.mock('@/lib/data-drains/destinations/registry', () => ({
  getDestination: () => ({ configSchema: { parse: (v: unknown) => v } }),
}))

import { POST as create } from '@/app/api/organizations/[id]/data-drains/route'

const context = { params: Promise.resolve({ id: 'org', drainId: 'drain' }) }
const row = {
  id: 'drain',
  organizationId: 'org',
  name: 'Export',
  source: 'audit_logs',
  destinationType: 'webhook',
  destinationConfig: { url: 'https://example.com/hook' },
  scheduleCadence: 'daily',
  enabled: true,
  cursor: null,
  createdBy: 'actor',
  lastRunAt: null,
  lastSuccessAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}
function request(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/organizations/org/data-drains/drain', {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
      : {}),
  })
}
beforeEach(() => {
  mocks.session.mockResolvedValue({ user: { id: 'actor' }, session: { id: 'verified-session' } })
  mocks.authorize.mockResolvedValue(undefined)
  mocks.get.mockResolvedValue(row)
  mocks.create.mockResolvedValue(row)
  mocks.update.mockResolvedValue(row)
  mocks.delete.mockResolvedValue({ deleted: true, drain: row })
  mocks.test.mockResolvedValue({ ok: true, drain: row })
  mocks.run.mockResolvedValue({ jobId: 'job', drain: row })
  mocks.runs.mockResolvedValue([])
})
describe('data drain internal adapters', () => {
  it('preserves creation 201 and omits secret fields in response', async () => {
    const response = await create(
      request('POST', {
        name: 'Export',
        source: 'audit_logs',
        scheduleCadence: 'daily',
        destinationType: 'webhook',
        destinationConfig: row.destinationConfig,
        destinationCredentials: { signingSecret: 'x'.repeat(32) },
      }),
      context
    )
    expect(response.status).toBe(201)
    expect(await response.json()).toHaveProperty('drain.id', 'drain')
  })
})
