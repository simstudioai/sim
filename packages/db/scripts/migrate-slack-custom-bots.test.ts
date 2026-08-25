/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  buildSlackBotDescription,
  buildSlackBotDisplayName,
  buildSlackCustomBotSecretBlob,
  type EnvironmentLookup,
  extractSlackBotSources,
  groupSlackSourcesByWorkflowCredentials,
  isTransientDatabaseError,
  planLegacySlackTriggerLink,
  resolveSlackSourceSecrets,
  retryTransientDatabaseRead,
  type SlackBotSource,
  type SlackMigrationBlock,
} from './migrate-slack-custom-bots'

describe('database read retries', () => {
  it('recognizes wrapped connection errors without retrying data errors', () => {
    const connectionError = new Error('Failed query', {
      cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    })
    const dataError = Object.assign(new Error('unique violation'), { code: '23505' })

    expect(isTransientDatabaseError(connectionError)).toBe(true)
    expect(
      isTransientDatabaseError(Object.assign(new Error('connection failure'), { code: '08006' }))
    ).toBe(true)
    expect(isTransientDatabaseError(dataError)).toBe(false)
  })

  it('retries a transient read and returns the successful result', async () => {
    let attempts = 0
    const result = await retryTransientDatabaseRead(
      async () => {
        attempts++
        if (attempts < 3) {
          throw Object.assign(new Error('connection closed'), { code: 'CONNECTION_CLOSED' })
        }
        return 'ok'
      },
      { operation: 'test read' },
      { maxAttempts: 3, backoff: { baseMs: 1, maxMs: 1 } }
    )

    expect(result).toBe('ok')
    expect(attempts).toBe(3)
  })

  it('fails immediately for a non-transient read error', async () => {
    let attempts = 0
    const error = Object.assign(new Error('invalid data'), { code: '23505' })

    await expect(
      retryTransientDatabaseRead(
        async () => {
          attempts++
          throw error
        },
        { operation: 'test read' },
        { maxAttempts: 5, backoff: { baseMs: 1, maxMs: 1 } }
      )
    ).rejects.toBe(error)
    expect(attempts).toBe(1)
  })

  it('stops after the configured number of transient attempts', async () => {
    let attempts = 0
    const error = Object.assign(new Error('connection closed'), { code: 'CONNECTION_CLOSED' })

    await expect(
      retryTransientDatabaseRead(
        async () => {
          attempts++
          throw error
        },
        { operation: 'test read' },
        { maxAttempts: 3, backoff: { baseMs: 1, maxMs: 1 } }
      )
    ).rejects.toBe(error)
    expect(attempts).toBe(3)
  })
})

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

  it('ignores Slack tools without params while extracting valid sibling tools', () => {
    const result = extractSlackBotSources(
      migrationBlock({
        blockType: 'agent',
        subBlocks: storedSubBlocks({
          tools: [
            { type: 'slack', title: 'Incomplete Slack tool' },
            {
              type: 'slack',
              title: 'Send to incidents',
              params: { authMethod: 'bot_token', botToken: 'xoxb-tool' },
            },
          ],
        }),
      })
    )

    expect(result).toEqual([
      expect.objectContaining({
        sourceId: 'workflow-1:block-1:tools:1',
        toolTitle: 'Send to incidents',
        rawBotToken: 'xoxb-tool',
      }),
    ])
  })

  it('ignores non-object tool entries while preserving valid sibling indexes', () => {
    const result = extractSlackBotSources(
      migrationBlock({
        blockType: 'agent',
        subBlocks: storedSubBlocks({
          tools: [
            'legacy-invalid-tool',
            {
              type: 'slack',
              title: 'Send to incidents',
              params: { authMethod: 'bot_token', botToken: 'xoxb-tool' },
            },
          ],
        }),
      })
    )

    expect(result).toEqual([
      expect.objectContaining({
        sourceId: 'workflow-1:block-1:tools:1',
        toolTitle: 'Send to incidents',
        rawBotToken: 'xoxb-tool',
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
  it('uses only the workflow name', () => {
    expect(buildSlackBotDisplayName('Escalations', new Set())).toBe('Escalations')
  })

  it('allocates a normalized suffix while keeping names within 255 characters', () => {
    const workflowName = 'W'.repeat(300)
    const first = buildSlackBotDisplayName(workflowName, new Set())
    const second = buildSlackBotDisplayName(workflowName, new Set([first.toLowerCase()]))

    expect(first).toHaveLength(255)
    expect(second).toHaveLength(255)
    expect(second.endsWith(' (2)')).toBe(true)
  })
})

describe('buildSlackBotDescription', () => {
  it('identifies blocks without migration terminology', () => {
    expect(
      buildSlackBotDescription('Escalations', [
        source(),
        source({
          sourceId: 'workflow-1:block-2:tools:0',
          blockId: 'block-2',
          blockName: 'Incident Agent',
          kind: 'embedded_tool',
          toolTitle: 'Notify channel',
        }),
      ])
    ).toBe(
      'Used by workflow "Escalations". Blocks: "Incident Agent" (Notify channel), "Notify Support".'
    )
  })
})

describe('groupSlackSourcesByWorkflowCredentials', () => {
  it('groups matching credentials within a workflow and keeps different credentials separate', () => {
    const groups = groupSlackSourcesByWorkflowCredentials([
      { source: source(), botToken: 'xoxb-one', signingSecret: 'secret-one' },
      {
        source: source({
          sourceId: 'workflow-1:block-2:trigger',
          blockId: 'block-2',
          blockName: 'Handle Reply',
          kind: 'trigger',
        }),
        botToken: 'xoxb-one',
        signingSecret: 'secret-one',
      },
      {
        source: source({
          sourceId: 'workflow-1:block-3:trigger',
          blockId: 'block-3',
          blockName: 'Handle Mention',
          kind: 'trigger',
        }),
        botToken: 'xoxb-two',
        signingSecret: 'secret-two',
      },
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0].sources.map((candidate) => candidate.blockName)).toEqual([
      'Notify Support',
      'Handle Reply',
    ])
    expect(groups[1].sources.map((candidate) => candidate.blockName)).toEqual(['Handle Mention'])
  })

  it('does not combine matching credentials across workflows', () => {
    const groups = groupSlackSourcesByWorkflowCredentials([
      { source: source(), botToken: 'xoxb-one', signingSecret: 'secret-one' },
      {
        source: source({
          sourceId: 'workflow-2:block-2:trigger',
          workflowId: 'workflow-2',
          workflowName: 'Onboarding',
          blockId: 'block-2',
          kind: 'trigger',
        }),
        botToken: 'xoxb-one',
        signingSecret: 'secret-one',
      },
    ])

    expect(groups).toHaveLength(2)
  })

  it('keeps different signing secrets separate when bot tokens match', () => {
    const groups = groupSlackSourcesByWorkflowCredentials([
      { source: source(), botToken: 'xoxb-one', signingSecret: 'secret-one' },
      {
        source: source({
          sourceId: 'workflow-1:block-2:trigger',
          blockId: 'block-2',
          blockName: 'Slack Trigger',
          kind: 'trigger',
        }),
        botToken: 'xoxb-one',
        signingSecret: 'secret-two',
      },
    ])

    expect(groups).toHaveLength(2)
  })

  it('joins an action-only source to the unique matching trigger credential', () => {
    const groups = groupSlackSourcesByWorkflowCredentials([
      { source: source(), botToken: 'xoxb-one' },
      {
        source: source({
          sourceId: 'workflow-1:block-2:trigger',
          blockId: 'block-2',
          blockName: 'Slack Trigger',
          kind: 'trigger',
        }),
        botToken: 'xoxb-one',
        signingSecret: 'secret-one',
      },
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].signingSecret).toBe('secret-one')
    expect(groups[0].sources.map((candidate) => candidate.blockName)).toEqual([
      'Slack Trigger',
      'Notify Support',
    ])
  })
})

describe('buildSlackCustomBotSecretBlob', () => {
  it('builds a trigger-capable credential without calling Slack for identity', () => {
    expect(buildSlackCustomBotSecretBlob('workflow-1', 'xoxb-token', 'secret')).toEqual({
      type: 'slack_custom_bot',
      signingSecret: 'secret',
      botToken: 'xoxb-token',
      metadata: { migrationWorkflowId: 'workflow-1' },
    })
  })

  it('builds an action-only credential without inventing a signing secret', () => {
    expect(buildSlackCustomBotSecretBlob('workflow-1', 'xoxb-token', undefined)).toEqual({
      type: 'slack_custom_bot',
      botToken: 'xoxb-token',
      metadata: { migrationWorkflowId: 'workflow-1' },
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

  it('links an undeployed trigger even when there is no webhook to mark', () => {
    expect(planLegacySlackTriggerLink(triggerSource, existingCredential, [])).toEqual({
      updateTriggerBlock: true,
      webhookIdsToUpdate: [],
    })
  })

  it('marks historical Slack webhooks that predate the trigger id', () => {
    expect(
      planLegacySlackTriggerLink(triggerSource, existingCredential, [
        {
          id: 'webhook-1',
          workflowId: 'workflow-1',
          blockId: 'block-1',
          routingKey: null,
          providerConfig: { signingSecret: 'secret' },
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

  it('fails fast instead of relabeling a different Slack trigger', () => {
    expect(() =>
      planLegacySlackTriggerLink(triggerSource, existingCredential, [
        {
          id: 'webhook-1',
          workflowId: 'workflow-1',
          blockId: 'block-1',
          routingKey: null,
          providerConfig: { triggerId: 'slack_oauth' },
        },
      ])
    ).toThrow(/does not use trigger slack_webhook/)
  })
})

describe('resolveSlackSourceSecrets', () => {
  it('marks a trigger without a bot token as unresolved', () => {
    expect(
      resolveSlackSourceSecrets(
        source({
          sourceId: 'workflow-1:block-1:trigger',
          kind: 'trigger',
          rawBotToken: undefined,
          rawSigningSecret: 'signing-secret',
        }),
        environmentLookup()
      )
    ).toEqual({
      status: 'unresolved',
      reason: 'Source workflow-1:block-1:trigger has no bot token',
    })
  })

  it('marks a trigger without a signing secret as unresolved', () => {
    expect(
      resolveSlackSourceSecrets(
        source({
          sourceId: 'workflow-1:block-1:trigger',
          kind: 'trigger',
          rawSigningSecret: undefined,
        }),
        environmentLookup()
      )
    ).toEqual({
      status: 'unresolved',
      reason: 'Trigger source workflow-1:block-1:trigger has no signing secret',
    })
  })

  it('marks a missing environment variable as an unresolved source', () => {
    expect(
      resolveSlackSourceSecrets(source({ rawBotToken: '{{SLACK_BOT_TOKEN}}' }), environmentLookup())
    ).toEqual({
      status: 'unresolved',
      reason: 'botToken references missing environment variable SLACK_BOT_TOKEN',
    })
  })

  it('skips a personal variable that cannot be promoted safely', () => {
    expect(
      resolveSlackSourceSecrets(
        source({
          sourceId: 'workflow-1:block-1:trigger',
          kind: 'trigger',
          workflowUserId: 'user-2',
          rawSigningSecret: '{{SLACK_CASINO_SECRET}}',
        }),
        environmentLookup({
          personalVariablesByUserId: new Map([
            ['user-2', { SLACK_CASINO_SECRET: 'encrypted-value' }],
          ]),
        })
      )
    ).toEqual({
      status: 'unresolved',
      reason:
        'signingSecret uses non-owner personal environment variable SLACK_CASINO_SECRET; refusing to promote it to a workspace credential',
    })
  })
})
