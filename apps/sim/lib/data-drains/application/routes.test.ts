import { createRouteContext } from '@sim/testing/helpers/http'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
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
vi.mock('@/lib/data-drains/application/use-cases', async () => {
  const { dataDrainOperations } = await import('@/lib/data-drains/application/operations')
  return {
    authorizeDataDrainOperation: hoisted.authorize,
    getDataDrain: { operation: dataDrainOperations.get, execute: hoisted.get },
    listDataDrains: { operation: dataDrainOperations.list, execute: hoisted.list },
    createDataDrain: { operation: dataDrainOperations.create, execute: hoisted.create },
    updateDataDrain: { operation: dataDrainOperations.update, execute: hoisted.update },
    deleteDataDrain: { operation: dataDrainOperations.delete, execute: hoisted.delete },
    testDataDrain: { operation: dataDrainOperations.test, execute: hoisted.test },
    runDataDrain: { operation: dataDrainOperations.run, execute: hoisted.run },
    listDataDrainRuns: { operation: dataDrainOperations.runs, execute: hoisted.runs },
  }
})
vi.mock('@/lib/data-drains/destinations/registry', () => ({
  getDestination: () => ({ configSchema: { parse: (v: unknown) => v } }),
}))

import { POST as create } from '@/app/api/organizations/[id]/data-drains/route'

const mocks = { ...hoisted, session: authMockFns.mockGetSession }
const context = createRouteContext({ id: 'org', drainId: 'drain' })
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
  return createMockRequest({
    method,
    url: 'http://localhost/api/organizations/org/data-drains/drain',
    body,
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
