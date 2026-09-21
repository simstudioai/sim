import '@sim/testing/mocks/executor'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JevBlock } from '@/blocks/blocks/jev'
import { getBlock } from '@/blocks/index'
import { GenericBlockHandler } from '@/executor/handlers/generic/generic-handler'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'
import { jevChoiceTool, jevEvaluateTool, jevNoulTool, jevScoreTool } from '@/tools/jev'
import { prepareToolRequest } from '@/tools/request-transport'
import type { ToolConfig } from '@/tools/types'
import { getTool } from '@/tools/utils'

const TOOLS = {
  jev_choice: jevChoiceTool,
  jev_score: jevScoreTool,
  jev_noul: jevNoulTool,
  jev_evaluate: jevEvaluateTool,
}

function context(): ExecutionContext {
  return {
    workflowId: 'test-workflow',
    blockStates: new Map(),
    blockLogs: [],
    metadata: { duration: 0 },
    environmentVariables: {},
    decisions: { router: new Map(), condition: new Map() },
    loopExecutions: new Map(),
    executedBlocks: new Set(),
    activeExecutionPath: new Set(),
    completedLoops: new Set(),
  }
}

function block(tool: string): SerializedBlock {
  return {
    id: 'jev-block',
    metadata: { id: 'jev', name: 'Jev' },
    position: { x: 0, y: 0 },
    config: { tool, params: {} },
    inputs: {},
    outputs: {},
    enabled: true,
  }
}

describe('Jev workflow execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getBlock).mockReturnValue(JevBlock)
  })

  it.each([
    ['jev_choice', 'choiceCriteria', '{"yes":null,"no":null}', 'choice'],
    ['jev_score', 'scoreCriteria', '["Low","High"]', 'score'],
    ['jev_noul', 'noulCriteria', '{"true":"Urgent","false":"Routine"}', 'noul'],
  ] as const)(
    'maps the active %s criteria through the workflow handler',
    async (operation, field, criteria, type) => {
      const tool: ToolConfig = TOOLS[operation]
      vi.mocked(getTool).mockReturnValue(tool)
      vi.mocked(executeTool).mockImplementation(async (_id, params) => {
        const request = prepareToolRequest(tool, params)
        const body = JSON.parse(request.body!)
        expect(body.questions).toEqual({
          result: { type, instructions: 'Question', criteria: JSON.parse(criteria) },
        })
        expect(body.state).toBe('42')
        return { success: true, output: { model: 'jev-1.13.0' } }
      })
      const inputs = {
        apiKey: 'test-key',
        operation,
        state: '42',
        instructions: 'Question',
        choiceCriteria: '{"stale":null}',
        scoreCriteria: '["Stale","Rubric"]',
        noulCriteria: '{"true":"Stale"}',
        [field]: criteria,
      }
      expect(JevBlock.tools.config?.tool(inputs)).toBe(operation)
      await expect(
        new GenericBlockHandler().execute(context(), block(operation), inputs)
      ).resolves.toEqual({
        model: 'jev-1.13.0',
      })
      expect(executeTool).toHaveBeenCalledOnce()
    }
  )

  it('preserves resolved-secret projections when block fields map to criteria', async () => {
    const tool = jevChoiceTool
    vi.mocked(getTool).mockReturnValue(tool)
    const ctx = context()
    const criteria = '{"billing":"private-rule","technical":null}'
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'RULE', plaintext: 'private-rule', encryptedValue: 'encrypted-rule' },
    ])
    registry.recordResolvedAtInputPath('RULE', 'private-rule', ['choiceCriteria'])
    registry.recordResolvedInputProjection(
      ['choiceCriteria'],
      criteria,
      '{"billing":"{{RULE}}","technical":null}'
    )
    ctx.resolvedSecretTraceRegistry = registry
    vi.mocked(executeTool).mockImplementation(async (_id, params) => {
      const request = prepareToolRequest(tool, params, registry)
      expect(JSON.parse(request.body!).questions.result.criteria).toEqual({
        billing: '{{RULE}}',
        technical: null,
      })
      expect(request.body).not.toContain('private-rule')
      return { success: true, output: { choice: 'billing' } }
    })
    await new GenericBlockHandler().execute(ctx, block('jev_choice'), {
      apiKey: 'test-key',
      operation: 'jev_choice',
      state: 'Ticket text',
      instructions: 'Which team?',
      choiceCriteria: criteria,
    })
    expect(executeTool).toHaveBeenCalledOnce()
  })

  it('executes a mixed batch through block mapping, request formatting, and response transformation', async () => {
    vi.mocked(getTool).mockReturnValue(jevEvaluateTool)
    const answers = {
      urgent: { type: 'noul', noul: 0.9 },
      team: { type: 'choice', choice: 'billing', probabilities: { billing: 1 }, confidence: 1 },
    }
    vi.mocked(executeTool).mockImplementation(async (_id, params) => {
      const request = prepareToolRequest(jevEvaluateTool, params)
      expect(Object.keys(JSON.parse(request.body!).questions)).toEqual(['urgent', 'team'])
      return jevEvaluateTool.transformResponse!(
        Response.json({
          model: 'jev-1.13.0',
          answers,
          usage: { input_tokens: 50, output_tokens: 8 },
        })
      )
    })
    const output = await new GenericBlockHandler().execute(context(), block('jev_evaluate'), {
      apiKey: 'test-key',
      operation: 'jev_evaluate',
      state: { ticket: 'Payment failed' },
      questions: JSON.stringify({
        urgent: { type: 'noul', instructions: 'Is this urgent?' },
        team: { type: 'choice', instructions: 'Which team?', criteria: { billing: null } },
      }),
    })
    expect(output.answers).toEqual(answers)
  })
})
