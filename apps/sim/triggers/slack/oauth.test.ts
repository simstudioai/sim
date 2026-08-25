/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getSlackTriggerCredentialSubBlock } from '@/triggers/slack/oauth'

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
})
