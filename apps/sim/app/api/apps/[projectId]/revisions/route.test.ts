/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSelect,
  mockGetSession,
  mockPermission,
  mockBuildBoundAction,
  mockLoadRevisionSnapshot,
  mockCreateRevision,
  mockStopPreviewSession,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockGetSession: vi.fn(),
  mockPermission: vi.fn(),
  mockBuildBoundAction: vi.fn(),
  mockLoadRevisionSnapshot: vi.fn(),
  mockCreateRevision: vi.fn(),
  mockStopPreviewSession: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: { select: mockSelect } }))
vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/apps/permissions', () => ({ assertAppPermission: mockPermission }))
vi.mock('@/lib/apps/bind-actions', () => ({ buildBoundActionEntry: mockBuildBoundAction }))
vi.mock('@/lib/apps/revision-snapshot', () => ({
  loadRevisionSnapshot: mockLoadRevisionSnapshot,
}))
vi.mock('@/lib/apps/revisions', () => ({ createRevisionWithActions: mockCreateRevision }))
vi.mock('@/lib/apps/pins', () => ({ stopPreviewSession: mockStopPreviewSession }))

import { POST } from '@/app/api/apps/[projectId]/revisions/route'

function selectWithLimit(value: unknown) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(value),
      }),
    }),
  }
}

function request() {
  return new NextRequest('http://localhost/api/apps/project-1/revisions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      actions: [
        {
          actionId: 'main',
          workflowId: 'workflow-1',
          deploymentVersionId: 'version-1',
          outputAllowlist: [],
          executionPolicy: 'sync',
        },
      ],
    }),
  })
}

describe('POST /api/apps/[projectId]/revisions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockPermission.mockResolvedValue({ ok: true })
    mockBuildBoundAction.mockResolvedValue({
      ok: true,
      action: {
        actionId: 'main',
        workflowId: 'workflow-1',
        deploymentVersionId: 'version-1',
        inputSchema: { type: 'object', properties: {} },
        outputAllowlist: [],
        executionPolicy: 'sync',
        schemaHash: 'hash-1',
      },
    })
    mockLoadRevisionSnapshot.mockResolvedValue({
      files: {
        'src/App.tsx': 'export function App() { return <button>Custom UI</button> }',
        'src/styles.css': 'button { color: blue }',
      },
      actions: [],
    })
    mockCreateRevision.mockResolvedValue({ revisionId: 'revision-2' })
    mockStopPreviewSession.mockResolvedValue(undefined)
  })

  it('preserves current source when changing action bindings', async () => {
    mockSelect
      .mockReturnValueOnce(
        selectWithLimit([
          {
            id: 'project-1',
            workspaceId: 'workspace-1',
            draftRevisionId: 'revision-1',
          },
        ])
      )
      .mockReturnValueOnce(selectWithLimit([{ id: 'workflow-1' }]))
      .mockReturnValueOnce({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      })

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockLoadRevisionSnapshot).toHaveBeenCalledWith('project-1', 'revision-1')
    expect(mockCreateRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        files: {
          'src/App.tsx': 'export function App() { return <button>Custom UI</button> }',
          'src/styles.css': 'button { color: blue }',
        },
        parentRevisionId: 'revision-1',
        expectedRevisionId: 'revision-1',
      })
    )
  })
})
