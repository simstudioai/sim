import { resetUrlsMock, urlsMockFns } from '@sim/testing'
import type { Mock } from 'vitest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'
import { getBlock } from '@/blocks/registry'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { TRIGGER_ROUTING_FIELD, TRIGGER_WEBHOOK_URL_FIELD } from '@/triggers/constants'

const mockGetBlock = getBlock as Mock
mockGetBlock.mockImplementation((type: string) =>
  type === 'generic_webhook'
    ? genericWebhookConfig
    : type === 'github_v2'
      ? multiTriggerConfig
      : type === 'mothership'
        ? mothershipConfig
        : type === 'function'
          ? functionConfig
          : undefined
)

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

describe('sanitizeForCopilot Agent tool modes', () => {
  it('preserves fixed and variable-backed usage modes while removing UI state', () => {
    const result = sanitizeForCopilot(
      makeSingleBlockWorkflow('agent-1', {
        type: 'agent',
        name: 'Agent 1',
        enabled: true,
        subBlocks: {
          tools: {
            id: 'tools',
            type: 'tool-input',
            value: [
              {
                type: 'custom-tool',
                customToolId: 'custom-1',
                usageControl: 'auto',
                usageControlExpression: '<route.toolMode>',
                isExpanded: true,
              },
            ],
          },
        },
      })
    )

    expect(result.blocks['agent-1'].inputs?.tools).toEqual([
      {
        type: 'custom-tool',
        customToolId: 'custom-1',
        usageControl: 'auto',
        usageControlExpression: '<route.toolMode>',
      },
    ])
  })
})

describe('sanitizeForCopilot subflow config', () => {
  /**
   * The model's read view has to use the same field names as the write contract it is
   * given, or an echoed-back edit is silently dropped. `components/blocks/parallel.json`
   * declares `count`; `components/blocks/loop.json` declares `iterations`.
   */
  it("names a count-parallel's branch count `count`, matching the parallel write contract", () => {
    const state = makeSingleBlockWorkflow('parallel-1', {
      type: 'parallel',
      name: 'Parallel 1',
      enabled: true,
      subBlocks: {},
      data: { parallelType: 'count', count: 5 },
    })

    expect(sanitizeForCopilot(state).blocks['parallel-1'].inputs).toEqual({
      parallelType: 'count',
      count: 5,
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
})
