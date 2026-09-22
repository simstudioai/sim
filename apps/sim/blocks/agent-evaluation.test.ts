/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getEffectiveBlockOutputPaths,
  getEffectiveBlockOutputs,
  getEffectiveBlockOutputType,
} from '@/lib/workflows/blocks/block-outputs'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { AgentBlock } from '@/blocks/blocks/agent'
import { getAgentModelOptions, getModelOptions } from '@/blocks/utils'
import { getBaseModelProviders } from '@/providers/models'
import { Serializer } from '@/serializer'
import { useProvidersStore } from '@/stores/providers/store'
import type { BlockState } from '@/stores/workflows/workflow/types'

const { mockGetBlock } = vi.hoisted(() => ({ mockGetBlock: vi.fn() }))

vi.mock('@/blocks', () => ({ getBlock: mockGetBlock }))

describe('Agent evaluation configuration', () => {
  beforeEach(() => {
    mockGetBlock.mockReturnValue(AgentBlock)
  })

  it.each(['jev-1.13.0', 'jev-latest', 'jev-preview'])(
    'shows native fields and credentials for %s',
    (model) => {
      const visible = AgentBlock.subBlocks
        .filter((field) => evaluateSubBlockCondition(field.condition, { model }))
        .map((field) => field.id)
      expect(visible).toEqual(['model', 'evaluationState', 'evaluationQuestions', 'apiKey'])
    }
  )

  it('keeps evaluation inputs configurable for a model reference', () => {
    for (const field of AgentBlock.subBlocks.filter((field) => field.id.startsWith('evaluation'))) {
      expect(evaluateSubBlockCondition(field.condition, { model: '<start.model>' })).toBe(true)
    }
  })

  it.each(['jev-1.13.0', '<start.model>', '{{MODEL_ID}}'])(
    'exposes answers for %s in downstream selectors',
    (model) => {
      const values = { model: { value: model } }
      expect(getEffectiveBlockOutputs('agent', values)).toHaveProperty('answers')
      expect(getEffectiveBlockOutputPaths('agent', values)).toContain('answers')
      expect(getEffectiveBlockOutputType('agent', 'answers', values)).toBe('json')
    }
  )

  it('does not expose evaluation answers for a known chat model', () => {
    expect(getEffectiveBlockOutputs('agent', { model: { value: 'gpt-4o' } })).not.toHaveProperty(
      'answers'
    )
  })

  it.each(['jev-1.13.0', '<start.model>'])(
    'keeps answers accessible with a saved chat schema for %s',
    (model) => {
      const outputs = getEffectiveBlockOutputs('agent', {
        model: { value: model },
        responseFormat: {
          value: { schema: { type: 'object', properties: { title: { type: 'string' } } } },
        },
      })
      expect(outputs).toHaveProperty('answers')
      if (model === 'jev-1.13.0') expect(outputs).not.toHaveProperty('title')
      else expect(outputs).toHaveProperty('title')
    }
  )

  it('shows Jev only in the model picker that supports evaluation inputs', () => {
    useProvidersStore.getState().setProviderModels('base', Object.keys(getBaseModelProviders()))
    expect(getAgentModelOptions().map((option) => option.id)).toContain('jev-1.13.0')
    expect(getModelOptions().map((option) => option.id)).not.toContain('jev-1.13.0')
  })

  it.each([false, true])(
    'serializes native fields without requiring messages, advanced=%s',
    (advancedMode) => {
      const values = {
        model: 'jev-1.13.0',
        apiKey: '{{TYPESAFE_API_KEY}}',
        evaluationState: '42',
        evaluationQuestions: '{"passed":{"type":"noul","instructions":"Did it pass?"}}',
        messages: JSON.stringify([{ role: 'user', content: 'Old chat prompt' }]),
      }
      const block: BlockState = {
        id: 'agent-test',
        type: 'agent',
        name: 'Evaluator',
        position: { x: 0, y: 0 },
        enabled: true,
        advancedMode,
        outputs: {},
        subBlocks: Object.fromEntries(
          Object.entries(values).map(([id, value]) => [
            id,
            { id, value, type: AgentBlock.subBlocks.find((field) => field.id === id)!.type },
          ])
        ),
      }
      const result = new Serializer().serializeWorkflow({ [block.id]: block }, [], {}, {}, true)
      expect(result.blocks[0].config.tool).toBe('typesafe')
      expect(result.blocks[0].config.params).toMatchObject({
        evaluationState: '42',
        evaluationQuestions: values.evaluationQuestions,
      })
      expect(result.blocks[0].config.params).not.toHaveProperty('messages')
    }
  )
})
