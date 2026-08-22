/**
 * @vitest-environment node
 */
import { authMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  admitCreate: vi.fn(),
  createFile: vi.fn(),
  listFiles: vi.fn(),
  captureServerEvent: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/create-workspace-file', () => ({
  admitCreateWorkspaceFile: mocks.admitCreate,
  createWorkspaceFile: {
    operation: { id: 'files.create', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.createFile,
  },
}))

vi.mock('@/lib/workspace-files/application/list-workspace-files', () => ({
  listAllWorkspaceFiles: {
    operation: { id: 'files.list', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mocks.listFiles,
  },
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.captureServerEvent }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET, POST } from '@/app/api/workspaces/[id]/files/route'

const WORKSPACE_ID = 'workspace-1'
const USER = { id: 'user-1', name: 'Test User', email: 'test@sim.ai' }
const PRINCIPAL = { kind: 'session' as const, userId: USER.id, sessionId: 'session-1' }
const FILE = {
  id: 'wf_1',
  workspaceId: WORKSPACE_ID,
  name: 'notes.md',
  key: `workspace/${WORKSPACE_ID}/notes.md`,
  path: '/api/files/serve/notes.md?context=workspace',
  size: 0,
  type: 'text/markdown',
  uploadedBy: USER.id,
  folderId: null,
  uploadedAt: new Date('2026-08-04T00:00:00.000Z'),
  updatedAt: new Date('2026-08-04T00:00:00.000Z'),
}
const context = { params: Promise.resolve({ id: WORKSPACE_ID }) }

function createRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/workspaces/${WORKSPACE_ID}/files`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('/api/workspaces/[id]/files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: USER, session: { id: 'session-1' } })
    mocks.admitCreate.mockResolvedValue(undefined)
    mocks.createFile.mockResolvedValue({ file: FILE })
    mocks.listFiles.mockResolvedValue({ files: [FILE] })
  })

  it('lists files through the shared read operation', async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/files?scope=archived`
    )
    const response = await GET(request, context)

    expect(response.status).toBe(200)
    expect((await response.json()).files).toHaveLength(1)
    expect(mocks.listFiles).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, scope: 'archived' },
      request,
    })
  })

  it('authenticates before create admission or body parsing', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const response = await POST(createRequest('{not-json'), context)

    expect(response.status).toBe(401)
    expect(mocks.admitCreate).not.toHaveBeenCalled()
    expect(mocks.createFile).not.toHaveBeenCalled()
  })

  it('authorizes the asserted workspace before buffering the create body', async () => {
    mocks.admitCreate.mockRejectedValue(
      new OrchestrationError('forbidden', 'Insufficient workspace permissions')
    )

    const response = await POST(createRequest('{not-json'), context)

    expect(response.status).toBe(403)
    expect(mocks.admitCreate).toHaveBeenCalledWith(PRINCIPAL, WORKSPACE_ID)
    expect(mocks.createFile).not.toHaveBeenCalled()
  })

  it('rejects malformed base64 after admission', async () => {
    const response = await POST(
      createRequest({ name: 'notes.md', content: 'not-base64!', encoding: 'base64' }),
      context
    )

    expect(response.status).toBe(400)
    expect(mocks.admitCreate).toHaveBeenCalled()
    expect(mocks.createFile).not.toHaveBeenCalled()
  })

  it('creates through the shared use case and preserves internal analytics', async () => {
    const request = createRequest({ name: 'notes.md', content: 'TQ==', encoding: 'base64' })
    const response = await POST(request, context)

    expect(response.status).toBe(201)
    expect((await response.json()).file.id).toBe(FILE.id)
    expect(mocks.createFile).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE_ID,
        name: 'notes.md',
        contentType: 'text/markdown',
        content: 'TQ==',
        encoding: 'base64',
        folderId: undefined,
        exactName: false,
      },
      request,
    })
    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      USER.id,
      'file_uploaded',
      { workspace_id: WORKSPACE_ID, file_type: 'text/markdown' },
      { groups: { workspace: WORKSPACE_ID } }
    )
  })

  it('renders typed create conflicts without exposing unknown errors', async () => {
    mocks.createFile.mockRejectedValueOnce(new OrchestrationError('conflict', 'Name exists'))
    const conflict = await POST(createRequest({ name: 'notes.md' }), context)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({ error: 'Name exists' })

    mocks.createFile.mockRejectedValueOnce(new Error('database details'))
    const unexpected = await POST(createRequest({ name: 'notes.md' }), context)
    expect(unexpected.status).toBe(500)
    expect(await unexpected.json()).toEqual({
      error: 'Internal server error',
    })
  })
})
