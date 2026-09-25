import {
  apiServerRoutesMock,
  apiServerRoutesMockFns,
} from '@sim/testing/mocks/api-server-routes.mock'
import { tableApiMock } from '@sim/testing/mocks/table-api.mock'
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

vi.mock('@/lib/api/server/routes', () => apiServerRoutesMock)

vi.mock('@/lib/table/api', () => tableApiMock)

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

const definitions = apiServerRoutesMockFns.mockDefineInternalJsonRoute.mock.calls.map(
  ([captured]) => captured as unknown as CapturedDefinition
)

function definition(method: string, path: string): CapturedDefinition {
  const match = definitions.find(
    (candidate) => candidate.contract.method === method && candidate.contract.path === path
  )
  if (!match) throw new Error(`Missing ${method} ${path} route definition`)
  return match
}

describe('internal table transfer routes', () => {
  it('conceals cross-tenant authorization on every table transfer control leg', () => {
    const expected = [
      [
        'POST',
        '/api/table/imports',
        tableApiMock.internalTableErrorPolicies.concealTableAuthorization,
      ],
      [
        'GET',
        '/api/table/imports/[importId]',
        tableApiMock.internalTableErrorPolicies.concealImportAuthorization,
      ],
      [
        'DELETE',
        '/api/table/imports/[importId]',
        tableApiMock.internalTableErrorPolicies.concealImportAuthorization,
      ],
      [
        'POST',
        '/api/table/imports/[importId]/parts',
        tableApiMock.internalTableErrorPolicies.concealImportAuthorization,
      ],
      [
        'POST',
        '/api/table/imports/[importId]/complete',
        tableApiMock.internalTableErrorPolicies.concealImportAuthorization,
      ],
      [
        'POST',
        '/api/table/[tableId]/exports',
        tableApiMock.internalTableErrorPolicies.concealTableAuthorization,
      ],
      [
        'GET',
        '/api/table/exports/[exportId]',
        tableApiMock.internalTableErrorPolicies.concealExportAuthorization,
      ],
      [
        'DELETE',
        '/api/table/exports/[exportId]',
        tableApiMock.internalTableErrorPolicies.concealExportAuthorization,
      ],
      [
        'GET',
        '/api/table/exports/[exportId]/download',
        tableApiMock.internalTableErrorPolicies.concealExportAuthorization,
      ],
    ] as const

    for (const [method, path, errorPolicy] of expected) {
      expect(definition(method, path).errorPolicy).toBe(errorPolicy)
    }
  })
})
