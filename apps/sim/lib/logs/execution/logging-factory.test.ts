import { workflowsPersistenceUtilsMock, workflowsPersistenceUtilsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  calculateCostSummary,
  createEnvironmentObject,
  createTriggerObject,
} from '@/lib/logs/execution/logging-factory'

/** Mock the billing constants */
vi.mock('@/lib/billing/constants', () => ({
  BASE_EXECUTION_CHARGE: 0.005,
}))

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

beforeEach(() => {
  workflowsPersistenceUtilsMockFns.mockLoadDeployedWorkflowState.mockResolvedValue({
    blocks: {},
    edges: [],
    loops: {},
    parallels: {},
  })
  workflowsPersistenceUtilsMockFns.mockLoadWorkflowFromNormalizedTables.mockResolvedValue({
    blocks: {},
    edges: [],
    loops: {},
    parallels: {},
  })
})

describe('createTriggerObject', () => {
  test('should create a trigger object with basic type', () => {
    const trigger = createTriggerObject('manual')

    expect(trigger.type).toBe('manual')
    expect(trigger.source).toBe('manual')
    expect(trigger.timestamp).toBeDefined()
    expect(new Date(trigger.timestamp).getTime()).not.toBeNaN()
  })

  test('should create a trigger object for api type', () => {
    const trigger = createTriggerObject('api')

    expect(trigger.type).toBe('api')
    expect(trigger.source).toBe('api')
  })

  test('should create a trigger object for webhook type', () => {
    const trigger = createTriggerObject('webhook')

    expect(trigger.type).toBe('webhook')
    expect(trigger.source).toBe('webhook')
  })

  test('should create a trigger object for schedule type', () => {
    const trigger = createTriggerObject('schedule')

    expect(trigger.type).toBe('schedule')
    expect(trigger.source).toBe('schedule')
  })

  test('should create a trigger object for chat type', () => {
    const trigger = createTriggerObject('chat')

    expect(trigger.type).toBe('chat')
    expect(trigger.source).toBe('chat')
  })

  test('should include additional data when provided', () => {
    const additionalData = {
      requestId: 'req-123',
      headers: { 'x-custom': 'value' },
    }

    const trigger = createTriggerObject('api', additionalData)

    expect(trigger.type).toBe('api')
    expect(trigger.data).toEqual(additionalData)
  })

  test('should not include data property when additionalData is undefined', () => {
    const trigger = createTriggerObject('manual')

    expect(trigger.data).toBeUndefined()
  })

  test('should not include data property when additionalData is empty', () => {
    const trigger = createTriggerObject('manual', undefined)

    expect(trigger.data).toBeUndefined()
  })
})

describe('createEnvironmentObject', () => {
  test('should create an environment object with all fields', () => {
    const env = createEnvironmentObject(
      'workflow-123',
      'execution-456',
      'user-789',
      'workspace-abc',
      { API_KEY: 'secret', DEBUG: 'true' }
    )

    expect(env.workflowId).toBe('workflow-123')
    expect(env.executionId).toBe('execution-456')
    expect(env.userId).toBe('user-789')
    expect(env.workspaceId).toBe('workspace-abc')
    expect(env.variables).toEqual({ API_KEY: 'secret', DEBUG: 'true' })
  })

  test('should use empty string for optional userId', () => {
    const env = createEnvironmentObject('workflow-123', 'execution-456')

    expect(env.userId).toBe('')
  })

  test('should use empty string for optional workspaceId', () => {
    const env = createEnvironmentObject('workflow-123', 'execution-456', 'user-789')

    expect(env.workspaceId).toBe('')
  })

  test('should use empty object for optional variables', () => {
    const env = createEnvironmentObject(
      'workflow-123',
      'execution-456',
      'user-789',
      'workspace-abc'
    )

    expect(env.variables).toEqual({})
  })

  test('should handle all optional parameters as undefined', () => {
    const env = createEnvironmentObject('workflow-123', 'execution-456')

    expect(env.workflowId).toBe('workflow-123')
    expect(env.executionId).toBe('execution-456')
    expect(env.userId).toBe('')
    expect(env.workspaceId).toBe('')
    expect(env.variables).toEqual({})
  })
})

describe('calculateCostSummary', () => {
  const BASE_EXECUTION_CHARGE = 0.005

  test('should return base execution charge for empty trace spans', () => {
    const result = calculateCostSummary([])

    expect(result.totalCost).toBe(BASE_EXECUTION_CHARGE)
    expect(result.baseExecutionCharge).toBe(BASE_EXECUTION_CHARGE)
    expect(result.totalInputCost).toBe(0)
    expect(result.totalOutputCost).toBe(0)
    expect(result.totalTokens).toBe(0)
    expect(result.totalPromptTokens).toBe(0)
    expect(result.totalCompletionTokens).toBe(0)
    expect(result.models).toEqual({})
  })

  test('should return base execution charge for undefined trace spans', () => {
    const result = calculateCostSummary(undefined as any)

    expect(result.totalCost).toBe(BASE_EXECUTION_CHARGE)
  })

  test('should calculate cost from single span with cost data', () => {
    const traceSpans = [
      {
        id: 'span-1',
        name: 'Agent Block',
        type: 'agent',
        model: 'gpt-4',
        cost: {
          input: 0.01,
          output: 0.02,
          total: 0.03,
        },
        tokens: {
          input: 100,
          output: 200,
          total: 300,
        },
      },
    ]

    const result = calculateCostSummary(traceSpans)

    expect(result.totalCost).toBe(0.03 + BASE_EXECUTION_CHARGE)
    expect(result.totalInputCost).toBe(0.01)
    expect(result.totalOutputCost).toBe(0.02)
    expect(result.totalTokens).toBe(300)
    expect(result.totalPromptTokens).toBe(100)
    expect(result.totalCompletionTokens).toBe(200)
    expect(result.models['gpt-4']).toBeDefined()
    expect(result.models['gpt-4'].total).toBe(0.03)
  })

  test('should calculate cost from multiple spans', () => {
    const traceSpans = [
      {
        id: 'span-1',
        name: 'Agent Block 1',
        type: 'agent',
        model: 'gpt-4',
        cost: { input: 0.01, output: 0.02, total: 0.03 },
        tokens: { input: 100, output: 200, total: 300 },
      },
      {
        id: 'span-2',
        name: 'Agent Block 2',
        type: 'agent',
        model: 'gpt-3.5-turbo',
        cost: { input: 0.001, output: 0.002, total: 0.003 },
        tokens: { input: 50, output: 100, total: 150 },
      },
    ]

    const result = calculateCostSummary(traceSpans)

    expect(result.totalCost).toBe(0.033 + BASE_EXECUTION_CHARGE)
    expect(result.totalInputCost).toBe(0.011)
    expect(result.totalOutputCost).toBe(0.022)
    expect(result.totalTokens).toBe(450)
    expect(result.models['gpt-4']).toBeDefined()
    expect(result.models['gpt-3.5-turbo']).toBeDefined()
  })

  test('should accumulate costs for same model across spans', () => {
    const traceSpans = [
      {
        id: 'span-1',
        model: 'gpt-4',
        cost: { input: 0.01, output: 0.02, total: 0.03 },
        tokens: { input: 100, output: 200, total: 300 },
      },
      {
        id: 'span-2',
        model: 'gpt-4',
        cost: { input: 0.02, output: 0.04, total: 0.06 },
        tokens: { input: 200, output: 400, total: 600 },
      },
    ]

    const result = calculateCostSummary(traceSpans)

    expect(result.models['gpt-4'].input).toBe(0.03)
    expect(result.models['gpt-4'].output).toBe(0.06)
    expect(result.models['gpt-4'].total).toBe(0.09)
    expect(result.models['gpt-4'].tokens.input).toBe(300)
    expect(result.models['gpt-4'].tokens.output).toBe(600)
    expect(result.models['gpt-4'].tokens.total).toBe(900)
  })

  test('should handle nested children with cost data', () => {
    const traceSpans = [
      {
        id: 'parent-span',
        name: 'Parent',
        type: 'workflow',
        children: [
          {
            id: 'child-span-1',
            model: 'claude-3',
            cost: { input: 0.005, output: 0.01, total: 0.015 },
            tokens: { input: 50, output: 100, total: 150 },
          },
          {
            id: 'child-span-2',
            model: 'claude-3',
            cost: { input: 0.005, output: 0.01, total: 0.015 },
            tokens: { input: 50, output: 100, total: 150 },
          },
        ],
      },
    ]

    const result = calculateCostSummary(traceSpans)

    expect(result.totalCost).toBe(0.03 + BASE_EXECUTION_CHARGE)
    expect(result.models['claude-3']).toBeDefined()
    expect(result.models['claude-3'].total).toBe(0.03)
  })

  test('should handle deeply nested children', () => {
    const traceSpans = [
      {
        id: 'level-1',
        children: [
          {
            id: 'level-2',
            children: [
              {
                id: 'level-3',
                model: 'gpt-4',
                cost: { input: 0.01, output: 0.02, total: 0.03 },
                tokens: { input: 100, output: 200, total: 300 },
              },
            ],
          },
        ],
      },
    ]

    const result = calculateCostSummary(traceSpans)

    expect(result.models['gpt-4']).toBeDefined()
  })

  test('should handle prompt/completion token aliases', () => {
    const traceSpans = [
      {
        id: 'span-1',
        model: 'gpt-4',
        cost: { input: 0.01, output: 0.02, total: 0.03 },
        tokens: { prompt: 100, completion: 200, total: 300 },
      },
    ]

    const result = calculateCostSummary(traceSpans)

    expect(result.totalPromptTokens).toBe(100)
    expect(result.totalCompletionTokens).toBe(200)
  })

  test('should skip spans without cost data', () => {
    const traceSpans = [
      {
        id: 'span-without-cost',
        name: 'Text Block',
        type: 'text',
      },
      {
        id: 'span-with-cost',
        model: 'gpt-4',
        cost: { input: 0.01, output: 0.02, total: 0.03 },
        tokens: { input: 100, output: 200, total: 300 },
      },
    ]

    const result = calculateCostSummary(traceSpans)

    expect(Object.keys(result.models)).toHaveLength(1)
  })

  test('should handle spans without model specified', () => {
    const traceSpans = [
      {
        id: 'span-1',
        cost: { input: 0.01, output: 0.02, total: 0.03 },
        tokens: { input: 100, output: 200, total: 300 },
        // No model specified
      },
    ]

    const result = calculateCostSummary(traceSpans)

    expect(result.totalCost).toBe(0.03 + BASE_EXECUTION_CHARGE)
    // Should not add to models if model is not specified
    expect(Object.keys(result.models)).toHaveLength(0)
  })

  test('should handle missing token fields gracefully', () => {
    const traceSpans = [
      {
        id: 'span-1',
        model: 'gpt-4',
        cost: { input: 0.01, output: 0.02, total: 0.03 },
        // tokens field is missing
      },
    ]

    const result = calculateCostSummary(traceSpans)

    expect(result.totalTokens).toBe(0)
    expect(result.totalPromptTokens).toBe(0)
    expect(result.totalCompletionTokens).toBe(0)
  })

  test('should handle partial cost fields', () => {
    const traceSpans = [
      {
        id: 'span-1',
        model: 'gpt-4',
        cost: { total: 0.03 }, // Only total specified
        tokens: { total: 300 },
      },
    ]

    const result = calculateCostSummary(traceSpans)

    expect(result.totalCost).toBe(0.03 + BASE_EXECUTION_CHARGE)
    expect(result.totalInputCost).toBe(0)
    expect(result.totalOutputCost).toBe(0)
  })

  test('BYOK regression: parent block cost is authoritative; model children are not double-counted', () => {
    // Reproduces the BYOK billing leak: provider sets parent agent span's
    // block-level cost to zero (BYOK suppression), but trace enrichers still
    // wrote gross hosted cost into time-segment children. Before the fix this
    // test would expect 0.03; after the fix the parent's zero is authoritative.
    const traceSpans = [
      {
        id: 'agent-span',
        type: 'agent',
        model: 'claude-opus-4-6',
        cost: { input: 0, output: 0, total: 0 },
        tokens: { input: 68057, output: 1548, total: 69605 },
        children: [
          {
            id: 'agent-span-segment-0',
            type: 'model',
            model: 'claude-opus-4-6',
            cost: { input: 0.340285, output: 0.0387, total: 0.378985 },
            tokens: { input: 68057, output: 1548, total: 69605 },
          },
        ],
      },
    ]

    const result = calculateCostSummary(traceSpans)

    expect(result.totalCost).toBe(BASE_EXECUTION_CHARGE)
    // Model is still tracked for token-usage display, but cost must be zero.
    expect(result.models['claude-opus-4-6'].total).toBe(0)
    expect(result.models['claude-opus-4-6'].input).toBe(0)
    expect(result.models['claude-opus-4-6'].output).toBe(0)
    expect(result.models['claude-opus-4-6'].tokens.input).toBe(68057)
    expect(result.models['claude-opus-4-6'].tokens.output).toBe(1548)
  })

  test('non-BYOK still aggregates parent block cost correctly with model children present', () => {
    // Same shape as the BYOK case but the parent carries the gross cost
    // (typical hosted-key path). The parent's cost is counted once; model
    // children are skipped to avoid double-counting.
    const traceSpans = [
      {
        id: 'agent-span',
        type: 'agent',
        model: 'gpt-4o',
        cost: { input: 0.01, output: 0.02, total: 0.03 },
        tokens: { input: 1000, output: 2000, total: 3000 },
        children: [
          {
            id: 'agent-span-segment-0',
            type: 'model',
            model: 'gpt-4o',
            cost: { input: 0.01, output: 0.02, total: 0.03 },
            tokens: { input: 1000, output: 2000, total: 3000 },
          },
        ],
      },
    ]

    const result = calculateCostSummary(traceSpans)

    expect(result.totalCost).toBe(0.03 + BASE_EXECUTION_CHARGE)
    expect(result.models['gpt-4o'].total).toBe(0.03)
  })

  test('preserves parent toolCost while skipping model breakdown children', () => {
    const traceSpans = [
      {
        id: 'agent-span',
        type: 'agent',
        model: 'gpt-4o',
        cost: { input: 0.01, output: 0.02, toolCost: 0.015, total: 0.045 },
        tokens: { input: 1000, output: 2000, total: 3000 },
        children: [
          {
            id: 'agent-span-model-segment',
            type: 'model',
            model: 'gpt-4o',
            cost: { input: 0.01, output: 0.02, total: 0.03 },
            tokens: { input: 1000, output: 2000, total: 3000 },
          },
          {
            id: 'agent-span-tool-segment',
            type: 'tool',
            name: 'firecrawl_scrape',
          },
        ],
      },
    ]

    const result = calculateCostSummary(traceSpans)

    expect(result.totalCost).toBe(0.045 + BASE_EXECUTION_CHARGE)
    expect(result.models['gpt-4o'].total).toBe(0.045)
    expect(result.models['gpt-4o'].toolCost).toBe(0.015)
  })

  test('records a standalone non-model billable span as a charge (closes the tool gap)', () => {
    const traceSpans = [
      {
        id: 'exa-block',
        name: 'Exa Search',
        type: 'tool',
        cost: { input: 0, output: 0, total: 0.01 },
      },
    ]

    const result = calculateCostSummary(traceSpans)

    expect(result.charges['Exa Search']).toBeDefined()
    expect(result.charges['Exa Search'].total).toBe(0.01)
    expect(Object.keys(result.models)).toHaveLength(0)
    // Ledger partition reconciles with the run total.
    const ledgerSum =
      result.baseExecutionCharge +
      Object.values(result.models).reduce((s, m) => s + m.total, 0) +
      Object.values(result.charges).reduce((s, c) => s + c.total, 0)
    expect(ledgerSum).toBeCloseTo(result.totalCost, 10)
  })

  test('does not double-count: agent-embedded tool stays in the model row, not charges', () => {
    const traceSpans = [
      {
        id: 'agent-span',
        name: 'Agent',
        type: 'agent',
        model: 'gpt-4o',
        cost: { input: 0.01, output: 0.02, total: 0.045, toolCost: 0.015 },
        tokens: { input: 1000, output: 2000, total: 3000 },
      },
    ]

    const result = calculateCostSummary(traceSpans)

    expect(Object.keys(result.charges)).toHaveLength(0)
    expect(result.models['gpt-4o'].total).toBe(0.045)
    expect(result.models['gpt-4o'].toolCost).toBe(0.015)
  })

  test('mixed model + standalone tool run reconciles to total', () => {
    const traceSpans = [
      {
        id: 'agent',
        name: 'Agent',
        type: 'agent',
        model: 'gpt-4o',
        cost: { input: 0.01, output: 0.02, total: 0.03 },
        tokens: { input: 100, output: 200, total: 300 },
      },
      {
        id: 'exa',
        name: 'Exa Search',
        type: 'tool',
        cost: { input: 0, output: 0, total: 0.01 },
      },
    ]

    const result = calculateCostSummary(traceSpans)

    expect(result.models['gpt-4o'].total).toBe(0.03)
    expect(result.charges['Exa Search'].total).toBe(0.01)
    const ledgerSum =
      result.baseExecutionCharge +
      Object.values(result.models).reduce((s, m) => s + m.total, 0) +
      Object.values(result.charges).reduce((s, c) => s + c.total, 0)
    expect(ledgerSum).toBeCloseTo(result.totalCost, 10)
  })

  test('BYOK tool (no cost generated upstream) produces no charge row', () => {
    const traceSpans = [
      {
        id: 'exa-byok',
        name: 'Exa Search',
        type: 'tool',
        cost: { input: 0, output: 0, total: 0 },
      },
    ]

    const result = calculateCostSummary(traceSpans)

    expect(Object.keys(result.charges)).toHaveLength(0)
    expect(result.totalCost).toBe(BASE_EXECUTION_CHARGE)
  })

  test('does not double-count the synthetic workflow root (aggregate cost over leaves)', () => {
    // buildTraceSpans wraps every run in a synthetic { type: 'workflow' } root
    // whose cost.total is the SUM of its leaves. Counting that root in addition
    // to the leaves double-charges the run — the root must be a pass-through.
    const traceSpans = [
      {
        id: 'workflow-execution',
        name: 'Workflow Execution',
        type: 'workflow',
        cost: { total: 0.04 }, // == agent(0.03) + exa(0.01)
        children: [
          {
            id: 'agent-1',
            name: 'Agent',
            type: 'agent',
            model: 'gpt-4o',
            cost: { input: 0.01, output: 0.02, total: 0.03 },
            tokens: { input: 100, output: 200, total: 300 },
          },
          {
            id: 'exa-1',
            name: 'Exa Search',
            type: 'tool',
            cost: { input: 0, output: 0, total: 0.01 },
          },
        ],
      },
    ]

    const result = calculateCostSummary(traceSpans)

    // The 0.04 root aggregate is NOT added on top of its leaves.
    expect(result.charges['Workflow Execution']).toBeUndefined()
    expect(result.models['gpt-4o'].total).toBe(0.03)
    expect(result.charges['Exa Search'].total).toBe(0.01)
    expect(result.totalCost).toBeCloseTo(0.04 + BASE_EXECUTION_CHARGE, 10)
    const ledgerSum =
      result.baseExecutionCharge +
      Object.values(result.models).reduce((s, m) => s + m.total, 0) +
      Object.values(result.charges).reduce((s, c) => s + c.total, 0)
    expect(ledgerSum).toBeCloseTo(result.totalCost, 10)
  })

  test('does not double-count nested sub-workflow roots', () => {
    // A sub-workflow call nests another synthetic { type: 'workflow' } root
    // (captureChildWorkflowLogs runs buildTraceSpans on the child). Both the
    // outer root and the inner sub-workflow root carry aggregate costs; only the
    // leaf agent inside should be billed.
    const traceSpans = [
      {
        id: 'workflow-execution',
        name: 'Workflow Execution',
        type: 'workflow',
        cost: { total: 0.03 },
        children: [
          {
            id: 'subworkflow-root',
            name: 'Workflow Execution',
            type: 'workflow',
            cost: { total: 0.03 },
            children: [
              {
                id: 'child-agent',
                name: 'Agent',
                type: 'agent',
                model: 'gpt-4o',
                cost: { input: 0.01, output: 0.02, total: 0.03 },
                tokens: { input: 100, output: 200, total: 300 },
              },
            ],
          },
        ],
      },
    ]

    const result = calculateCostSummary(traceSpans)

    expect(result.charges['Workflow Execution']).toBeUndefined()
    expect(result.models['gpt-4o'].total).toBe(0.03)
    expect(result.totalCost).toBeCloseTo(0.03 + BASE_EXECUTION_CHARGE, 10)
  })

  test('does not double-count deeply nested (3-level) sub-workflow roots', () => {
    // A → B → C: each level is its own synthetic { type: 'workflow' } root with
    // an aggregate cost. Only the leaf agents at the bottom must be billed, once.
    const leafAgent = (id: string, model: string, total: number) => ({
      id,
      name: 'Agent',
      type: 'agent',
      model,
      cost: { input: total / 3, output: (total * 2) / 3, total },
      tokens: { input: 100, output: 200, total: 300 },
    })

    const traceSpans = [
      {
        id: 'root',
        name: 'Workflow Execution',
        type: 'workflow',
        cost: { total: 0.06 }, // aggregate of everything below
        children: [
          leafAgent('parent-agent', 'gpt-4o', 0.02),
          {
            id: 'sub-a-root',
            name: 'Workflow Execution',
            type: 'workflow',
            cost: { total: 0.04 },
            children: [
              leafAgent('a-agent', 'gpt-4o', 0.01),
              {
                id: 'sub-b-root',
                name: 'Workflow Execution',
                type: 'workflow',
                cost: { total: 0.03 },
                children: [leafAgent('b-agent', 'claude-sonnet-4-6', 0.03)],
              },
            ],
          },
        ],
      },
    ]

    const result = calculateCostSummary(traceSpans)

    expect(result.charges['Workflow Execution']).toBeUndefined()
    // gpt-4o appears at two levels (0.02 + 0.01) and merges by model name.
    expect(result.models['gpt-4o'].total).toBeCloseTo(0.03, 10)
    expect(result.models['claude-sonnet-4-6'].total).toBeCloseTo(0.03, 10)
    expect(result.totalCost).toBeCloseTo(0.06 + BASE_EXECUTION_CHARGE, 10)
    const ledgerSum =
      result.baseExecutionCharge +
      Object.values(result.models).reduce((s, m) => s + m.total, 0) +
      Object.values(result.charges).reduce((s, c) => s + c.total, 0)
    expect(ledgerSum).toBeCloseTo(result.totalCost, 10)
  })
})
