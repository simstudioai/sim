/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockIsFeatureEnabled, mockResolve, mockRedact, mockLoadDeployed } =
  vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockIsFeatureEnabled: vi.fn(),
    mockResolve: vi.fn(),
    mockRedact: vi.fn(),
    mockLoadDeployed: vi.fn(),
  }))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: mockIsFeatureEnabled }))
vi.mock('@/lib/workflows/api-reference', () => ({
  resolveReadablePublication: mockResolve,
  redactBlocks: mockRedact,
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadDeployedWorkflowState: mockLoadDeployed,
}))

import { GET } from '@/app/api/workspaces/[id]/api-reference/[workflowId]/blocks/route'

function call(params: { id: string; workflowId: string }) {
  const request = createMockRequest(
    'GET',
    undefined,
    {},
    `http://localhost/api/workspaces/${params.id}/api-reference/${params.workflowId}/blocks`
  )
  return GET(request, { params: Promise.resolve(params) })
}

function readable(overrides: Record<string, unknown> = {}) {
  return {
    workflowRow: { id: 'wf-1' },
    publication: { exposeBlocks: true, ...overrides },
    workspaceId: 'ws-A',
  }
}

describe('GET api-reference blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFeatureEnabled.mockResolvedValue(true)
    mockGetSession.mockResolvedValue({ user: { id: 'reader-1' } })
    mockLoadDeployed.mockResolvedValue({ blocks: {}, edges: [] })
    mockRedact.mockReturnValue([{ id: 'b1', type: 'agent', name: 'A', outgoing: [], config: {} }])
    mockResolve.mockResolvedValue(readable())
  })

  it('returns redacted blocks when exposeBlocks is on', async () => {
    const res = await call({ id: 'ws-A', workflowId: 'wf-1' })
    expect(res.status).toBe(200)
    expect((await res.json()).blocks).toHaveLength(1)
  })

  it('404 when exposeBlocks is off (default-deny)', async () => {
    mockResolve.mockResolvedValue(readable({ exposeBlocks: false }))
    const res = await call({ id: 'ws-A', workflowId: 'wf-1' })
    expect(res.status).toBe(404)
    expect(mockRedact).not.toHaveBeenCalled()
  })

  it('404 when the publication is not readable', async () => {
    mockResolve.mockResolvedValue(null)
    const res = await call({ id: 'ws-A', workflowId: 'wf-1' })
    expect(res.status).toBe(404)
  })

  it('404 when the workflow is in a different workspace than the URL', async () => {
    mockResolve.mockResolvedValue({ ...readable(), workspaceId: 'ws-OTHER' })
    const res = await call({ id: 'ws-A', workflowId: 'wf-1' })
    expect(res.status).toBe(404)
  })
})
