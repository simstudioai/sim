import { workspace } from '@sim/db/schema'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { workspaceAuthorizationMock } from '@sim/testing/mocks/workspace-authorization.mock'
import { workspaceForkingAuthzMock } from '@sim/testing/mocks/workspace-forking-authz.mock'
import { workspaceForkingLineageMock } from '@sim/testing/mocks/workspace-forking-lineage.mock'
import { workspaceForkingMappingStoreMock } from '@sim/testing/mocks/workspace-forking-mapping-store.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/application/workspace-authorization', () => workspaceAuthorizationMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => workspaceForkingAuthzMock)
vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => workspaceForkingLineageMock)
vi.mock('@/lib/workflows/references/resources', () => ({
  listForkCopyableResourcePage: vi.fn(),
}))
vi.mock('@/ee/workspace-forking/lib/mapping/mapping-store', () => workspaceForkingMappingStoreMock)

import { listWorkspaceForkChildren } from '@/ee/workspace-forking/application/discovery'

permissionsMockFns.mockGetWorkspaceWithOwner.mockImplementation(async (id: string) => ({
  id,
  name: 'Parent',
  organizationId: null,
  allowPersonalApiKeys: true,
}))

const principal = createSessionPrincipal({ userId: 'actor-1' })
const pageInput = { workspaceId: 'parent', limit: 1, sortBy: 'createdAt', sortOrder: 'desc' }
const timestamp = '2026-09-09 12:34:56.123456'
const child = {
  id: 'child-z',
  name: 'Child',
  organizationId: null,
  createdAt: new Date('2026-09-09T12:34:56.123Z'),
  cursorCreatedAt: timestamp,
}

beforeEach(() => {
  resetDbChainMock()
})

describe('fork child pagination', () => {
  it('keeps database microseconds in the cursor and binds them unchanged on the next page', async () => {
    queueTableRows(workspace, [child, { ...child, id: 'child-y' }])
    const first = await listWorkspaceForkChildren.execute({ principal, input: pageInput })

    expect(first.items).toEqual([
      {
        id: 'child-z',
        name: 'Child',
        organizationId: null,
        createdAt: '2026-09-09T12:34:56.123Z',
      },
    ])
    expect(first.nextCursor).not.toBeNull()
    expect(JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString('utf8'))).toMatchObject({
      id: 'child-z',
      createdAt: timestamp,
    })
    expect(dbChainMockFns.select).toHaveBeenCalledWith(
      expect.objectContaining({
        cursorCreatedAt: expect.objectContaining({
          strings: expect.arrayContaining(['', '::text']),
        }),
      })
    )

    queueTableRows(workspace, [{ ...child, id: 'child-y' }])
    const second = await listWorkspaceForkChildren.execute({
      principal,
      input: { ...pageInput, cursor: first.nextCursor! },
    })

    expect(second.items.map((item) => item.id)).toEqual(['child-y'])
    expect(second.nextCursor).toBeNull()
    expect(dbChainMockFns.where).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conditions: expect.arrayContaining([
          expect.objectContaining({
            strings: expect.arrayContaining(['::timestamp, ']),
            values: expect.arrayContaining([timestamp, 'child-z']),
          }),
        ]),
      })
    )
  })

  it.each([{ workspaceId: 'another-parent' }, { sortOrder: 'asc' }])(
    'refuses a cursor reused under a different scope %s',
    async (change) => {
      queueTableRows(workspace, [child, { ...child, id: 'child-y' }])
      const first = await listWorkspaceForkChildren.execute({ principal, input: pageInput })
      const queriesBefore = dbChainMockFns.select.mock.calls.length

      await expect(
        listWorkspaceForkChildren.execute({
          principal,
          input: { ...pageInput, ...change, cursor: first.nextCursor! },
        })
      ).rejects.toMatchObject({ code: 'validation' })
      expect(dbChainMockFns.select).toHaveBeenCalledTimes(queriesBefore)
    }
  )

  it('rejects a malformed timestamp before querying children', async () => {
    queueTableRows(workspace, [child, { ...child, id: 'child-y' }])
    const first = await listWorkspaceForkChildren.execute({ principal, input: pageInput })
    const decoded = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString('utf8'))
    decoded.createdAt = 'not-a-timestamp'
    const cursor = Buffer.from(JSON.stringify(decoded)).toString('base64url')
    const queriesBefore = dbChainMockFns.select.mock.calls.length

    await expect(
      listWorkspaceForkChildren.execute({
        principal,
        input: { ...pageInput, cursor },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(queriesBefore)
  })
})
