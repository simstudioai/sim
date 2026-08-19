/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  buildSlackBotDisplayName,
  buildSlackCustomBotSecretBlob,
  type EnvironmentLookup,
  extractSlackBotSources,
  planLegacySlackTriggerLink,
  resolveSlackSourceSecrets,
  type SlackBotSource,
  type SlackMigrationBlock,
} from './migrate-slack-custom-bots'

function storedSubBlocks(values: Record<string, unknown>): Record<string, { value: unknown }> {
  return Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value }]))
}

function migrationBlock(overrides: Partial<SlackMigrationBlock> = {}): SlackMigrationBlock {
  return {
    blockId: 'block-1',
    blockName: 'Notify Support',
    blockType: 'slack',
    triggerMode: false,
    subBlocks: {},
    workflowId: 'workflow-1',
    workflowName: 'Escalations',
    workflowUserId: 'user-1',
    ...overrides,
  }
}

function source(overrides: Partial<SlackBotSource> = {}): SlackBotSource {
  return {
    sourceId: 'workflow-1:block-1:action',
    kind: 'action',
    blockId: 'block-1',
    blockName: 'Notify Support',
    workflowId: 'workflow-1',
    workflowName: 'Escalations',
    workflowUserId: 'user-1',
    rawBotToken: 'xoxb-token',
    ...overrides,
  }
}

function environmentLookup(overrides: Partial<EnvironmentLookup> = {}): EnvironmentLookup {
  return {
    workspaceVariables: {},
    personalVariablesByUserId: new Map(),
    workspaceOwnerId: 'user-1',
    encryptionKey: '0'.repeat(64),
    ...overrides,
  }
}

describe('extractSlackBotSources', () => {
  it('extracts direct Slack trigger secrets before triggerConfig fallbacks', () => {
    const result = extractSlackBotSources(
      migrationBlock({
        triggerMode: true,
        subBlocks: storedSubBlocks({
          signingSecret: 'direct-signing-secret',
          botToken: 'direct-token',
          botCredential: 'credential-1',
          triggerConfig: {
            signingSecret: 'fallback-signing-secret',
            botToken: 'fallback-token',
          },
        }),
      })
    )

    expect(result).toEqual([
      expect.objectContaining({
        sourceId: 'workflow-1:block-1:trigger',
        kind: 'trigger',
        rawSigningSecret: 'direct-signing-secret',
        rawBotToken: 'direct-token',
        existingBotCredentialId: 'credential-1',
      }),
    ])
  })

  it('extracts legacy triggerConfig secrets when direct fields are absent', () => {
    const result = extractSlackBotSources(
      migrationBlock({
        triggerMode: true,
        subBlocks: storedSubBlocks({
          triggerConfig: { signingSecret: '{{SLACK_SIGNING}}', botToken: '{{SLACK_TOKEN}}' },
        }),
      })
    )

    expect(result[0]).toMatchObject({
      rawSigningSecret: '{{SLACK_SIGNING}}',
      rawBotToken: '{{SLACK_TOKEN}}',
    })
  })

  it('extracts standalone custom-bot actions and ignores stale OAuth tokens', () => {
    const customBot = extractSlackBotSources(
      migrationBlock({
        subBlocks: storedSubBlocks({ authMethod: 'bot_token', botToken: 'xoxb-action' }),
      })
    )
    const oauth = extractSlackBotSources(
      migrationBlock({
        subBlocks: storedSubBlocks({ authMethod: 'oauth', botToken: 'stale-token' }),
      })
    )

    expect(customBot).toEqual([
      expect.objectContaining({ kind: 'action', rawBotToken: 'xoxb-action' }),
    ])
    expect(oauth).toEqual([])
  })

  it('extracts Slack tools from serialized tools and notification inputs', () => {
    const toolsResult = extractSlackBotSources(
      migrationBlock({
        blockType: 'agent',
        subBlocks: storedSubBlocks({
          tools: JSON.stringify([
            {
              type: 'slack',
              title: 'Send to incidents',
              params: { authMethod: 'bot_token', botToken: 'xoxb-tool' },
            },
            {
              type: 'slack',
              title: 'Old OAuth selection',
              params: { authMethod: 'oauth', botToken: 'stale-token' },
            },
          ]),
        }),
      })
    )
    const notificationResult = extractSlackBotSources(
      migrationBlock({
        blockType: 'human_in_the_loop',
        subBlocks: storedSubBlocks({
          notification: [
            { type: 'slack', title: 'Approval alert', params: { accessToken: 'xoxb-legacy' } },
          ],
        }),
      })
    )

    expect(toolsResult).toEqual([
      expect.objectContaining({
        sourceId: 'workflow-1:block-1:tools:0',
        kind: 'embedded_tool',
        toolTitle: 'Send to incidents',
        rawBotToken: 'xoxb-tool',
      }),
    ])
    expect(notificationResult).toEqual([
      expect.objectContaining({
        sourceId: 'workflow-1:block-1:notification:0',
        toolTitle: 'Approval alert',
        rawBotToken: 'xoxb-legacy',
      }),
    ])
  })

  it('fails fast on malformed tool-input storage', () => {
    expect(() =>
      extractSlackBotSources(
        migrationBlock({
          blockType: 'agent',
          subBlocks: storedSubBlocks({ tools: '{not-json' }),
        })
      )
    ).toThrow()
  })

  it('fails before iterating an oversized tool-input list', () => {
    const tools = Array.from({ length: 1_001 }, () => ({
      type: 'slack',
      params: { authMethod: 'bot_token', botToken: 'xoxb-tool' },
    }))

    expect(() =>
      extractSlackBotSources(
        migrationBlock({
          blockType: 'agent',
          subBlocks: storedSubBlocks({ tools }),
        })
      )
    ).toThrow(/1000-tool migration limit/)
  })
})

describe('buildSlackBotDisplayName', () => {
  it('uses workflow, block, and optional tool names', () => {
    expect(buildSlackBotDisplayName(source(), new Set())).toBe('Escalations — Notify Support')
    expect(
      buildSlackBotDisplayName(
        source({ kind: 'embedded_tool', toolTitle: 'Send to incidents' }),
        new Set()
      )
    ).toBe('Escalations — Notify Support — Send to incidents')
  })

  it('allocates a normalized suffix while keeping names within 255 characters', () => {
    const longSource = source({ workflowName: 'W'.repeat(250), blockName: 'Block' })
    const first = buildSlackBotDisplayName(longSource, new Set())
    const second = buildSlackBotDisplayName(longSource, new Set([first.toLowerCase()]))

    expect(first).toHaveLength(255)
    expect(second).toHaveLength(255)
    expect(second.endsWith(' (2)')).toBe(true)
  })
})

describe('buildSlackCustomBotSecretBlob', () => {
  it('builds a trigger-capable credential without calling Slack for identity', () => {
    expect(
      buildSlackCustomBotSecretBlob('workflow-1:block-1:trigger', 'xoxb-token', 'secret')
    ).toEqual({
      type: 'slack_custom_bot',
      signingSecret: 'secret',
      botToken: 'xoxb-token',
      metadata: { migrationSourceId: 'workflow-1:block-1:trigger' },
    })
  })

  it('builds an action-only credential without inventing a signing secret', () => {
    expect(
      buildSlackCustomBotSecretBlob('workflow-1:block-1:action', 'xoxb-token', undefined)
    ).toEqual({
      type: 'slack_custom_bot',
      botToken: 'xoxb-token',
      metadata: { migrationSourceId: 'workflow-1:block-1:action' },
    })
  })
})

describe('planLegacySlackTriggerLink', () => {
  const triggerSource = source({
    sourceId: 'workflow-1:block-1:trigger',
    kind: 'trigger',
    rawSigningSecret: 'secret',
  })
  const existingCredential = { credentialId: 'credential-1', hasSigningSecret: true }

  it('links the trigger block and marks its existing webhook', () => {
    expect(
      planLegacySlackTriggerLink(triggerSource, existingCredential, [
        {
          id: 'webhook-1',
          workflowId: 'workflow-1',
          blockId: 'block-1',
          routingKey: null,
          providerConfig: { triggerId: 'slack_webhook' },
        },
      ])
    ).toEqual({ updateTriggerBlock: true, webhookIdsToUpdate: ['webhook-1'] })
  })

  it('is idempotent after the block and webhook are linked', () => {
    expect(
      planLegacySlackTriggerLink(
        { ...triggerSource, existingBotCredentialId: 'credential-1' },
        existingCredential,
        [
          {
            id: 'webhook-1',
            workflowId: 'workflow-1',
            blockId: 'block-1',
            routingKey: 'credential-1',
            providerConfig: {
              triggerId: 'slack_webhook',
              botCredential: 'credential-1',
              credentialId: 'credential-1',
              ingressMode: 'legacy_custom_bot',
            },
          },
        ]
      )
    ).toEqual({ updateTriggerBlock: false, webhookIdsToUpdate: [] })
  })

  it('fails fast instead of overwriting a different credential association', () => {
    expect(() =>
      planLegacySlackTriggerLink(
        { ...triggerSource, existingBotCredentialId: 'credential-2' },
        existingCredential,
        []
      )
    ).toThrow(/different Slack bot credential/)
  })
})

describe('resolveSlackSourceSecrets', () => {
  it('marks a missing environment variable as an unresolved source', () => {
    expect(
      resolveSlackSourceSecrets(source({ rawBotToken: '{{SLACK_BOT_TOKEN}}' }), environmentLookup())
    ).toEqual({
      status: 'unresolved',
      reason: 'botToken references missing environment variable SLACK_BOT_TOKEN',
    })
  })

  it('still fails fast when a personal variable cannot be promoted safely', () => {
    expect(() =>
      resolveSlackSourceSecrets(
        source({ workflowUserId: 'user-2', rawBotToken: '{{SLACK_BOT_TOKEN}}' }),
        environmentLookup({
          personalVariablesByUserId: new Map([['user-2', { SLACK_BOT_TOKEN: 'encrypted-value' }]]),
        })
      )
    ).toThrow(/non-owner personal environment variable/)
  })
})
