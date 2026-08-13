/**
 * @vitest-environment node
 */
import { resetUrlsMock, urlsMockFns } from '@sim/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { TRIGGER_ROUTING_FIELD, TRIGGER_WEBHOOK_URL_FIELD } from '@/triggers/constants'

beforeAll(() => {
  urlsMockFns.mockGetBaseUrl.mockReturnValue('https://sim.test')
})

afterAll(resetUrlsMock)

const genericWebhookConfig = {
  type: 'generic_webhook',
  name: 'Webhook',
  category: 'triggers',
  outputs: {},
  subBlocks: [
    { id: 'webhookUrlDisplay', type: 'short-input', readOnly: true, useWebhookUrl: true },
    { id: 'requireAuth', type: 'switch' },
  ],
}

// Mirrors an integration block (e.g. github) whose trigger-mode webhook-URL display
// fields are namespaced per trigger id and gated on selectedTriggerId.
const multiTriggerConfig = {
  type: 'github_v2',
  name: 'GitHub',
  category: 'tools',
  outputs: {},
  subBlocks: [
    {
      id: 'webhookUrlDisplay_github_push',
      type: 'short-input',
      readOnly: true,
      useWebhookUrl: true,
      condition: { field: 'selectedTriggerId', value: 'github_push' },
    },
  ],
}

const mothershipConfig = {
  type: 'mothership',
  name: 'Sim Chat',
  category: 'blocks',
  outputs: {},
  subBlocks: [
    { id: 'prompt', type: 'long-input' },
    { id: 'secretScope', type: 'dropdown', hideFromCopilot: true },
    { id: 'mountedSecrets', type: 'dropdown', hideFromCopilot: true },
  ],
}

const functionConfig = {
  type: 'function',
  name: 'Function',
  category: 'blocks',
  outputs: {},
  subBlocks: [
    { id: 'code', type: 'code' },
    { id: 'language', type: 'dropdown' },
    { id: 'sandboxId', type: 'combobox' },
  ],
}

vi.mock('@/blocks/registry', () => ({
  getBlock: (type: string) =>
    type === 'generic_webhook'
      ? genericWebhookConfig
      : type === 'github_v2'
        ? multiTriggerConfig
        : type === 'mothership'
          ? mothershipConfig
          : type === 'function'
            ? functionConfig
            : undefined,
}))

/**
 * Builds a minimal one-block workflow whose knowledge block carries the two
 * subblock keys `edit_workflow` is allowed to write.
 */
function makeKnowledgeWorkflow(tagFiltersValue: unknown) {
  return {
    blocks: {
      'kb-1': {
        id: 'kb-1',
        type: 'knowledge',
        name: 'Knowledge 1',
        position: { x: 0, y: 0 },
        enabled: true,
        outputs: {},
        subBlocks: {
          operation: { id: 'operation', type: 'dropdown', value: 'search' },
          tagFilters: { id: 'tagFilters', type: 'knowledge-tag-filters', value: tagFiltersValue },
          documentTags: {
            id: 'documentTags',
            type: 'document-tag-entry',
            value: JSON.stringify([{ id: 't1', tagName: 'Team' }]),
          },
        },
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  } as unknown as WorkflowState
}

describe('sanitizeForCopilot knowledge tag subblocks', () => {
  // Regression: these keys were stripped, which made them write-only for the agent --
  // edit_workflow could set a tag filter but the agent read back an absent field and
  // cleared the user's filter on the next edit.
  it('retains tagFilters so the agent can read back what edit_workflow writes', () => {
    const value = JSON.stringify([
      { id: 'f1', tagName: 'Department', tagSlot: 'tag1', tagValue: 'it' },
    ])

    const result = sanitizeForCopilot(makeKnowledgeWorkflow(value))
    const inputs = result.blocks['kb-1'].inputs

    expect(inputs?.tagFilters).toBe(value)
  })

  it('retains documentTags alongside tagFilters', () => {
    const result = sanitizeForCopilot(makeKnowledgeWorkflow(JSON.stringify([])))
    const inputs = result.blocks['kb-1'].inputs

    expect(inputs?.documentTags).toBeDefined()
  })

  it('still omits the key when no filter is set, so absent means unset', () => {
    const result = sanitizeForCopilot(makeKnowledgeWorkflow(null))
    const inputs = result.blocks['kb-1'].inputs

    expect(inputs).not.toHaveProperty('tagFilters')
  })
})

describe('sanitizeForCopilot server-only block inputs', () => {
  it('omits Sim Chat secret-mount policy while retaining model-visible inputs', () => {
    const result = sanitizeForCopilot(
      makeSingleBlockWorkflow('chat-1', {
        type: 'mothership',
        name: 'Sim Chat 1',
        enabled: true,
        subBlocks: {
          prompt: { id: 'prompt', type: 'long-input', value: 'Help me' },
          secretScope: { id: 'secretScope', type: 'dropdown', value: 'selected' },
          mountedSecrets: {
            id: 'mountedSecrets',
            type: 'dropdown',
            value: ['OPENAI_API_KEY'],
          },
        },
      })
    )

    expect(result.blocks['chat-1'].inputs).toEqual({ prompt: 'Help me' })
  })
})

describe('sanitizeForCopilot product-gated block inputs', () => {
  it('retains a persisted Function sandbox selection for model-visible read access', () => {
    const state = makeSingleBlockWorkflow('function-1', {
      type: 'function',
      name: 'Function 1',
      enabled: true,
      subBlocks: {
        code: { id: 'code', type: 'code', value: 'return 1' },
        language: { id: 'language', type: 'dropdown', value: 'javascript' },
        sandboxId: { id: 'sandboxId', type: 'combobox', value: 'sandbox-1' },
      },
    })

    expect(sanitizeForCopilot(state).blocks['function-1'].inputs).toEqual({
      code: 'return 1',
      language: 'javascript',
      sandboxId: 'sandbox-1',
    })
  })
})

/** Builds a one-block workflow for webhook-URL synthesis tests. */
function makeSingleBlockWorkflow(blockId: string, block: Record<string, unknown>): WorkflowState {
  return {
    blocks: { [blockId]: { id: blockId, position: { x: 0, y: 0 }, outputs: {}, ...block } },
    edges: [],
    loops: {},
    parallels: {},
  } as unknown as WorkflowState
}

describe('sanitizeForCopilot webhook trigger URL', () => {
  // Regression: the webhook URL only existed as a UI-computed display field, so the
  // copilot could not tell users where to point their external service.
  it('synthesizes the read-only webhook URL from the block id for a generic webhook trigger', () => {
    const result = sanitizeForCopilot(
      makeSingleBlockWorkflow('hook-1', {
        type: 'generic_webhook',
        name: 'Webhook 1',
        enabled: true,
        subBlocks: { requireAuth: { id: 'requireAuth', type: 'switch', value: true } },
      })
    )

    expect(result.blocks['hook-1'].inputs?.[TRIGGER_WEBHOOK_URL_FIELD]).toBe(
      'https://sim.test/api/webhooks/trigger/hook-1'
    )
  })

  it('prefers the stored triggerPath over the block id', () => {
    const result = sanitizeForCopilot(
      makeSingleBlockWorkflow('hook-1', {
        type: 'generic_webhook',
        name: 'Webhook 1',
        enabled: true,
        subBlocks: { triggerPath: { id: 'triggerPath', type: 'short-input', value: 'my-path' } },
      })
    )

    expect(result.blocks['hook-1'].inputs?.[TRIGGER_WEBHOOK_URL_FIELD]).toBe(
      'https://sim.test/api/webhooks/trigger/my-path'
    )
  })

  it('does not synthesize a URL for non-trigger blocks', () => {
    const result = sanitizeForCopilot(makeKnowledgeWorkflow(null))

    expect(result.blocks['kb-1'].inputs ?? {}).not.toHaveProperty(TRIGGER_WEBHOOK_URL_FIELD)
  })

  it('synthesizes a URL for an integration block whose selected trigger is webhook-based', () => {
    const result = sanitizeForCopilot(
      makeSingleBlockWorkflow('gh-1', {
        type: 'github_v2',
        name: 'GitHub 1',
        enabled: true,
        triggerMode: true,
        subBlocks: {
          selectedTriggerId: { id: 'selectedTriggerId', type: 'dropdown', value: 'github_push' },
        },
      })
    )

    expect(result.blocks['gh-1'].inputs?.[TRIGGER_WEBHOOK_URL_FIELD]).toBe(
      'https://sim.test/api/webhooks/trigger/gh-1'
    )
  })

  it('omits the URL when the selected trigger has no webhook-URL field', () => {
    const result = sanitizeForCopilot(
      makeSingleBlockWorkflow('gh-1', {
        type: 'github_v2',
        name: 'GitHub 1',
        enabled: true,
        triggerMode: true,
        subBlocks: {
          selectedTriggerId: { id: 'selectedTriggerId', type: 'dropdown', value: 'github_poller' },
        },
      })
    )

    expect(result.blocks['gh-1'].inputs ?? {}).not.toHaveProperty(TRIGGER_WEBHOOK_URL_FIELD)
  })

  it('omits the URL when the integration block is not in trigger mode', () => {
    const result = sanitizeForCopilot(
      makeSingleBlockWorkflow('gh-1', {
        type: 'github_v2',
        name: 'GitHub 1',
        enabled: true,
        subBlocks: {
          selectedTriggerId: { id: 'selectedTriggerId', type: 'dropdown', value: 'github_push' },
        },
      })
    )

    expect(result.blocks['gh-1'].inputs ?? {}).not.toHaveProperty(TRIGGER_WEBHOOK_URL_FIELD)
  })
})

describe('sanitizeForCopilot credential-routed trigger routing', () => {
  it('synthesizes the read-only routing note for a slack_v2 block in trigger mode', () => {
    const result = sanitizeForCopilot(
      makeSingleBlockWorkflow('slack-1', {
        type: 'slack_v2',
        name: 'Slack Trigger',
        enabled: true,
        triggerMode: true,
        subBlocks: {
          selectedTriggerId: { id: 'selectedTriggerId', type: 'short-input', value: 'slack_oauth' },
          customBotCredential: {
            id: 'customBotCredential',
            type: 'oauth-input',
            value: 'cred-123',
          },
        },
      })
    )

    const routing = result.blocks['slack-1'].inputs?.[TRIGGER_ROUTING_FIELD] as
      | Record<string, unknown>
      | undefined
    expect(routing?.model).toBe('credential-routed')
    expect(routing?.selectedCredentialId).toBe('cred-123')
    expect(String(routing?.note)).toContain('no per-workflow webhook URL')
    expect(result.blocks['slack-1'].inputs ?? {}).not.toHaveProperty(TRIGGER_WEBHOOK_URL_FIELD)
  })

  it('omits the routing note when the block is not in trigger mode', () => {
    const result = sanitizeForCopilot(
      makeSingleBlockWorkflow('slack-1', {
        type: 'slack_v2',
        name: 'Slack Action',
        enabled: true,
        subBlocks: {},
      })
    )

    expect(result.blocks['slack-1'].inputs ?? {}).not.toHaveProperty(TRIGGER_ROUTING_FIELD)
  })
})
