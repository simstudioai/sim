/** @vitest-environment node */
import { credential, slackSearchInstallation, slackSearchTurn } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ app: vi.fn() }))
vi.mock('@/lib/slack-search/app-configuration', () => ({ loadSlackAppConfiguration: m.app }))

import { revokeSlackSearchAccess } from '@/lib/knowledge/application/slack-search/lifecycle'

const principal = {
  kind: 'slack_app',
  appId: 'A1',
  appRevision: 'r1',
  receivedAt: new Date(),
} as const
const input = {
  type: 'event_callback',
  api_app_id: 'A1',
  team_id: 'T1',
  event_id: 'Ev1',
  event_time: Math.floor(Date.now() / 1000),
  event: { type: 'app_uninstalled' },
} as const
beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  m.app.mockResolvedValue({
    app: { id: 'A1', kind: 'shared', revision: 'r1', organizationId: null },
  })
  queueTableRows(slackSearchInstallation, [
    {
      id: 'i1',
      organizationId: 'org',
      appId: 'A1',
      teamId: 'T1',
      botUserId: 'UBOT',
      updatedAt: new Date(1),
    },
  ])
})
describe('Slack access revocation', () => {
  it('disables the bot and cancels queued and running work on uninstall', async () => {
    await revokeSlackSearchAccess.execute({ principal, input })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, lastOutcome: 'app_uninstalled' })
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled', outcome: 'access_revoked' })
    )
  })
  it('cancels only affected members without rotating the shared installation revision', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ providerSubjectId: 'U1' }])
    await revokeSlackSearchAccess.execute({
      principal,
      input: { ...input, event: { type: 'tokens_revoked', tokens: { oauth: ['U1', 'U2'] } } },
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ managedOauthStatus: 'needs_reauth' })
    )
    expect(dbChainMockFns.update.mock.calls.map(([table]) => table)).toEqual([
      credential,
      slackSearchTurn,
    ])
    expect(dbChainMockFns.where).toHaveBeenLastCalledWith({
      type: 'and',
      conditions: [
        { type: 'eq', left: slackSearchTurn.installationId, right: 'i1' },
        { type: 'inArray', column: slackSearchTurn.status, values: ['pending', 'running'] },
        {
          type: 'inArray',
          column: expect.objectContaining({
            strings: ['', " #>> '{message,userId}'"],
            values: [slackSearchTurn.payload],
          }),
          values: ['U1'],
        },
      ],
    })
    expect(dbChainMockFns.where).toHaveBeenNthCalledWith(2, {
      type: 'and',
      conditions: expect.arrayContaining([
        { type: 'eq', left: credential.organizationId, right: 'org' },
        { type: 'eq', left: credential.authorizationAppId, right: 'slack:A1:T1' },
        { type: 'inArray', column: credential.providerSubjectId, values: ['U1', 'U2'] },
        {
          type: 'or',
          conditions: [
            { type: 'isNull', column: credential.grantedAt },
            {
              type: 'lte',
              left: credential.grantedAt,
              right: new Date(input.event_time * 1000),
            },
          ],
        },
      ]),
    })
  })
  it('does not cancel work when no current member grants were revoked', async () => {
    await revokeSlackSearchAccess.execute({
      principal,
      input: { ...input, event: { type: 'tokens_revoked', tokens: { oauth: ['U1'] } } },
    })
    expect(dbChainMockFns.update.mock.calls.map(([table]) => table)).toEqual([credential])
  })
  it.each([{ bot: ['UBOT'] }, { bot: ['UBOT'], oauth: ['U1'] }])(
    'cancels all installation work when its bot is revoked: %j',
    async (tokens) => {
      await revokeSlackSearchAccess.execute({
        principal,
        input: { ...input, event: { type: 'tokens_revoked', tokens } },
      })
      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false, revision: expect.any(String) })
      )
      expect(dbChainMockFns.where).toHaveBeenLastCalledWith({
        type: 'and',
        conditions: [
          { type: 'eq', left: slackSearchTurn.installationId, right: 'i1' },
          { type: 'inArray', column: slackSearchTurn.status, values: ['pending', 'running'] },
        ],
      })
    }
  )
  it('does not invalidate the installation when a different bot token is revoked', async () => {
    await revokeSlackSearchAccess.execute({
      principal,
      input: { ...input, event: { type: 'tokens_revoked', tokens: { bot: ['OTHER'] } } },
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
  it.each([{ appId: 'A2' }, { receivedAt: new Date(0) }, { receivedAt: new Date(Number.NaN) }])(
    'rejects invalid verified authority %#',
    async (change) => {
      await expect(
        revokeSlackSearchAccess.execute({ principal: { ...principal, ...change }, input })
      ).rejects.toThrow('authority')
      expect(m.app).not.toHaveBeenCalled()
    }
  )
  it('does nothing when that app/workspace has no binding', async () => {
    resetDbChainMock()
    await revokeSlackSearchAccess.execute({ principal, input })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
  it('does not revoke a replacement installation because of a delayed uninstall', async () => {
    resetDbChainMock()
    queueTableRows(slackSearchInstallation, [
      {
        id: 'i1',
        organizationId: 'org',
        appId: 'A1',
        teamId: 'T1',
        updatedAt: new Date(Date.now() + 1000),
      },
    ])
    await revokeSlackSearchAccess.execute({ principal, input })
    expect(dbChainMockFns.set.mock.calls.some(([value]) => 'enabled' in value)).toBe(false)
  })
})
