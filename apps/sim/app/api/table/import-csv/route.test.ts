/**
 * @vitest-environment node
 */
import { hybridAuthMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateTable, mockParseCsvBuffer, mockGetWorkspaceTableLimits } = vi.hoisted(() => ({
  mockCreateTable: vi.fn(),
  mockParseCsvBuffer: vi.fn(),
  mockGetWorkspaceTableLimits: vi.fn(),
}))

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn().mockReturnValue('deadbeefcafef00d'),
  generateShortId: vi.fn().mockReturnValue('short-id'),
}))

vi.mock('@/lib/table', () => ({
  batchInsertRows: vi.fn(),
  CSV_MAX_BATCH_SIZE: 1000,
  CSV_MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024,
  coerceRowsForTable: vi.fn(),
  createTable: mockCreateTable,
  deleteTable: vi.fn(),
  getWorkspaceTableLimits: mockGetWorkspaceTableLimits,
  inferSchemaFromCsv: vi.fn(),
  parseCsvBuffer: mockParseCsvBuffer,
  sanitizeName: vi.fn((name: string) => name),
  TABLE_LIMITS: {
    MAX_TABLE_NAME_LENGTH: 64,
  },
}))

vi.mock('@/app/api/table/utils', () => ({
  normalizeColumn: vi.fn((column) => column),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { POST } from '@/app/api/table/import-csv/route'

function createCsvFile(contents: string, name = 'data.csv', type = 'text/csv'): File {
  return new File([contents], name, { type })
}

function createFormData(file: File): FormData {
  const form = new FormData()
  form.append('file', file)
  form.append('workspaceId', 'workspace-1')
  return form
}

async function callPost(form: FormData) {
  const req = {
    formData: async () => form,
  } as unknown as NextRequest
  return POST(req)
}

describe('POST /api/table/import-csv', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetWorkspaceTableLimits.mockResolvedValue({
      maxRowsPerTable: 1000,
      maxTables: 10,
    })
  })

  it('returns 413 for oversized CSV files before reading their contents or creating a table', async () => {
    const file = createCsvFile('name,age\nAlice,30')
    Object.defineProperty(file, 'size', {
      value: 26 * 1024 * 1024,
    })
    const arrayBufferSpy = vi.spyOn(file, 'arrayBuffer')

    const response = await callPost(createFormData(file))
    const data = await response.json()

    expect(response.status).toBe(413)
    expect(data.error).toMatch(/CSV import file exceeds maximum size/)
    expect(arrayBufferSpy).not.toHaveBeenCalled()
    expect(mockParseCsvBuffer).not.toHaveBeenCalled()
    expect(mockCreateTable).not.toHaveBeenCalled()
  })

  it('accepts chunked multipart requests without a content-length header', async () => {
    const req = {
      headers: new Headers({ 'transfer-encoding': 'chunked' }),
      formData: vi.fn(async () => createFormData(createCsvFile('name\nAlice'))),
    } as unknown as NextRequest

    const response = await POST(req)

    expect(response.status).not.toBe(411)
    expect(req.formData).toHaveBeenCalled()
  })
})
