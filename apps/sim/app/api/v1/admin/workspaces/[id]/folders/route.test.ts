/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The route composes `withAdminAuthParams`, so auth is bypassed by making that wrapper a
 * passthrough — the assertions here are about query construction, not the auth gate.
 */
vi.mock('@/app/api/v1/admin/middleware', () => ({
  withAdminAuthParams: (handler: unknown) => handler,
}))

import { GET } from '@/app/api/v1/admin/workspaces/[id]/folders/route'

const WORKSPACE_ID = 'ws-1'
const routeContext = { params: Promise.resolve({ id: WORKSPACE_ID }) }

function listRequest() {
  return createMockRequest(
    'GET',
    undefined,
    {},
    `http://localhost:3000/api/v1/admin/workspaces/${WORKSPACE_ID}/folders?limit=50&offset=0`
  )
}

describe('admin workspace folders GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('excludes soft-deleted folders from both the count and the page', async () => {
    queueTableRows(schemaMock.workspace, [{ id: WORKSPACE_ID }])
    queueTableRows(schemaMock.folder, [{ total: 0 }])
    queueTableRows(schemaMock.folder, [])

    await GET(listRequest(), routeContext)

    // Calls: [0] workspace lookup, then the count and page share one prebuilt condition.
    const folderWheres = dbChainMockFns.where.mock.calls.slice(1).map(([where]) => where)
    expect(folderWheres.length).toBeGreaterThanOrEqual(2)
    for (const where of folderWheres) {
      // Pinned to the column so the assertion stays meaningful if another nullable filter
      // (e.g. a parent scope) is ever added to this condition.
      expect(
        flattenMockConditions(where).some(
          (node) => node.type === 'isNull' && node.column === schemaMock.folder.deletedAt
        )
      ).toBe(true)
    }
  })

  it('still scopes to the workspace and to workflow folders', async () => {
    queueTableRows(schemaMock.workspace, [{ id: WORKSPACE_ID }])
    queueTableRows(schemaMock.folder, [{ total: 0 }])
    queueTableRows(schemaMock.folder, [])

    await GET(listRequest(), routeContext)

    const where = dbChainMockFns.where.mock.calls[1]?.[0]
    const nodes = flattenMockConditions(where)
    expect(nodes.some((n) => n.type === 'eq' && n.right === WORKSPACE_ID)).toBe(true)
    expect(nodes.some((n) => n.type === 'eq' && n.right === 'workflow')).toBe(true)
  })
})
