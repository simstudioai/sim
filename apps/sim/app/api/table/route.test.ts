/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  authenticateWithTransport: vi.fn(),
  createTable: vi.fn(),
  listTables: vi.fn(),
  capture: vi.fn(),
}))

vi.mock('@/lib/table/api', () => ({
  internalTableSessionOrExecutorAuth: {
    authenticate: mocks.authenticate,
    authenticateWithTransport: mocks.authenticateWithTransport,
  },
}))

vi.mock('@/lib/table/application/tables', () => ({
  createTableUseCase: { operation: { id: 'tables.create' }, execute: mocks.createTable },
  listTableDefinitionsUseCase: { operation: { id: 'tables.list' }, execute: mocks.listTables },
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))

import { GET, POST } from '@/app/api/table/route'

const TABLE = {
  id: 'table-1',
  name: 'people',
  description: null,
  schema: { columns: [{ id: 'column-1', name: 'name', type: 'string' as const }] },
  rowCount: 0,
  maxRows: 10_000,
  workspaceId: 'workspace-1',
  folderId: null,
  createdBy: 'user-1',
  locks: {
    schemaLocked: false,
    insertLocked: false,
    updateLocked: false,
    deleteLocked: false,
  },
  archivedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

function sessionPrincipal() {
  const principal = {
    kind: 'session',
    userId: 'user-1',
    sessionId: 'session-1',
  } as const
  mocks.authenticate.mockResolvedValue(principal)
  mocks.authenticateWithTransport.mockResolvedValue({ principal, transport: 'session' })
}

function executorPrincipal() {
  const principal = createTestRuntimePrincipal({
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    executionId: 'execution-1',
    rootWorkflowId: 'parent-workflow',
  })
  mocks.authenticate.mockResolvedValue(principal)
  mocks.authenticateWithTransport.mockResolvedValue({
    principal,
    transport: 'executor_jwt',
    executionWorkspaceId: 'workspace-canonical',
  })
}

function actorlessExecutorPrincipal() {
  const principal = createTestRuntimePrincipal({
    principal: {
      kind: 'system',
      serviceId: 'schedule',
      workspaceId: 'workspace-canonical',
      workflowId: 'parent-workflow',
    },
    executionId: 'execution-1',
    rootWorkflowId: 'parent-workflow',
    currentWorkflow: {
      workflowId: 'parent-workflow',
      mode: 'deployment',
      deploymentVersionId: 'deployment-version-1',
    },
  })
  mocks.authenticate.mockResolvedValue(principal)
  mocks.authenticateWithTransport.mockResolvedValue({
    principal,
    transport: 'executor_jwt',
    executionWorkspaceId: 'workspace-canonical',
  })
}

function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/table', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    {}
  )
}

describe('/api/table application adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionPrincipal()
    mocks.createTable.mockResolvedValue({ table: TABLE, folderPath: '/' })
    mocks.listTables.mockResolvedValue({
      tables: [TABLE],
    })
  })

  it('passes the session workspace and folder id into the shared create use case', async () => {
    const response = await post({
      workspaceId: 'workspace-1',
      name: 'people',
      folderId: 'folder-1',
      schema: { columns: [{ name: 'name', type: 'string' }] },
    })

    expect(response.status).toBe(200)
    expect(mocks.createTable.mock.calls[0][0].input).toMatchObject({
      workspaceId: 'workspace-1',
      folderId: 'folder-1',
    })
    expect((await response.json()).data.table.folderId).toBeNull()
  })

  it('uses canonical delegated workspace instead of the body assertion', async () => {
    executorPrincipal()
    await post({
      workspaceId: 'workspace-forged',
      name: 'people',
      schema: { columns: [{ name: 'name', type: 'string' }] },
    })

    expect(mocks.createTable.mock.calls[0][0].input.workspaceId).toBe('workspace-canonical')
  })

  it('creates for an actorless executor without attributing user analytics', async () => {
    actorlessExecutorPrincipal()

    const response = await post({
      workspaceId: 'workspace-forged',
      name: 'people',
      schema: { columns: [{ name: 'name', type: 'string' }] },
    })

    expect(response.status).toBe(200)
    expect(mocks.createTable.mock.calls[0][0]).toMatchObject({
      principal: {
        kind: 'system',
        serviceId: 'schedule',
        workspaceId: 'workspace-canonical',
      },
      input: { workspaceId: 'workspace-canonical' },
    })
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('validates the contract before executing the create use case', async () => {
    const response = await post({
      workspaceId: 'workspace-1',
      name: 'people',
      folderId: '',
      schema: { columns: [{ name: 'name', type: 'string' }] },
    })

    expect(response.status).toBe(400)
    expect(mocks.createTable).not.toHaveBeenCalled()
  })

  it('lists through the shared use case and preserves the table list projection', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/table?workspaceId=workspace-1'),
      {}
    )

    expect(response.status).toBe(200)
    expect(mocks.listTables.mock.calls[0][0].input).toMatchObject({
      workspaceId: 'workspace-1',
    })
    expect((await response.json()).data).toMatchObject({ totalCount: 1 })
  })
})
