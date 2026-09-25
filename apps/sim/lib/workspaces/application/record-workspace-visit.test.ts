import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  context: vi.fn(),
  record: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/platform-authz/workspace')>()),
  resolveEffectiveWorkspacePermission: mocks.role,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.context,
}))
vi.mock('@/lib/workspaces/visits', () => ({ recordWorkspaceVisitRecord: mocks.record }))

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { recordWorkspaceVisit } from '@/lib/workspaces/application/record-workspace-visit'

const session = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const

describe('recordWorkspaceVisit', () => {
  beforeEach(() => {
    mocks.context.mockImplementation(async (workspaceId: string) => ({
      workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
    }))
    mocks.role.mockResolvedValue('read')
    mocks.record.mockResolvedValue(undefined)
  })

  it('refuses a workspace the user cannot reach without recording anything', async () => {
    mocks.role.mockResolvedValue(null)

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
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.record).not.toHaveBeenCalled()
  })
})
