/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getSlackTriggerCredentialSubBlock } from '@/triggers/slack/oauth'
import { SIM_SUBSCRIBED_EVENTS, SLACK_EVENT_CATALOG } from '@/triggers/slack/shared'

describe('Slack trigger extended-scope capability', () => {
  it('offers only custom bots when the capability is disabled', () => {
    const credential = getSlackTriggerCredentialSubBlock(false)

    expect(credential.credentialKind).toBe('service-account')
    expect(credential.credentialLabels).toEqual({
      serviceAccountGroup: 'Custom bots',
      serviceAccountConnect: 'Set up a custom bot',
    })
    expect(credential.credentialLabels?.oauthGroup).toBeUndefined()
    expect(credential.placeholder).toBe('Select custom bot')
  })

  it('offers the Sim app and custom bots when the capability is enabled', () => {
    const credential = getSlackTriggerCredentialSubBlock(true)

    expect(credential.credentialKind).toBe('any')
    expect(credential.credentialLabels).toMatchObject({
      oauthGroup: 'Sim app',
      oauthConnect: 'Connect the Sim app',
      serviceAccountGroup: 'Custom bots',
      serviceAccountConnect: 'Set up a custom bot',
    })
    expect(credential.placeholder).toBe('Select Slack account or bot')
  })

  it('keeps Agent Sessions events custom-bot-only even when native canaries are enabled', () => {
    const agentEvents = [
      'agent_session_stopped',
      'agent_session_title_changed',
      'app_context_changed',
    ]
    expect(SLACK_EVENT_CATALOG.map((event) => event.id)).toEqual(
      expect.arrayContaining(agentEvents)
    )
    expect(SIM_SUBSCRIBED_EVENTS).not.toEqual(expect.arrayContaining(agentEvents))
  })
})
