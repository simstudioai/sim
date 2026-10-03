import type { BlockState, SubBlockState } from '@sim/workflow-types/workflow'

function subBlock(
  id: string,
  type: SubBlockState['type'],
  value: SubBlockState['value']
): SubBlockState {
  return { id, type, value }
}

/** Relevant persisted fields produced by the slack_v2 schema introduced in f4d47ed. */
export function createHistoricalSlackV2Block(id = 'slack-1'): BlockState {
  return {
    id,
    type: 'slack_v2',
    name: 'Slack',
    position: { x: 0, y: 0 },
    enabled: true,
    triggerMode: false,
    subBlocks: {
      operation: subBlock('operation', 'dropdown', 'send'),
      authMethod: subBlock('authMethod', 'dropdown', 'bot_token'),
      credential: subBlock('credential', 'oauth-input', 'dormant-oauth'),
      manualCredential: subBlock('manualCredential', 'short-input', null),
      customBotCredential: subBlock('customBotCredential', 'oauth-input', 'credential-custom-bot'),
      manualCustomBotCredential: subBlock('manualCustomBotCredential', 'short-input', null),
      destinationType: subBlock('destinationType', 'dropdown', 'channel'),
      channel: subBlock('channel', 'channel-selector', 'C123456789'),
      text: subBlock('text', 'long-input', 'Hello'),
      messageFormat: subBlock('messageFormat', 'dropdown', 'text'),
    },
    data: {
      canonicalModes: {
        oauthCredential: 'basic',
        botCredential: 'basic',
        channel: 'basic',
      },
    },
    outputs: {},
  }
}
