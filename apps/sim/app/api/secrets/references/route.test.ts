/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listReferences: vi.fn() }))

vi.mock('@/lib/secrets/application/use-cases', () => ({
  listSecretReferencesUseCase: {
    operation: { id: 'secrets.references' },
    execute: mocks.listReferences,
  },
}))

import { GET } from '@/app/api/secrets/references/route'

const url = 'http://localhost/api/secrets/references?workspaceId=workspace-1&name=API_KEY'

describe('GET /api/secrets/references', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'admin-1' },
      session: { id: 'session-1' },
    })
  })

  it('returns the workflows, blocks, and resources a secret is wired into', async () => {
    mocks.listReferences.mockResolvedValue({
      workflows: [
        {
          workflowId: 'workflow-1',
          workflowName: 'Nightly sync',
          blocks: [
            { blockId: 'block-1', blockName: 'Fetch orders', blockType: 'api', field: 'apiKey' },
          ],
        },
      ],
      resources: [{ id: 'tool-1', kind: 'custom-tool', name: 'Order lookup', field: 'code' }],
      truncated: false,
    })

    const response = await GET(createMockRequest('GET', undefined, {}, url))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      workflows: [
        {
          workflowId: 'workflow-1',
          workflowName: 'Nightly sync',
          blocks: [
            { blockId: 'block-1', blockName: 'Fetch orders', blockType: 'api', field: 'apiKey' },
          ],
        },
      ],
      resources: [{ id: 'tool-1', kind: 'custom-tool', name: 'Order lookup', field: 'code' }],
      truncated: false,
    })
  })

  it('returns empty lists for a secret referenced nowhere', async () => {
    mocks.listReferences.mockResolvedValue({ workflows: [], resources: [], truncated: false })

    const response = await GET(createMockRequest('GET', undefined, {}, url))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ workflows: [], resources: [], truncated: false })
  })

  it('rejects a request that names no secret', async () => {
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost/api/secrets/references?workspaceId=workspace-1'
      )
    )

    expect(response.status).toBe(400)
    expect(mocks.listReferences).not.toHaveBeenCalled()
  })

  /**
   * The contract carries no `scope`. It used to, and because a reference scan is name-based and
   * never narrowed by scope, asserting `personal` skipped the admin gate outright — a member
   * could read the reference map for any workspace secret. A stray `scope` must therefore reach
   * neither the gate nor the scan.
   */
  it('ignores a scope the caller tries to assert', async () => {
    mocks.listReferences.mockResolvedValue({ workflows: [], resources: [], truncated: false })

    const response = await GET(createMockRequest('GET', undefined, {}, `${url}&scope=personal`))

    expect(response.status).toBe(200)
    expect(mocks.listReferences).toHaveBeenCalledTimes(1)
    expect(mocks.listReferences.mock.calls[0]?.[0]?.input).toEqual({
      workspaceId: 'workspace-1',
      name: 'API_KEY',
    })
  })

  /**
   * The use case gates the read behind the same permission that reveals the value. A refusal
   * has to reach the client as a refusal — surfacing it as an empty list would read as
   * "referenced nowhere" and invite deleting a live key.
   */
  it('surfaces the use case refusal rather than an empty list', async () => {
    const { ForbiddenOperationError } = await import('@/lib/core/application/forbidden')
    mocks.listReferences.mockRejectedValue(
      new ForbiddenOperationError(
        'SECRET_ADMIN_ACCESS_REQUIRED',
        'Credential admin permission required to view this secret usage'
      )
    )

    const response = await GET(createMockRequest('GET', undefined, {}, url))

    expect(response.status).toBe(403)
  })
})
