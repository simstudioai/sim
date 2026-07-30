/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockIsFeatureEnabled, mockResolve, mockDeriveEntry } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockResolve: vi.fn(),
  mockDeriveEntry: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: mockIsFeatureEnabled }))
vi.mock('@/lib/workflows/api-reference', () => ({
  resolveReadablePublication: mockResolve,
  deriveApiReferenceEntry: mockDeriveEntry,
  renderEntryMarkdown: (e: unknown) => `# ${JSON.stringify(e)}`,
}))

import { GET } from '@/app/api/workspaces/[id]/api-reference/[workflowId]/route'

const ENTRY = { workflowId: 'wf-1', name: 'Ask Biz' }

function call(params: { id: string; workflowId: string }, query = '') {
  const request = createMockRequest(
    'GET',
    undefined,
    {},
    `http://localhost/api/workspaces/${params.id}/api-reference/${params.workflowId}${query}`
  )
  return GET(request, { params: Promise.resolve(params) })
}

describe('GET workflow api-reference entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFeatureEnabled.mockResolvedValue(true)
    mockGetSession.mockResolvedValue({ user: { id: 'reader-1' } })
    mockDeriveEntry.mockResolvedValue(ENTRY)
    mockResolve.mockResolvedValue({
      workflowRow: { id: 'wf-1', name: 'Ask Biz', isPublicApi: false },
      publication: { exposeTrace: 'off', exposeBlocks: false },
      workspaceId: 'ws-A',
    })
  })

  it('returns the entry for an authorized org-member reader', async () => {
    const res = await call({ id: 'ws-A', workflowId: 'wf-1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject(ENTRY)
  })

  it('404 (not 403) when the publication is not readable (unpublished / non-member / allowlist miss)', async () => {
    mockResolve.mockResolvedValue(null)
    const res = await call({ id: 'ws-A', workflowId: 'wf-1' })
    expect(res.status).toBe(404)
  })

  it('404 when the workflow does not live in the requested workspace', async () => {
    mockResolve.mockResolvedValue({
      workflowRow: { id: 'wf-1', name: 'x', isPublicApi: false },
      publication: {},
      workspaceId: 'ws-OTHER',
    })
    const res = await call({ id: 'ws-A', workflowId: 'wf-1' })
    expect(res.status).toBe(404)
  })

  it('404 when the feature flag is off (feature hidden)', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    const res = await call({ id: 'ws-A', workflowId: 'wf-1' })
    expect(res.status).toBe(404)
  })

  it('401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await call({ id: 'ws-A', workflowId: 'wf-1' })
    expect(res.status).toBe(401)
  })

  it('renders markdown when format=markdown', async () => {
    const res = await call({ id: 'ws-A', workflowId: 'wf-1' }, '?format=markdown')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
  })
})
