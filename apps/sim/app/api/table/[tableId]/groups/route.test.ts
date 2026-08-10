/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

interface CapturedDefinition {
  contract: { method: string; path: string }
  auth: unknown
  operation: { id: string }
  useCase: unknown
}

const mocks = vi.hoisted(() => ({
  auth: { kind: 'session-or-executor' },
  definitions: [] as CapturedDefinition[],
  useCases: {
    create: { operation: { id: 'tables.groups.create' } },
    remove: { operation: { id: 'tables.groups.delete' } },
    update: { operation: { id: 'tables.groups.update' } },
  },
}))

vi.mock('@/lib/api/server/routes', () => ({
  defineInternalJsonRoute: (definition: CapturedDefinition) => {
    mocks.definitions.push(definition)
    return vi.fn()
  },
  extendInternalErrorPolicy: vi.fn(() => ({ kind: 'table' })),
  internalErrorResponse: vi.fn(),
  internalPlainOrchestrationErrorPolicy: { kind: 'plain' },
  internalRateLimits: {
    none: ({ reason }: { reason: string }) => ({ kind: 'none', reason }),
  },
}))

vi.mock('@/lib/table/api', () => ({ internalTableSessionOrExecutorAuth: mocks.auth }))

vi.mock('@/lib/table/application/groups', () => ({
  createTableGroupUseCase: mocks.useCases.create,
  deleteTableGroupUseCase: mocks.useCases.remove,
  updateTableGroupUseCase: mocks.useCases.update,
}))

vi.mock('@/app/api/table/utils', () => ({
  normalizeColumn: vi.fn(),
}))

import '@/app/api/table/[tableId]/groups/route'

function definition(method: string): CapturedDefinition {
  const match = mocks.definitions.find((candidate) => candidate.contract.method === method)
  if (!match) throw new Error(`Missing ${method} group route definition`)
  return match
}

describe('/api/table/[tableId]/groups', () => {
  it('routes every mutation through its session-or-executor application use case', () => {
    const expected = [
      ['POST', mocks.useCases.create],
      ['PATCH', mocks.useCases.update],
      ['DELETE', mocks.useCases.remove],
    ] as const

    expect(mocks.definitions).toHaveLength(expected.length)
    for (const [method, useCase] of expected) {
      const route = definition(method)
      expect(route.contract.path).toBe('/api/table/[tableId]/groups')
      expect(route.auth).toBe(mocks.auth)
      expect(route.useCase).toBe(useCase)
      expect(route.operation.id).toBe(useCase.operation.id)
    }
  })
})
