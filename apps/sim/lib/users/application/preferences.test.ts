/** @vitest-environment node */
import type { SessionPrincipal, SubjectDelegatedPrincipal } from '@sim/auth/principal'
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/lib/users/application/preferences-authorization', () => ({
  authorizeAccountPreferences: mocks.authorize,
}))
vi.mock('@/lib/mothership/server/agent-url', () => ({ invalidateSuperUserGate: mocks.invalidate }))

import {
  delegatedAccountPreferencesSchema,
  updateCurrentUserPreferences,
  updateCurrentUserProfile,
} from '@/lib/users/application/preferences'
import { getUserSettings } from '@/lib/users/queries'

const session: SessionPrincipal = { kind: 'session', userId: 'actor', sessionId: 'session' }
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
    vi.clearAllMocks()
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
  it('persists ordinary preferences for the authorized subject and preserves explicit timezone reset', async () => {
    await expect(
      updateCurrentUserPreferences.execute({
        principal: delegated,
        input: { theme: 'dark', timezone: null },
      })
    ).resolves.toEqual({ success: true })
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'actor', theme: 'dark', timezone: null })
    )
    expect(mocks.invalidate).not.toHaveBeenCalled()
  })
  it('preserves all observable defaults on a first timezone-only save', async () => {
    queueTableRows(schemaMock.settings, [])
    const before = await getUserSettings('actor')
    expect(before.superUserModeEnabled).toBe(false)
    await updateCurrentUserPreferences.execute({
      principal: delegated,
      input: { timezone: 'UTC' },
    })
    const inserted = dbChainMockFns.values.mock.calls[0][0]
    queueTableRows(schemaMock.settings, [inserted])
    expect(await getUserSettings('actor')).toEqual({ ...before, timezone: 'UTC' })
    expect(mocks.invalidate).not.toHaveBeenCalled()
  })
  it('leaves existing saved preferences out of the conflict-update patch', async () => {
    await updateCurrentUserPreferences.execute({
      principal: delegated,
      input: { timezone: 'UTC' },
    })
    const conflict = dbChainMockFns.onConflictDoUpdate.mock.calls[0][0]
    expect(conflict.set).toEqual({ timezone: 'UTC', updatedAt: expect.any(Date) })
  })
  it('preserves session-owned routing cache invalidation', async () => {
    await updateCurrentUserPreferences.execute({
      principal: session,
      input: { superUserModeEnabled: true },
    })
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({ superUserModeEnabled: true })
    )
    expect(mocks.invalidate).toHaveBeenCalledWith('actor')
  })
  it('does not report success for a failed write', async () => {
    dbChainMockFns.insert.mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })
    await expect(
      updateCurrentUserPreferences.execute({
        principal: delegated,
        input: { telemetryEnabled: false },
      })
    ).rejects.toThrow('database unavailable')
    expect(mocks.invalidate).not.toHaveBeenCalled()
  })
  it('returns authoritative profile fields and preserves removal of an image', async () => {
    dbChainMockFns.returning.mockResolvedValue([
      { id: 'actor', name: 'New', email: 'actor@example.com', image: null },
    ])
    await expect(
      updateCurrentUserProfile.execute({
        principal: delegated,
        input: { name: 'New', image: null },
      })
    ).resolves.toMatchObject({ id: 'actor', name: 'New', image: null })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New', image: null })
    )
  })
})
