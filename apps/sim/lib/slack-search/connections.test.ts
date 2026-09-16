/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ read: vi.fn(), send: vi.fn(), before: vi.fn(), origin: vi.fn() }))
vi.mock('@/lib/copilot/application/execute-knowledge-use-case', () => ({
  executeCopilotOrganizationKnowledgeUseCase: m.read,
}))
vi.mock('@/lib/knowledge/application/personal-search-integrations', () => ({
  resolvePersonalSearchConnection: {},
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: m.origin }))
vi.mock('@/lib/internal/slack/client', () => ({ requestSlackApi: m.send }))

import { deliverSlackSearchConnections } from '@/lib/slack-search/connections'

const target = {
  type: 'link',
  provider: 'google-email',
  connectorType: 'gmail',
  connectorId: 'source',
} as const
const input = {
  targets: [target],
  token: 'token',
  organizationId: 'org',
  userId: 'person',
  chatId: 'chat',
  turnId: 'turn',
  channel: 'D1',
  slackUserId: 'U1',
  signal: new AbortController().signal,
  beforeDelivery: m.before,
}
beforeEach(() => {
  vi.clearAllMocks()
  m.read.mockResolvedValue({ name: 'Gmail', target })
  m.send.mockResolvedValue({ status: 200, data: { ok: true } })
  m.origin.mockReturnValue('https://preview.example.test')
})
describe('Slack connection controls', () => {
  it.each(['https://staging.example.test', 'https://preview.example.test'])(
    'uses configured origin %s and private ephemeral delivery',
    async (origin) => {
      m.origin.mockReturnValue(origin)
      await deliverSlackSearchConnections(input)
      expect(m.read).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'person', organizationId: 'org', chatId: 'chat' }),
        {},
        { organizationId: 'org', target }
      )
      expect(m.send).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'chat.postEphemeral',
          body: expect.objectContaining({ channel: 'D1', user: 'U1' }),
        })
      )
      const button = m.send.mock.calls[0][0].body.blocks[1].elements[0]
      expect(button.url).toBe(`${origin}/o/org/integrations?connectorType=gmail&connectorId=source`)
      expect(button.text.text).toBe('Connect Gmail')
      expect(m.before).toHaveBeenCalledTimes(2)
    }
  )
  it('never publishes personal account details to a channel', async () => {
    await expect(deliverSlackSearchConnections({ ...input, channel: 'C1' })).rejects.toThrow(
      'require a Slack DM'
    )
    expect(m.send).not.toHaveBeenCalled()
  })
  it('fails before sending when current target authority has changed', async () => {
    m.read.mockRejectedValue(new Error('target revoked'))
    await expect(deliverSlackSearchConnections(input)).rejects.toThrow('target revoked')
    expect(m.send).not.toHaveBeenCalled()
  })
  it('fails on an ambiguous send without replaying or changing delivery mechanisms', async () => {
    m.send.mockRejectedValue(new Error('connection reset'))
    await expect(deliverSlackSearchConnections(input)).rejects.toThrow('connection reset')
    expect(m.send).toHaveBeenCalledOnce()
  })
})
