/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockAssertAppPermission,
  mockRateLimit,
  mockExecute,
  mockSelect,
  mockLimit,
  mockRelease,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockAssertAppPermission: vi.fn(),
  mockRateLimit: vi.fn(),
  mockExecute: vi.fn(),
  mockSelect: vi.fn(),
  mockLimit: vi.fn(),
  mockRelease: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: { select: mockSelect } }))
vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/apps/permissions', () => ({ assertAppPermission: mockAssertAppPermission }))
vi.mock('@/lib/apps/rate-limit', () => ({
  enforceAppsPreviewActionRateLimit: mockRateLimit,
}))
vi.mock('@/lib/apps/execute-deployed-action', () => ({ executeDeployedAction: mockExecute }))
vi.mock('@/lib/core/admission/gate', () => ({
  tryAdmit: () => ({ release: mockRelease }),
  admissionRejectedResponse: vi.fn(),
}))

import { POST } from '@/app/api/apps/[projectId]/preview/execute/route'

function request(confirmed = false) {
  return new NextRequest('http://localhost/api/apps/project-1/preview/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'session-1',
      actionId: 'main',
      input: {},
      confirmed,
    }),
  })
}

function callPost(confirmed = false) {
  return POST(request(confirmed), { params: Promise.resolve({ projectId: 'project-1' }) })
}

const project = { id: 'project-1', workspaceId: 'ws-1' }
const workspace = { id: 'ws-1', archivedAt: null }
const preview = {
  id: 'session-1',
  projectId: 'project-1',
  userId: 'user-1',
  revisionId: 'revision-1',
  startedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  stoppedAt: null,
}
const action = {
  actionId: 'main',
  workflowId: 'workflow-1',
  deploymentVersionId: '__sim_draft_binding__',
  inputSchema: { type: 'object', additionalProperties: false },
  outputAllowlist: [],
  executionPolicy: 'sync',
  readOnly: false,
  schemaHash: 'stored-hash',
}

describe('POST /api/apps/[projectId]/preview/execute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAssertAppPermission.mockResolvedValue({ ok: true })
    mockRateLimit.mockResolvedValue(null)
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: mockLimit }),
      }),
    })
  })

  it('rejects a side-effectful action without independent confirmation', async () => {
    mockLimit
      .mockResolvedValueOnce([project])
      .mockResolvedValueOnce([workspace])
      .mockResolvedValueOnce([preview])
      .mockResolvedValueOnce([action])

    const response = await callPost(false)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Explicit confirmation is required for this preview action',
      code: 'PREVIEW_CONFIRMATION_REQUIRED',
    })
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockRelease).toHaveBeenCalledTimes(1)
  })

  it('allows read-only actions without a confirmation prompt', async () => {
    mockLimit
      .mockResolvedValueOnce([project])
      .mockResolvedValueOnce([workspace])
      .mockResolvedValueOnce([preview])
      .mockResolvedValueOnce([{ ...action, readOnly: true }])
      .mockResolvedValueOnce([
        { id: 'workflow-1', userId: 'owner-1', workspaceId: 'ws-1', archivedAt: null },
      ])
    mockExecute.mockResolvedValue({
      success: true,
      executionId: 'execution-1',
      outputs: {},
    })

    const response = await callPost(false)

    expect(response.status).toBe(200)
    expect(mockExecute).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the preview limiter rejects the request', async () => {
    mockLimit.mockResolvedValueOnce([project]).mockResolvedValueOnce([workspace])
    mockRateLimit.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 })
    )

    const response = await callPost(true)

    expect(response.status).toBe(429)
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
