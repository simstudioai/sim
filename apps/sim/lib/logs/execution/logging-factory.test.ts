import { workflowsPersistenceUtilsMock, workflowsPersistenceUtilsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { calculateCostSummary } from '@/lib/logs/execution/logging-factory'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'

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

  test('keeps tokens for a zero-cost BYOK span so unbilled usage stays reportable', () => {
    // A BYOK model resolves through notBilledCost(), which zeroes every cost field
    // but leaves `cost` DEFINED and the token counts intact. hasBillableCost() tests
    // `cost !== undefined`, not `cost.total > 0`, which is the only reason this span
    // reaches the summary at all. Narrowing that predicate would silently stop the
    // organization usage panel from ever seeing BYOK volume.
    const traceSpans = [
      {
        id: 'span-1',
        name: 'Agent Block',
        type: 'agent',
        model: 'claude-sonnet-4',
        cost: { input: 0, output: 0, total: 0 },
        tokens: { input: 1200, output: 340, total: 1540 },
      },
    ]

    const result = calculateCostSummary(traceSpans)

    expect(result.totalCost).toBe(BASE_EXECUTION_CHARGE)
    expect(result.workflowLedgerModels['claude-sonnet-4']).toMatchObject({
      total: 0,
      tokens: { input: 1200, output: 340, total: 1540 },
    })
    expect(result.totalPromptTokens).toBe(1200)
    expect(result.totalCompletionTokens).toBe(340)
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

  test('keeps Mothership cost observable while excluding it from workflow-owned ledger models', () => {
    const { traceSpans } = buildTraceSpans({
      success: true,
      output: {},
      logs: [
        {
          blockId: 'mothership-block',
          blockName: 'Mothership',
          blockType: 'mothership',
          executionOrder: 1,
          startedAt: '2026-07-10T12:00:00.000Z',
          endedAt: '2026-07-10T12:00:01.000Z',
          durationMs: 1000,
          success: true,
          output: {
            model: 'mothership',
            cost: { input: 0.2, output: 0.3, total: 0.5 },
            tokens: { input: 200, output: 300, total: 500 },
          },
        },
        {
          blockId: 'agent-block',
          blockName: 'Agent',
          blockType: 'agent',
          executionOrder: 2,
          startedAt: '2026-07-10T12:00:01.000Z',
          endedAt: '2026-07-10T12:00:02.000Z',
          durationMs: 1000,
          success: true,
          output: {
            model: 'gpt-4o',
            cost: { input: 0.4, output: 0.6, total: 1 },
            tokens: { input: 400, output: 600, total: 1000 },
          },
        },
      ],
      metadata: { duration: 2000 },
    })
    const result = calculateCostSummary(traceSpans)
    const mothershipSpan = traceSpans[0].children?.find((span) => span.type === 'mothership')

    expect(mothershipSpan?.cost?.total).toBe(0.5)
    expect(result.totalCost).toBe(1.5 + BASE_EXECUTION_CHARGE)
    expect(result.models.mothership).toMatchObject({
      input: 0.2,
      output: 0.3,
      total: 0.5,
      tokens: { input: 200, output: 300, total: 500 },
    })
    expect(result.workflowLedgerModels).not.toHaveProperty('mothership')
    expect(result.workflowLedgerModels['gpt-4o']).toMatchObject({
      input: 0.4,
      output: 0.6,
      total: 1,
      tokens: { input: 400, output: 600, total: 1000 },
    })
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
})

describe('calculateCostSummary base charge override', () => {
  test('an invoked child adds no execution fee when given zero', () => {
    const result = calculateCostSummary([], { baseExecutionCharge: 0 })

    expect(result.baseExecutionCharge).toBe(0)
    expect(result.totalCost).toBe(0)
  })
})
