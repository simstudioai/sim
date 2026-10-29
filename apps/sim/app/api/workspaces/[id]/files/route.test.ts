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
import { GET, POST } from '@/app/api/workspaces/[id]/files/route'

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

  describe('GET', () => {
    const list = (query: string) =>
      GET(
        createMockRequest({ method: 'GET', url: `/api/workspaces/${WORKSPACE_ID}/files${query}` }),
        context
      )
    const collection = workspaceFilesListMockFns.mockListWorkspaceFileCollection

    it('keeps the unpaged response, without a cursor, when no paging param is sent', async () => {
      collection.mockResolvedValueOnce({ files: [FILE], nextKeys: null })

      const response = await list('?scope=active')

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toEqual({ success: true, files: [expect.objectContaining({ id: FILE.id })] })
      expect(collection.mock.calls[0][0].input).toEqual({
        workspaceId: WORKSPACE_ID,
        scope: 'active',
      })
    })

    it('resumes from its own cursor and refuses it under another folder', async () => {
      collection.mockResolvedValue({ files: [FILE], nextKeys: ['notes.md', FILE.id] })

      const first = await (await list('?folderId=root&sortBy=name&limit=1')).json()
      expect(collection.mock.calls[0][0].input.page).toMatchObject({
        folderId: null,
        after: undefined,
      })
      expect(first.nextCursor).toEqual(expect.any(String))

      const resumed = await list(`?folderId=root&sortBy=name&limit=1&cursor=${first.nextCursor}`)
      expect(resumed.status).toBe(200)
      expect(collection.mock.calls[1][0].input.page.after).toEqual(['notes.md', FILE.id])

      const moved = await list(`?folderId=folder-2&sortBy=name&limit=1&cursor=${first.nextCursor}`)
      expect(moved.status).toBe(400)
      expect(collection).toHaveBeenCalledTimes(2)
    })

    it('binds its cursor to the search and set filters, whatever order the sets are spelled in', async () => {
      collection.mockResolvedValue({ files: [FILE], nextKeys: ['notes.md', FILE.id] })
      const filtered =
        '?sortBy=name&limit=1&q=notes&types=image,document&sizes=small&uploadedBy=u1,u2'

      const first = await (await list(filtered)).json()
      expect(collection.mock.calls[0][0].input.page).toMatchObject({
        search: 'notes',
        kinds: ['document', 'image'],
        sizeBuckets: ['small'],
        uploadedBy: ['u1', 'u2'],
      })

      const respelled = await list(
        `?sortBy=name&limit=1&q=notes&types=document,image,image&sizes=small&uploadedBy=u2,u1&cursor=${first.nextCursor}`
      )
      expect(respelled.status).toBe(200)

      for (const changed of [
        'q=other&types=image,document&sizes=small&uploadedBy=u1,u2',
        'q=notes&types=image&sizes=small&uploadedBy=u1,u2',
        'q=notes&types=image,document&sizes=large&uploadedBy=u1,u2',
        'q=notes&types=image,document&sizes=small&uploadedBy=u1',
        'q=notes&types=image,document&sizes=small&uploadedBy=u1,u2&folderId=root&recursive=true',
      ]) {
        const refiltered = await list(`?sortBy=name&limit=1&${changed}&cursor=${first.nextCursor}`)
        expect(refiltered.status).toBe(400)
      }
      expect(collection).toHaveBeenCalledTimes(2)
    })

    it('rejects a kind or size bucket the list does not know', async () => {
      expect((await list('?types=spreadsheet')).status).toBe(400)
      expect((await list('?sizes=huge')).status).toBe(400)
      expect(collection).not.toHaveBeenCalled()
    })
  })
})
