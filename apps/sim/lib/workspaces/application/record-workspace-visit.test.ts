import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/workspaces/visits', () => ({ recordWorkspaceVisitRecord: mocks.record }))

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { recordWorkspaceVisit } from '@/lib/workspaces/application/record-workspace-visit'

const role = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const context = workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext
const session = createSessionPrincipal()

describe('recordWorkspaceVisit', () => {
  beforeEach(() => {
    role.mockResolvedValue('read')
    mocks.record.mockResolvedValue(undefined)
  })

  it('refuses a workspace the user cannot reach without recording anything', async () => {
    role.mockResolvedValue(null)

    await expect(
      recordWorkspaceVisit.execute({ principal: session, input: { workspaceId: 'ws-1' } })
    ).rejects.toBeInstanceOf(NoWorkspaceAccessError)
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it('rejects API-key principals before loading the workspace', async () => {
    const apiKey = { kind: 'personal_api_key', keyId: 'key-1', userId: 'user-1' }

    await expect(
      recordWorkspaceVisit.execute({
        // @ts-expect-error the operation's principal type excludes API keys
        principal: apiKey,
        input: { workspaceId: 'ws-1' },
      })
    ).rejects.toThrow('cannot perform operation workspaces.visits.record')
    expect(context).not.toHaveBeenCalled()
    expect(mocks.record).not.toHaveBeenCalled()
  })
})
