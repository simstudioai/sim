/**
 * @vitest-environment node
 */

import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/table/application/groups', () => ({
  listTableGroupsUseCase: { operation: { id: 'tables.groups.list' }, execute: mocks.list },
  createTableGroupUseCase: { operation: { id: 'tables.groups.create' }, execute: mocks.create },
  updateTableGroupUseCase: { operation: { id: 'tables.groups.update' }, execute: mocks.update },
  deleteTableGroupUseCase: { operation: { id: 'tables.groups.delete' }, execute: mocks.remove },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { DELETE, GET, PATCH, POST } from '@/app/api/v2/tables/[tableId]/groups/route'

const WORKSPACE_ID = 'workspace-1'
const principal = {
  kind: 'workspace_api_key' as const,
  workspaceId: WORKSPACE_ID,
  keyId: 'key-1',
}
const auth = {
  principal,
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`],
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const group = {
  id: 'group-1',
  workflowId: 'workflow-1',
  type: 'manual' as const,
  outputs: [{ blockId: 'block-1', path: 'result', columnName: 'col-1' }],
  autoRun: false,
}
const table = {
  id: 'table-1',
  name: 'Contacts',
  schema: {
    columns: [
      {
        id: 'col-1',
        name: 'Result',
        type: 'string' as const,
        required: false,
        unique: false,
        workflowGroupId: 'group-1',
      },
    ],
  },
}
const context = { params: Promise.resolve({ tableId: 'table-1' }) }

function writeRequest(method: 'POST' | 'PATCH' | 'DELETE', body: unknown) {
  return new NextRequest('http://localhost:3000/api/v2/tables/table-1/groups', {
    method,
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
}

describe('/api/v2/tables/[tableId]/groups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.list.mockResolvedValue({ table, groups: [group] })
    mocks.create.mockResolvedValue({ table, group })
    mocks.update.mockResolvedValue({ table, group, changed: true, startAutoRun: false })
    mocks.remove.mockResolvedValue({ table, groupId: 'group-1' })
  })

  it('lists the bounded group projection through the read use case', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/v2/tables/table-1/groups?workspaceId=${WORKSPACE_ID}`
    )
    const response = await GET(req, context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [
        {
          ...group,
          outputs: [{ ...group.outputs[0], columnName: 'Result' }],
          deploymentMode: 'deployed',
        },
      ],
      nextCursor: null,
    })
    expect(mocks.list).toHaveBeenCalledWith({
      principal,
      input: { tableId: 'table-1', workspaceId: WORKSPACE_ID },
      request: req,
    })
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/tables/table-1/groups?workspaceId=${WORKSPACE_ID}`
      ),
      context
    )

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })

  it('defaults create autoRun off and delegates all execution initiation to the application layer', async () => {
    const req = writeRequest('POST', {
      workspaceId: WORKSPACE_ID,
      group: {
        workflowId: 'workflow-1',
        type: 'manual',
        outputs: [{ blockId: 'block-1', path: 'result', columnName: 'Result' }],
      },
      outputColumns: [{ name: 'Result', type: 'string' }],
    })
    const response = await POST(req, context)

    expect(response.status).toBe(201)
    expect((await response.json()).data.group.id).toBe('group-1')

    /**
     * `columnName` is sent as a column name and stored as a column id; reading
     * back the id under the same field made the value un-round-trippable and
     * unmatched by anything else on a surface that is otherwise name-keyed.
     */
    const created = await POST(
      writeRequest('POST', {
        workspaceId: WORKSPACE_ID,
        group: {
          workflowId: 'workflow-1',
          type: 'manual',
          outputs: [{ blockId: 'block-1', path: 'result', columnName: 'Result' }],
        },
        outputColumns: [{ name: 'Result', type: 'string' }],
      }),
      context
    )
    expect((await created.json()).data.group.outputs[0].columnName).toBe('Result')
    expect(mocks.create).toHaveBeenCalledWith({
      principal,
      input: expect.objectContaining({
        tableId: 'table-1',
        workspaceId: WORKSPACE_ID,
        autoRun: false,
      }),
      request: req,
    })
  })

  it('preserves generic denied table access on group mutations as forbidden', async () => {
    mocks.update.mockRejectedValueOnce(new OrchestrationError('forbidden', 'Forbidden'))

    const response = await PATCH(
      writeRequest('PATCH', { workspaceId: WORKSPACE_ID, groupId: 'group-1', name: 'Renamed' }),
      context
    )

    expect(response.status).toBe(403)
    expect((await response.json()).error.message).toBe('Forbidden')
  })

  it('returns authoritative surviving columns after deletion', async () => {
    const response = await DELETE(
      writeRequest('DELETE', { workspaceId: WORKSPACE_ID, groupId: 'group-1' }),
      context
    )

    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({ id: 'group-1', deleted: true })
  })
})
