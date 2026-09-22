import { describe, expect, it, vi } from 'vitest'
import { isAgentToolBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/utils'
import { JevBlock } from '@/blocks/blocks/jev'
import { prepareToolExecution, transformBlockTool } from '@/providers/utils'
import { jevChoiceTool, jevEvaluateTool, jevNoulTool, jevScoreTool } from '@/tools/jev'
import { getSubBlocksForToolInput } from '@/tools/params'
import { prepareToolRequest } from '@/tools/request-transport'
import type { ToolConfig } from '@/tools/types'

vi.unmock('@/tools/metadata')

const TOOLS: Record<string, ToolConfig> = {
  jev_choice: jevChoiceTool,
  jev_score: jevScoreTool,
  jev_noul: jevNoulTool,
  jev_evaluate: jevEvaluateTool,
}

const CASES = [
  {
    operation: 'jev_choice',
    args: { criteria: { billing: 'Payments', technical: 'Bugs' } },
    questions: {
      result: {
        type: 'choice',
        instructions: 'Question',
        criteria: { billing: 'Payments', technical: 'Bugs' },
      },
    },
  },
  {
    operation: 'jev_score',
    args: { criteria: ['Low', 'High'] },
    questions: {
      result: { type: 'score', instructions: 'Question', criteria: ['Low', 'High'] },
    },
  },
  {
    operation: 'jev_noul',
    args: { criteria: { true: 'Urgent', false: 'Routine' } },
    questions: {
      result: {
        type: 'noul',
        instructions: 'Question',
        criteria: { true: 'Urgent', false: 'Routine' },
      },
    },
  },
  {
    operation: 'jev_evaluate',
    args: { questions: { urgent: { type: 'noul', instructions: 'Is this urgent?' } } },
    questions: { urgent: { type: 'noul', instructions: 'Is this urgent?' } },
  },
]

async function agentTool(operation: string, params: Record<string, unknown>) {
  const tool = await transformBlockTool(
    { type: 'jev', operation, params },
    {
      selectedOperation: operation,
      getAllBlocks: () => [JevBlock],
      getTool: (id) => TOOLS[id],
    }
  )
  if (!tool) throw new Error(`Missing Agent tool for ${operation}`)
  return tool
}

describe('Jev Agent tools', () => {
  it.each(CASES)('offers editable inputs for $operation in the Agent picker', ({ operation }) => {
    expect(isAgentToolBlock(JevBlock)).toBe(true)
    const fields = getSubBlocksForToolInput(
      operation,
      'jev',
      { operation },
      undefined,
      JevBlock
    )?.subBlocks
    const input = operation === 'jev_evaluate' ? 'questions' : 'criteria'
    expect(fields?.find((field) => field.id === input)?.paramVisibility).toBe('user-or-llm')
    expect(fields?.find((field) => field.id === 'apiKey')?.paramVisibility).toBe('user-only')
  })

  describe.each(['model', 'user'] as const)('%s-supplied decision inputs', (source) => {
    it.each(CASES)(
      'prepares $operation through the shared Agent adapter',
      async ({ operation, args, questions }) => {
        const userParams: Record<string, unknown> = {
          apiKey: 'test-key',
          state: '42',
          instructions: 'Question',
        }
        if (source === 'user') {
          for (const [key, value] of Object.entries(args)) {
            userParams[key] = JSON.stringify(value)
          }
        }
        const tool = await agentTool(operation, userParams)
        expect(tool.id).toBe(operation)
        expect(tool.parameters.properties).not.toHaveProperty('apiKey')
        expect(tool.modelBlockedParams).toContain('apiKey')
        const { toolParams } = prepareToolExecution(
          tool,
          { ...(source === 'model' ? args : {}), apiKey: 'model-key' },
          {},
          'test-call'
        )
        const request = prepareToolRequest(TOOLS[operation], toolParams)
        expect(request.headers.get('Authorization')).toBe('Bearer test-key')
        expect(JSON.parse(request.body!)).toEqual({
          state: '42',
          model: 'jev-1.13.0',
          questions,
        })
      }
    )
  })

  it('advertises the Score rubric as a bounded array to the Agent model', async () => {
    const tool = await agentTool('jev_score', { apiKey: 'test-key' })
    expect(tool.parameters.properties.criteria).toMatchObject({
      type: 'array',
      minItems: 2,
      maxItems: 10,
    })
  })
})
