import { createRouteContext } from '@sim/testing/helpers/http'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
}))

vi.mock('@/lib/credential-groups/application/manage-groups', () => ({
  getWorkspaceAccountsSettings: {
    operation: { id: 'credential_groups.workspace.read' },
    execute: mocks.list,
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/workspaces/[id]/credential-groups/route'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const context = createRouteContext({ id: WORKSPACE_ID })

function createRequest(): NextRequest {
  return createMockRequest({
    url: `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/credential-groups`,
  })
}

describe('credential groups collection route', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mocks.list.mockResolvedValue({ credentialGroup: null, availableProviders: ['gmail'] })
  })

  it('preserves concealed entitlement failures from the application boundary', async () => {
    mocks.list.mockRejectedValue(
      new OrchestrationError('not_found', 'Credential Groups are not available')
    )

    const response = await GET(createRequest(), context)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Credential Groups are not available' })
  })
})
