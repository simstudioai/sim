import { createRouteContext } from '@sim/testing/helpers/http'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/credential-groups/application/manage-access', () => ({
  readCredentialGroupAccess: {
    operation: { id: 'credential_groups.access.read' },
    execute: mocks.read,
  },
  updateCredentialGroupAccess: {
    operation: { id: 'credential_groups.access.update' },
    execute: mocks.update,
  },
}))

import { PUT } from '@/app/api/workspaces/[id]/credential-groups/[groupId]/access/route'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const GROUP_ID = 'group-1'
const url = `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/credential-groups/${GROUP_ID}/access`
const context = createRouteContext({ id: WORKSPACE_ID, groupId: GROUP_ID })
describe('Credential Group access route', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'admin-1' },
      session: { id: 'session-1' },
    })
    mocks.update.mockResolvedValue({
      revision: 2,
      allowedWorkflowIds: ['workflow-1', 'workflow-2'],
    })
  })

  it('rejects an oversized access payload before parsing it', async () => {
    const body = JSON.stringify({
      expectedRevision: 1,
      allowedWorkflowIds: [],
      padding: 'x'.repeat(40_000),
    })
    const request = createMockRequest({
      method: 'PUT',
      url,
      rawBody: body,
      headers: {
        'content-length': String(Buffer.byteLength(body)),
        'content-type': 'application/json',
      },
    })

    const response = await PUT(request, context)

    expect(response.status).toBe(413)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
