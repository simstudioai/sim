import { authMockFns } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import {
  workspaceFilesListMock,
  workspaceFilesListMockFns,
} from '@sim/testing/mocks/workspace-files-list.mock'
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  admitCreate: vi.fn(),
  createFile: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/create-workspace-file', () => ({
  admitCreateWorkspaceFile: mocks.admitCreate,
  createWorkspaceFile: {
    operation: { id: 'files.create', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.createFile,
  },
}))

vi.mock('@/lib/workspace-files/application/list-workspace-files', () => workspaceFilesListMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/workspaces/[id]/files/route'

const WORKSPACE_ID = 'workspace-1'
const USER = { id: 'user-1', name: 'Test User', email: 'test@sim.ai' }
const PRINCIPAL = createSessionPrincipal({ userId: USER.id })
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
const context = createRouteContext({ id: WORKSPACE_ID })

function createRequest(body: unknown): NextRequest {
  return createMockRequest({
    method: 'POST',
    url: `/api/workspaces/${WORKSPACE_ID}/files`,
    headers: { 'content-type': 'application/json' },
    rawBody: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('/api/workspaces/[id]/files', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({ user: USER, session: { id: 'session-1' } })
    mocks.admitCreate.mockResolvedValue(undefined)
    mocks.createFile.mockResolvedValue({ file: FILE })
    workspaceFilesListMockFns.mockListAllWorkspaceFiles.mockResolvedValue({ files: [FILE] })
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
})
