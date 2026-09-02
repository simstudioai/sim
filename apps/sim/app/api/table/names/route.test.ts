/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listNames: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/table/application/operations', () => ({
  tableOperations: { list: { id: 'tables.list' } },
}))
vi.mock('@/lib/table/application/tables', () => ({
  listTableNamesUseCase: { operation: { id: 'tables.list' }, execute: mocks.listNames },
}))

import { GET } from '@/app/api/table/names/route'

describe('GET /api/table/names', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mocks.listNames.mockResolvedValue({
      tables: [{ id: 'table-1', name: 'Accounts' }],
    })
  })

  it('returns the lightweight table-name projection', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/table/names?workspaceId=workspace-1'),
      {}
    )

    expect(response.status).toBe(200)
    expect(mocks.listNames.mock.calls[0][0]).toMatchObject({
      principal: { kind: 'session', userId: 'user-1' },
      input: { workspaceId: 'workspace-1' },
    })
    expect(await response.json()).toEqual({
      success: true,
      data: { tables: [{ id: 'table-1', name: 'Accounts' }] },
    })
  })

  it('authenticates before validating the query', async () => {
    mocks.getSession.mockResolvedValue(null)

    const response = await GET(new NextRequest('http://localhost/api/table/names'), {})

    expect(response.status).toBe(401)
    expect(mocks.listNames).not.toHaveBeenCalled()
  })
})
