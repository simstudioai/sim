/** @vitest-environment node */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getEffectiveBlockOutputPaths,
  getEffectiveBlockOutputs,
  getEffectiveBlockOutputType,
} from '@/lib/workflows/blocks/block-outputs'
import { getBlockReferenceTags } from '@/lib/workflows/blocks/block-reference-tags'
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
  afterEach(resetEnvFlagsMock)
  beforeEach(() => {
    mockGetBlock.mockReturnValue(AgentBlock)
  })

  it.each(['jev-1.13.0', 'jev-latest', 'jev-preview'])(
    'shows native fields and credentials for %s',
    (model) => {
      const visible = AgentBlock.subBlocks
        .filter((field) => evaluateSubBlockCondition(field.condition, { model }))
        .map((field) => field.id)
      expect(visible).toEqual(['model', 'apiKey', 'evaluationState', 'evaluationQuestions'])
    }
  )

  it('keeps evaluation inputs configurable for a model reference', () => {
    for (const field of AgentBlock.subBlocks.filter((field) => field.id.startsWith('evaluation'))) {
      expect(evaluateSubBlockCondition(field.condition, { model: '<start.model>' })).toBe(true)
    }
  })

  it.each([false, true])('shows TypeSafe credentials only when needed, hosted=%s', (hosted) => {
    setEnvFlags({ isHosted: hosted })
    const apiKey = AgentBlock.subBlocks.find((field) => field.id === 'apiKey')!
    expect(evaluateSubBlockCondition(apiKey.condition, { model: 'jev-latest' })).toBe(!hosted)
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

  describe('evaluation answer references', () => {
    const questions = {
      category: { type: 'choice', instructions: 'Choose a category', criteria: { a: 'A', b: 'B' } },
      rating: { type: 'score', instructions: 'Rate the result', criteria: ['Low', 'High'] },
      passed: { type: 'noul', instructions: 'Did it pass?' },
    }

    it.each(['jev-1.13.0', 'jev-latest', 'jev-preview', '<start.model>', '{{MODEL_ID}}'])(
      'exposes typed question fields for %s without an execution result',
      (model) => {
        const values = {
          model: { value: model },
          evaluationQuestions: { value: JSON.stringify(questions) },
          responseFormat: {
            value: { schema: { type: 'object', properties: { title: { type: 'string' } } } },
          },
        }
        const tags = getBlockReferenceTags({
          block: { id: 'agent-test', type: 'agent', name: 'Evaluate', subBlocks: values },
        })
        const fields = {
          'answers.category.choice': 'string',
          'answers.category.confidence': 'number',
          'answers.category.probabilities': 'json',
          'answers.category.type': 'string',
          'answers.rating.score': 'number',
          'answers.rating.confidence': 'number',
          'answers.rating.legend': 'json',
          'answers.passed.noul': 'number',
        }
        for (const [path, type] of Object.entries(fields)) {
          expect(tags).toContain(`evaluate.${path}`)
          expect(getEffectiveBlockOutputType('agent', path, values)).toBe(type)
        }
        expect(getEffectiveBlockOutputType('agent', 'answers', values)).toBe('json')
        expect(getEffectiveBlockOutputType('agent', 'answers.category', values)).toBe('json')
        expect(tags).not.toContain('evaluate.answers.passed.confidence')
        expect(tags.includes('evaluate.title')).toBe(!model.startsWith('jev-'))
      }
    )

    it.each([undefined, '', '{', '<start.questions>', '{{QUESTIONS}}', [], null, { unknown: {} }])(
      'keeps the answers object selectable when questions cannot be inferred: %j',
      (value) => {
        const values = { model: { value: 'jev-latest' }, evaluationQuestions: { value } }
        expect(getEffectiveBlockOutputPaths('agent', values)).toContain('answers')
        expect(getEffectiveBlockOutputType('agent', 'answers', values)).toBe('json')
      }
    )

    it('uses structured questions and follows edits without leaking fields into chat models', () => {
      const values = {
        model: { value: 'jev-latest' },
        evaluationQuestions: { value: { result: questions.category } },
      }
      expect(getEffectiveBlockOutputPaths('agent', values)).toContain('answers.result.choice')
      expect(
        getEffectiveBlockOutputPaths('agent', {
          ...values,
          evaluationQuestions: { value: { result: questions.passed } },
        })
      ).not.toContain('answers.result.choice')
      expect(
        getEffectiveBlockOutputPaths('agent', {
          ...values,
          model: { value: 'gpt-4o' },
        }).some((path) => path.startsWith('answers'))
      ).toBe(false)
    })

    it('does not offer ambiguous reference paths for special question IDs', () => {
      const values = {
        model: { value: 'jev-latest' },
        evaluationQuestions: {
          value: {
            'with.dot': questions.passed,
            'with space': questions.passed,
            'with[0]': questions.passed,
            '<start.question>': questions.passed,
            'valid-id_1': questions.passed,
          },
        },
      }
      const paths = getEffectiveBlockOutputPaths('agent', values)
      expect(paths.filter((path) => path.startsWith('answers.'))).toEqual([
        'answers.valid-id_1.noul',
        'answers.valid-id_1.type',
      ])
      expect(getEffectiveBlockOutputType('agent', 'answers', values)).toBe('json')
    })

    it.each(['type', 'properties', 'description', '__proto__'])(
      'resolves the question named %s through schema properties',
      (id) => {
        const values = {
          model: { value: 'jev-latest' },
          evaluationQuestions: { value: { [id]: questions.passed } },
        }
        expect(getEffectiveBlockOutputPaths('agent', values)).toContain(`answers.${id}.noul`)
        expect(getEffectiveBlockOutputType('agent', `answers.${id}.noul`, values)).toBe('number')
      }
    )
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
