/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requestJson: vi.fn() }))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.requestJson }))

import { transformSlackSelectorContext } from '@/hooks/selectors/providers/slack/context'
import { slackSelectors } from '@/hooks/selectors/providers/slack/selectors'
import { getScopedSelectorQueryKey } from '@/hooks/selectors/use-selector-query'

describe('Slack server-resolved selector context', () => {
  beforeEach(() => vi.clearAllMocks())

  it('propagates literal and referenced raw bot-token dependencies', () => {
    for (const botToken of ['xoxb-literal-secret', '{{SLACK_BOT_TOKEN}}']) {
      expect(
        transformSlackSelectorContext(
          { workflowId: 'workflow-1' },
          { authMethod: 'bot_token', botToken }
        ).oauthCredential
      ).toBe(botToken)
    }
  })

  it('rejects runtime block references before enabling or requesting', () => {
    const context = transformSlackSelectorContext(
      { workflowId: 'workflow-1' },
      { authMethod: 'bot_token', botToken: '<slack.output.token>' }
    )

    expect(context.oauthCredential).toBeUndefined()
    expect(slackSelectors['slack.channels'].enabled?.({ key: 'slack.channels', context })).toBe(
      false
    )
    expect(mocks.requestJson).not.toHaveBeenCalled()
  })

  it('supports workflowless OAuth/custom-bot credentials but requires workflows for direct secrets', () => {
    const definition = slackSelectors['slack.channels']

    expect(
      definition.enabled?.({
        key: 'slack.channels',
        context: { workspaceId: 'workspace-1', oauthCredential: 'credential-1' },
      })
    ).toBe(true)
    expect(
      definition.enabled?.({
        key: 'slack.channels',
        context: { workspaceId: 'workspace-1', oauthCredential: 'xoxb-secret' },
      })
    ).toBe(false)
    expect(
      definition.enabled?.({
        key: 'slack.channels',
        context: { workspaceId: 'workspace-1', oauthCredential: '{{SLACK_BOT_TOKEN}}' },
      })
    ).toBe(false)
  })

  it('forwards credential-backed requests and maps channel options', async () => {
    mocks.requestJson.mockResolvedValue({ channels: [{ id: 'C111', name: 'general' }] })
    const definition = slackSelectors['slack.channels']
    const context = { workspaceId: 'workspace-1', oauthCredential: 'credential-1' }

    expect(await definition.fetchList!({ key: 'slack.channels', context })).toEqual([
      { id: 'C111', label: '#general' },
    ])
    expect(mocks.requestJson.mock.calls[0][1].body).toEqual({ credential: 'credential-1' })
  })

  it('separates arbitrary credentials without putting their text in keys', () => {
    const definition = slackSelectors['slack.channels']
    const credentials = [
      'credential-id',
      'xoxb-clean-secret',
      ' xoxb-padded-secret',
      '"xoxb-quoted-secret"',
      '{{SLACK_SECRET_REFERENCE}}',
    ]
    const keys = credentials.map((oauthCredential, index) =>
      getScopedSelectorQueryKey(definition, {
        key: 'slack.channels',
        context: {
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          oauthCredential,
          selectorCacheScope: `revision-${index}`,
        },
      })
    )

    expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(credentials.length)
    for (const credential of credentials) {
      expect(JSON.stringify(keys)).not.toContain(credential)
    }
  })
})
