/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  preauthRate: vi.fn(),
  operationRate: vi.fn(),
  gate: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: class V2ApiKeyUnauthenticatedError extends Error {},
}))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mocks.preauthRate
    checkRateLimitDirectOrThrow = mocks.operationRate
  },
  getRateLimit: () => ({ maxTokens: 100, refillRate: 100, refillIntervalMs: 60_000 }),
}))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mocks.gate }))
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
  rolloutUserId: 'owner-1',
  rateLimitSubjectIds: [`workspace:${WORKSPACE_ID}`],
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const rate = {
  allowed: true,
  remaining: 99,
  resetAt: new Date('2026-01-01T01:00:00.000Z'),
  retryAfterMs: 0,
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
    mocks.authenticate.mockResolvedValue(auth)
    mocks.preauthRate.mockResolvedValue(rate)
    mocks.operationRate.mockResolvedValue(rate)
    mocks.gate.mockResolvedValue(null)
    mocks.list.mockResolvedValue({ groups: [group] })
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
    expect(await response.json()).toEqual({ data: [group], nextCursor: null })
    expect(mocks.list).toHaveBeenCalledWith({
      principal,
      input: { tableId: 'table-1', workspaceId: WORKSPACE_ID },
      request: req,
    })
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
