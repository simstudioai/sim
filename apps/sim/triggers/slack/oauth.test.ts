/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getSlackTriggerCredentialSubBlock, slackOAuthTrigger } from '@/triggers/slack/oauth'
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
      'slash_command',
    ]
    expect(SLACK_EVENT_CATALOG.map((event) => event.id)).toEqual(
      expect.arrayContaining(agentEvents)
    )
    expect(SIM_SUBSCRIBED_EVENTS).not.toEqual(expect.arrayContaining(agentEvents))
  })

  it('offers a command filter for custom-bot slash command triggers', () => {
    const commandFilter = slackOAuthTrigger.subBlocks.find(
      (subBlock) => subBlock.id === 'commandFilter'
    )

    expect(commandFilter).toMatchObject({
      title: 'Command',
      condition: { field: 'eventType', value: ['slash_command'] },
      required: false,
      mode: 'trigger',
    })
  })
})

describe('Slack response streaming fields', () => {
  it('labels response streaming as an agent session', () => {
    const agentSession = slackOAuthTrigger.subBlocks.find(
      (subBlock) => subBlock.id === 'streamResponse'
    )

    expect(agentSession?.title).toBe('Enable agent session')
  })

  it('keeps the response controls together after channel and thread filters', () => {
    const ids = slackOAuthTrigger.subBlocks.map((subBlock) => subBlock.id)
    const streamStart = ids.indexOf('streamResponse')

    expect(ids.indexOf('channelFilter')).toBeLessThan(streamStart)
    expect(ids.indexOf('threads')).toBe(streamStart - 1)
    expect(ids.slice(streamStart, streamStart + 6)).toEqual([
      'streamResponse',
      'streamOutputs',
      'streamTaskTitle',
      'streamTaskDisplayMode',
      'streamIncludeThinking',
      'streamIncludeToolCalls',
    ])
    expect(
      slackOAuthTrigger.subBlocks
        .filter((subBlock) => subBlock.id.startsWith('stream'))
        .map((subBlock) => subBlock.mode)
    ).toEqual(['trigger', 'trigger', 'trigger', 'trigger', 'trigger', 'trigger'])
  })

  it('makes the response status label optional with a visible default', () => {
    const statusLabel = slackOAuthTrigger.subBlocks.find(
      (subBlock) => subBlock.id === 'streamTaskTitle'
    )

    expect(statusLabel).toMatchObject({
      required: false,
      placeholder: 'Running (default)',
      mode: 'trigger',
    })
    expect(statusLabel?.value).toBeUndefined()
  })
})
