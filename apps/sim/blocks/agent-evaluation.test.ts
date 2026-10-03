import { resetEnvFlagsMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getEffectiveBlockOutputPaths,
  getEffectiveBlockOutputType,
} from '@/lib/workflows/blocks/block-outputs'
import { getBlockReferenceTags } from '@/lib/workflows/blocks/block-reference-tags'
import { AgentBlock } from '@/blocks/blocks/agent'

const { mockGetBlock } = vi.hoisted(() => ({ mockGetBlock: vi.fn() }))

vi.mock('@/blocks', () => ({ getBlock: mockGetBlock }))

describe('Agent evaluation configuration', () => {
  afterEach(resetEnvFlagsMock)
  beforeEach(() => {
    mockGetBlock.mockReturnValue(AgentBlock)
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
})
