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
  it('cancels only affected members without rotating the shared installation revision', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([
      { organizationId: 'org', providerSubjectId: 'U1' },
    ])
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
    const memberGrants = dbChainMockFns.where.mock.calls[1][0]
    expect(memberGrants.conditions).not.toContainEqual(
      expect.objectContaining({ left: credential.organizationId })
    )
    expect(dbChainMockFns.where).toHaveBeenNthCalledWith(2, {
      type: 'and',
      conditions: expect.arrayContaining([
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
  it('keeps a custom app revocation inside the installation organization', async () => {
    m.app.mockResolvedValue({
      app: { id: 'A1', kind: 'custom', revision: 'r1', organizationId: 'org' },
    })
    dbChainMockFns.returning.mockResolvedValueOnce([])
    await revokeSlackSearchAccess.execute({
      principal,
      input: { ...input, event: { type: 'tokens_revoked', tokens: { oauth: ['U1'] } } },
    })
    expect(dbChainMockFns.where).toHaveBeenNthCalledWith(2, {
      type: 'and',
      conditions: expect.arrayContaining([
        { type: 'eq', left: credential.organizationId, right: 'org' },
        { type: 'eq', left: credential.authorizationAppId, right: 'slack:A1:T1' },
      ]),
    })
  })
  it.each([
    { type: 'app_uninstalled' as const },
    { type: 'tokens_revoked' as const, tokens: { oauth: ['U1'] } },
  ])('revokes shared-app member grants in a workspace with no Search bot: %j', async (event) => {
    resetDbChainMock()
    queueTableRows(slackSearchInstallation, [])
    await revokeSlackSearchAccess.execute({ principal, input: { ...input, event } })
    expect(dbChainMockFns.update.mock.calls.map(([table]) => table)).toEqual([credential])
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ managedOauthStatus: 'needs_reauth' })
    )
    const memberGrants = dbChainMockFns.where.mock.calls[1][0]
    expect(memberGrants.conditions).toEqual(
      expect.arrayContaining([
        { type: 'eq', left: credential.type, right: 'managed_oauth' },
        { type: 'eq', left: credential.authorizationAppId, right: 'slack:A1:T1' },
        ...(event.type === 'tokens_revoked'
          ? [{ type: 'inArray', column: credential.providerSubjectId, values: ['U1'] }]
          : []),
      ])
    )
    expect(memberGrants.conditions).not.toContainEqual(
      expect.objectContaining({ left: credential.organizationId })
    )
  })
  it.each([
    { kind: 'custom', event: { type: 'app_uninstalled' as const } },
    { kind: 'shared', event: { type: 'tokens_revoked' as const, tokens: { bot: ['UBOT'] } } },
  ])(
    'leaves grants untouched with no installation for a custom app or a bot-only revocation: $kind',
    async ({ kind, event }) => {
      resetDbChainMock()
      m.app.mockResolvedValue({
        app: { id: 'A1', kind, revision: 'r1', organizationId: kind === 'custom' ? 'org' : null },
      })
      queueTableRows(slackSearchInstallation, [])
      await revokeSlackSearchAccess.execute({ principal, input: { ...input, event } })
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    }
  )
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
  const queueReinstalledBot = () => {
    resetDbChainMock()
    queueTableRows(slackSearchInstallation, [
      {
        id: 'i1',
        organizationId: 'org',
        appId: 'A1',
        teamId: 'T1',
        botUserId: 'UBOT',
        updatedAt: new Date(input.event_time * 1000 + 1000),
      },
    ])
  }
  it('ignores a stale bot revocation before any writes', async () => {
    queueReinstalledBot()
    await revokeSlackSearchAccess.execute({
      principal,
      input: { ...input, event: { type: 'tokens_revoked', tokens: { bot: ['UBOT'] } } },
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
  it('keeps a reinstalled bot but revokes shared-app grants issued before a stale uninstall', async () => {
    queueReinstalledBot()
    await revokeSlackSearchAccess.execute({ principal, input })
    expect(dbChainMockFns.update.mock.calls.map(([table]) => table)).toEqual([credential])
    const memberGrants = dbChainMockFns.where.mock.calls[1][0]
    expect(memberGrants.conditions).toEqual(
      expect.arrayContaining([
        { type: 'eq', left: credential.authorizationAppId, right: 'slack:A1:T1' },
        {
          type: 'or',
          conditions: [
            { type: 'isNull', column: credential.grantedAt },
            { type: 'lte', left: credential.grantedAt, right: new Date(input.event_time * 1000) },
          ],
        },
      ])
    )
    expect(memberGrants.conditions).not.toContainEqual(
      expect.objectContaining({ left: credential.organizationId })
    )
  })
  it('cancels stale-uninstall turns only for members revoked in the installation organization', async () => {
    queueReinstalledBot()
    dbChainMockFns.returning.mockResolvedValueOnce([
      { organizationId: 'org', providerSubjectId: 'U1' },
      { organizationId: 'other-org', providerSubjectId: 'U2' },
    ])
    await revokeSlackSearchAccess.execute({ principal, input })
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
  })
  it('ignores a stale custom-app uninstall before any writes', async () => {
    m.app.mockResolvedValue({
      app: { id: 'A1', kind: 'custom', revision: 'r1', organizationId: 'org' },
    })
    queueReinstalledBot()
    await revokeSlackSearchAccess.execute({ principal, input })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
  it.each([{ oauth: ['U1'] }, { oauth: ['U1'], bot: ['UBOT'] }])(
    'revokes matching member grants independently of a newer bot installation: %j',
    async (tokens) => {
      resetDbChainMock()
      queueTableRows(slackSearchInstallation, [
        {
          id: 'i1',
          organizationId: 'org',
          appId: 'A1',
          teamId: 'T1',
          botUserId: 'UBOT',
          updatedAt: new Date(input.event_time * 1000 + 1000),
        },
      ])
      dbChainMockFns.returning.mockResolvedValueOnce([
        { organizationId: 'org', providerSubjectId: 'U1' },
      ])
      await revokeSlackSearchAccess.execute({
        principal,
        input: { ...input, event: { type: 'tokens_revoked', tokens } },
      })
      expect(dbChainMockFns.update.mock.calls.map(([table]) => table)).toEqual([
        credential,
        slackSearchTurn,
      ])
      expect(dbChainMockFns.where).toHaveBeenLastCalledWith(
        expect.objectContaining({
          conditions: expect.arrayContaining([
            {
              type: 'inArray',
              column: expect.objectContaining({
                strings: ['', " #>> '{message,userId}'"],
                values: [slackSearchTurn.payload],
              }),
              values: ['U1'],
            },
          ]),
        })
      )
    }
  )
})
