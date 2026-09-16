/**
 * @vitest-environment node
 */

import { createMockRequest } from '@sim/testing'
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

import { POST } from '@/app/api/table/names/route'

function request(body?: unknown) {
  return createMockRequest('POST', body, {}, 'http://localhost/api/table/names')
}

describe('POST /api/table/names', () => {
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
    const response = await POST(
      request({ workspaceId: 'workspace-1', tableIds: ['table-1', 'table-2'] }),
      {}
    )

    expect(response.status).toBe(200)
    expect(mocks.listNames.mock.calls[0][0]).toMatchObject({
      principal: { kind: 'session', userId: 'user-1' },
      input: { workspaceId: 'workspace-1', tableIds: ['table-1', 'table-2'] },
    })
    expect(await response.json()).toEqual({
      success: true,
      data: { tables: [{ id: 'table-1', name: 'Accounts' }] },
    })
  })

  it('authenticates before validating the body', async () => {
    mocks.getSession.mockResolvedValue(null)

    const response = await POST(request(), {})

    expect(response.status).toBe(401)
    expect(mocks.listNames).not.toHaveBeenCalled()
  })

  it('rejects an empty table ID list', async () => {
    const response = await POST(request({ workspaceId: 'workspace-1', tableIds: [] }), {})

    expect(response.status).toBe(400)
    expect(mocks.listNames).not.toHaveBeenCalled()
  })
})
