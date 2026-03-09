import { loggerMock } from '@sim/testing'
import { describe, expect, test, vi } from 'vitest'
import {
  calculateCostSummary,
  createEnvironmentObject,
  createTriggerObject,
} from '@/lib/logs/execution/logging-factory'

// Mock the billing constants
vi.mock('@/lib/billing/constants', () => ({
  BASE_EXECUTION_CHARGE: 0.005,
}))

vi.mock('@sim/logger', () => loggerMock)

// Mock workflow persistence utils
vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadDeployedWorkflowState: vi.fn(() =>
    Promise.resolve({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
    })
  ),
  loadWorkflowFromNormalizedTables: vi.fn(() =>
    Promise.resolve({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
    })
  ),
}))

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
    expect(result.modelCost).toBe(0)
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
    expect(result.modelCost).toBe(0.03)
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
    expect(result.modelCost).toBe(0.033)
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

    expect(result.modelCost).toBe(0.03)
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

    expect(result.modelCost).toBe(0.03)
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

    expect(result.modelCost).toBe(0.03)
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

    expect(result.modelCost).toBe(0.03)
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
})
