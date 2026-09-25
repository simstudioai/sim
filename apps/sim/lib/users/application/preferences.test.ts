import type { SubjectDelegatedPrincipal } from '@sim/auth/principal'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/lib/users/application/preferences-authorization', () => ({
  authorizeAccountPreferences: mocks.authorize,
}))
vi.mock('@/lib/mothership/server/agent-url', () => ({ invalidateSuperUserGate: mocks.invalidate }))

import {
  delegatedAccountPreferencesSchema,
  updateCurrentUserPreferences,
} from '@/lib/users/application/preferences'

const delegated: SubjectDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'copilot',
  subjectUserId: 'actor',
  workspaceId: 'workspace',
  delegationId: 'call',
  audience: 'sim:settings',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 1000),
  resourceScope: { chatId: 'chat' },
}

describe('account preference mutations', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.authorize.mockResolvedValue('actor')
  })
  it.each([
    'superUserModeEnabled',
    'mothershipEnvironment',
    'copilotAutoAllowedTools',
    'lastActiveWorkspaceId',
  ])('keeps %s outside delegated preference input', (field) => {
    expect(delegatedAccountPreferencesSchema.safeParse({ [field]: true }).success).toBe(false)
  })
  it('rejects privileged fields even when called without the tool boundary', async () => {
    await expect(
      updateCurrentUserPreferences.execute({
        principal: delegated,
        input: { superUserModeEnabled: true },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
  it('leaves existing saved preferences out of the conflict-update patch', async () => {
    await updateCurrentUserPreferences.execute({
      principal: delegated,
      input: { timezone: 'UTC' },
    })
    const conflict = dbChainMockFns.onConflictDoUpdate.mock.calls[0][0]
    expect(conflict.set).toEqual({ timezone: 'UTC', updatedAt: expect.any(Date) })
  })
})
