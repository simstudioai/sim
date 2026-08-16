/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

interface CapturedDefinition {
  contract: { method: string; path: string }
  auth: unknown
  errorPolicy: unknown
  operation: { id: string }
  useCase: unknown
  mapInput(input: {
    params: { tableId: string }
    body: {
      workspaceId: string
      group: Record<string, unknown>
      outputColumns: Record<string, unknown>[]
      autoRun?: boolean
    }
  }): Record<string, unknown>
}

const mocks = vi.hoisted(() => ({
  auth: { kind: 'session-or-executor' },
  concealTableGroupAuthorization: { kind: 'conceal-table-group' },
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
  internalRateLimits: {
    none: ({ reason }: { reason: string }) => ({ kind: 'none', reason }),
  },
}))

vi.mock('@/lib/table/api', () => ({
  internalTableErrorPolicies: {
    concealTableGroupAuthorization: mocks.concealTableGroupAuthorization,
  },
  internalTableSessionOrExecutorAuth: mocks.auth,
}))

vi.mock('@/lib/table/application/groups', () => ({
  createTableGroupUseCase: mocks.useCases.create,
  deleteTableGroupUseCase: mocks.useCases.remove,
  updateTableGroupUseCase: mocks.useCases.update,
}))

vi.mock('@/lib/table/wire', () => ({
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
      expect(route.errorPolicy).toBe(mocks.concealTableGroupAuthorization)
    }
  })

  it('preserves the legacy create default while honoring an explicit opt-out', () => {
    const route = definition('POST')
    const input = {
      params: { tableId: 'table-1' },
      body: {
        workspaceId: 'workspace-1',
        group: { id: 'group-1' },
        outputColumns: [{ name: 'Result' }],
      },
    }

    expect(route.mapInput(input)).toEqual({
      tableId: 'table-1',
      ...input.body,
      autoRun: true,
    })
    expect(route.mapInput({ ...input, body: { ...input.body, autoRun: false } })).toEqual({
      tableId: 'table-1',
      ...input.body,
      autoRun: false,
    })
  })
})
