/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ authorize: vi.fn(), receive: vi.fn() }))
vi.mock('@/lib/knowledge/application/slack-search/authorization', () => ({
  requireSlackInstallationPrincipal: (p: { kind: string }) => {
    if (p.kind !== 'slack_installation') throw new Error('principal')
  },
  authorizeSlackSearchInstallation: m.authorize,
}))
vi.mock('@/lib/knowledge/application/slack-search/process-message', () => ({
  receiveSlackSearchMessage: { execute: m.receive },
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://www.sim.ai' }))
vi.mock('@/lib/sim-search/connectors', () => ({
  SEARCH_CONNECTORS: [{ type: 'slack', providerId: 'slack' }],
}))

import { receiveSlackSearchCommand } from '@/lib/knowledge/application/slack-search/commands'
import { slackSearchCommandEventId, slackSearchCommandSchema } from '@/lib/slack-search/commands'

const input = {
  api_app_id: 'A1',
  team_id: 'T1',
  user_id: 'U1',
  channel_id: 'C1',
  trigger_id: 'trigger.1',
  command: '/query',
  text: 'release notes',
} as const
const principal = {
  kind: 'slack_installation',
  appId: 'A1',
  teamId: 'T1',
  eventId: slackSearchCommandEventId(input),
  credentialId: 'c1',
  credentialVersion: 'v1',
  receivedAt: new Date(),
} as const
beforeEach(() => {
  vi.clearAllMocks()
  m.authorize.mockResolvedValue({ installation: { organizationId: 'org' } })
  m.receive.mockResolvedValue('turn')
})
describe('Slack commands', () => {
  it('acknowledges durable intake without attempting a Slack send', async () => {
    await expect(receiveSlackSearchCommand.execute({ principal, input })).resolves.toMatchObject({
      response_type: 'ephemeral',
      turnId: 'turn',
    })
    expect(m.receive).toHaveBeenCalledWith({
      principal,
      input: expect.objectContaining({
        command: '/query',
        messageTs: null,
        channelId: 'C1',
        userId: 'U1',
        query: 'release notes',
      }),
    })
  })
  it('uses stable deduplication for retries and rejects forged user scope', async () => {
    expect(slackSearchCommandEventId({ ...input })).toBe(principal.eventId)
    await expect(
      receiveSlackSearchCommand.execute({ principal, input: { ...input, user_id: 'U2' } })
    ).rejects.toThrow('verified identity')
    expect(m.receive).not.toHaveBeenCalled()
  })
  it('returns an environment-correct personal connection link without OAuth state', async () => {
    const result = await receiveSlackSearchCommand.execute({
      principal,
      input: { ...input, command: '/connect', text: 'slack' },
    })
    expect(result.text).toBe(
      '<https://www.sim.ai/o/org/integrations?connectorType=slack|Connect your sources in Sim>'
    )
    expect(m.receive).not.toHaveBeenCalled()
  })
  it('does not queue commands on a disabled installation', async () => {
    m.authorize.mockResolvedValue(null)
    await receiveSlackSearchCommand.execute({ principal, input })
    expect(m.receive).not.toHaveBeenCalled()
  })
  it('does not accept unsupported commands or oversized invocations', () => {
    expect(slackSearchCommandSchema.safeParse({ ...input, command: '/other' }).success).toBe(false)
    expect(slackSearchCommandSchema.safeParse({ ...input, text: 'x'.repeat(40001) }).success).toBe(
      false
    )
  })
})
