import { beforeEach, describe, expect, it, vi } from 'vitest'

const { selectLimit, selectWhere, selectFrom, select } = vi.hoisted(() => {
  const selectLimit = vi.fn()
  const selectWhere = vi.fn(() => ({ limit: selectLimit }))
  const selectFrom = vi.fn(() => ({ where: selectWhere }))
  const select = vi.fn(() => ({ from: selectFrom }))
  return { selectLimit, selectWhere, selectFrom, select }
})

vi.mock('@sim/db', () => ({
  db: { select },
}))

vi.mock('@sim/db/schema', () => ({
  workflowInterface: {
    id: 'id',
    identifier: 'identifier',
    archivedAt: 'archivedAt',
  },
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: (handler: unknown) => handler,
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: async (_contract: unknown, request: Request) => {
    const url = new URL(request.url)
    const identifier = url.searchParams.get('identifier') || ''
    return {
      success: true,
      data: { query: { identifier } },
    }
  },
}))

import { GET } from '@/app/api/interfaces/validate/route'

describe('GET /api/interfaces/validate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectLimit.mockResolvedValue([])
  })

  it('rejects reserved identifiers', async () => {
    const req = new Request('http://localhost/api/interfaces/validate?identifier=generate')
    const response = await GET(req as never)
    const body = await response.json()
    expect(body.available).toBe(false)
    expect(String(body.error)).toMatch(/reserved/i)
  })

  it('reports available identifiers', async () => {
    const req = new Request('http://localhost/api/interfaces/validate?identifier=send-hi')
    const response = await GET(req as never)
    const body = await response.json()
    expect(body.available).toBe(true)
  })
})
