/**
 * @vitest-environment node
 */
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
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  recordWorkspaceVisit,
  workspaceVisitOperations,
} from '@/lib/workspaces/application/record-workspace-visit'

const session = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const

describe('recordWorkspaceVisit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.context.mockImplementation(async (workspaceId: string) => ({
      workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
    }))
    mocks.role.mockResolvedValue('read')
    mocks.record.mockResolvedValue(undefined)
  })

  it('accepts only signed-in sessions at the lowest workspace role', () => {
    expect(workspaceVisitOperations.record).toMatchObject({
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      principalKinds: ['session'],
    })
  })

  it('records the visit for the acting user in the canonical workspace', async () => {
    await recordWorkspaceVisit.execute({ principal: session, input: { workspaceId: 'ws-1' } })

    expect(mocks.record).toHaveBeenCalledWith('user-1', 'ws-1')
  })

  it('refuses a workspace the user cannot reach without recording anything', async () => {
    mocks.role.mockResolvedValue(null)

    await expect(
      recordWorkspaceVisit.execute({ principal: session, input: { workspaceId: 'ws-1' } })
    ).rejects.toBeInstanceOf(NoWorkspaceAccessError)
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it('surfaces a missing or archived workspace as not found', async () => {
    mocks.context.mockRejectedValue(new OrchestrationError('not_found', 'Workspace not found'))

    await expect(
      recordWorkspaceVisit.execute({ principal: session, input: { workspaceId: 'gone' } })
    ).rejects.toMatchObject({ code: 'not_found' })
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
