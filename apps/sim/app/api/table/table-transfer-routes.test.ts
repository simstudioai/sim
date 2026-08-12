/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

interface CapturedDefinition {
  contract: {
    method: string
    path: string
    response: { status?: number }
  }
  auth: unknown
  errorPolicy: unknown
  operation: { id: string }
  useCase: unknown
}

const mocks = vi.hoisted(() => ({
  auth: { kind: 'session-or-executor' },
  definitions: [] as CapturedDefinition[],
  errorPolicies: {
    concealTableAuthorization: { kind: 'conceal-table' },
    concealImportAuthorization: { kind: 'conceal-import' },
    concealExportAuthorization: { kind: 'conceal-export' },
  },
  useCases: {
    cancelExport: { operation: { id: 'tables.exports.cancel' } },
    cancelImport: { operation: { id: 'tables.imports.cancel' } },
    completeImport: { operation: { id: 'tables.imports.complete' } },
    createExport: { operation: { id: 'tables.exports.create' } },
    createImport: { operation: { id: 'tables.imports.create' } },
    createImportParts: { operation: { id: 'tables.imports.create_parts' } },
    downloadExport: { operation: { id: 'tables.exports.download' } },
    readExport: { operation: { id: 'tables.exports.read' } },
    readImport: { operation: { id: 'tables.imports.read' } },
  },
}))

vi.mock('@/lib/api/server/routes', () => ({
  defineInternalJsonRoute: (definition: CapturedDefinition) => {
    mocks.definitions.push(definition)
    return vi.fn()
  },
  internalOrchestrationErrorPolicy: { kind: 'plain' },
  internalRateLimits: {
    none: ({ reason }: { reason: string }) => ({ kind: 'none', reason }),
  },
}))

vi.mock('@/lib/table/api', () => ({
  internalTableErrorPolicies: mocks.errorPolicies,
  internalTableSessionOrExecutorAuth: mocks.auth,
}))

vi.mock('@/lib/table/application/imports', () => ({
  cancelTableImportUseCase: mocks.useCases.cancelImport,
  completeTableImportUseCase: mocks.useCases.completeImport,
  createTableImportPartsUseCase: mocks.useCases.createImportParts,
  createTableImportUseCase: mocks.useCases.createImport,
  readTableImportUseCase: mocks.useCases.readImport,
}))

vi.mock('@/lib/table/application/exports', () => ({
  cancelTableExportUseCase: mocks.useCases.cancelExport,
  createTableExportUseCase: mocks.useCases.createExport,
  downloadTableExportUseCase: mocks.useCases.downloadExport,
  readTableExportUseCase: mocks.useCases.readExport,
}))

vi.mock('@/lib/table/orchestration/import-resource', () => ({
  toV2CreateTableImport: vi.fn(),
  toV2TableImport: vi.fn(),
}))

vi.mock('@/lib/table/orchestration/export-resource', () => ({
  toV2TableExport: vi.fn(),
}))

import '@/app/api/table/[tableId]/exports/route'
import '@/app/api/table/exports/[exportId]/download/route'
import '@/app/api/table/exports/[exportId]/route'
import '@/app/api/table/imports/[importId]/complete/route'
import '@/app/api/table/imports/[importId]/parts/route'
import '@/app/api/table/imports/[importId]/route'
import '@/app/api/table/imports/route'

function definition(method: string, path: string): CapturedDefinition {
  const match = mocks.definitions.find(
    (candidate) => candidate.contract.method === method && candidate.contract.path === path
  )
  if (!match) throw new Error(`Missing ${method} ${path} route definition`)
  return match
}

describe('internal table transfer routes', () => {
  it('routes every ordinary transfer control leg through session-or-executor use cases', () => {
    const expected = [
      ['POST', '/api/table/imports', mocks.useCases.createImport],
      ['GET', '/api/table/imports/[importId]', mocks.useCases.readImport],
      ['DELETE', '/api/table/imports/[importId]', mocks.useCases.cancelImport],
      ['POST', '/api/table/imports/[importId]/parts', mocks.useCases.createImportParts],
      ['POST', '/api/table/imports/[importId]/complete', mocks.useCases.completeImport],
      ['POST', '/api/table/[tableId]/exports', mocks.useCases.createExport],
      ['GET', '/api/table/exports/[exportId]', mocks.useCases.readExport],
      ['DELETE', '/api/table/exports/[exportId]', mocks.useCases.cancelExport],
      ['GET', '/api/table/exports/[exportId]/download', mocks.useCases.downloadExport],
    ] as const

    expect(mocks.definitions).toHaveLength(expected.length)
    for (const [method, path, useCase] of expected) {
      const route = definition(method, path)
      expect(route.auth).toBe(mocks.auth)
      expect(route.useCase).toBe(useCase)
      expect(route.operation.id).toBe(useCase.operation.id)
    }
  })

  it('conceals cross-tenant authorization on every table transfer control leg', () => {
    const expected = [
      ['POST', '/api/table/imports', mocks.errorPolicies.concealTableAuthorization],
      ['GET', '/api/table/imports/[importId]', mocks.errorPolicies.concealImportAuthorization],
      ['DELETE', '/api/table/imports/[importId]', mocks.errorPolicies.concealImportAuthorization],
      [
        'POST',
        '/api/table/imports/[importId]/parts',
        mocks.errorPolicies.concealImportAuthorization,
      ],
      [
        'POST',
        '/api/table/imports/[importId]/complete',
        mocks.errorPolicies.concealImportAuthorization,
      ],
      ['POST', '/api/table/[tableId]/exports', mocks.errorPolicies.concealTableAuthorization],
      ['GET', '/api/table/exports/[exportId]', mocks.errorPolicies.concealExportAuthorization],
      ['DELETE', '/api/table/exports/[exportId]', mocks.errorPolicies.concealExportAuthorization],
      [
        'GET',
        '/api/table/exports/[exportId]/download',
        mocks.errorPolicies.concealExportAuthorization,
      ],
    ] as const

    for (const [method, path, errorPolicy] of expected) {
      expect(definition(method, path).errorPolicy).toBe(errorPolicy)
    }
  })

  it('preserves the create response statuses', () => {
    expect(definition('POST', '/api/table/imports').contract.response.status).toBe(201)
    expect(definition('POST', '/api/table/[tableId]/exports').contract.response.status).toBe(201)
  })
})
