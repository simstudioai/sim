import { describe, expect, it } from 'vitest'
import { verifyRecoveryEvidence } from '@/lib/benchmarks/evidence'
import type { ToolCallSummary } from '@/lib/mothership/request/types'

describe('benchmark source provenance', () => {
  const support = 'Use the Sim repository for issue intake.'
  const answer = {
    id: 'repository',
    answer: 'simstudioai/sim',
    support,
    sources: [{ citationId: 'repo', quote: 'simstudioai/sim' }],
  }
  const call: ToolCallSummary = {
    id: 'lookup',
    name: 'search_workspace',
    status: 'success',
    params: { specPassage: support, query: 'Sim repository' },
    result: {
      success: true,
      data: {
        results: [
          {
            citationId: 'repo',
            content: 'Repository simstudioai/sim',
            citationUrl: 'https://github.com/simstudioai/sim',
            documentName: 'Sim',
          },
        ],
      },
    },
  }

  it('attaches the actual source URL only to quotations retrieved for the same spec passage', () => {
    const [verified] = verifyRecoveryEvidence(support, [answer], [call])
    expect(verified.sources).toEqual([
      { ...answer.sources[0], url: 'https://github.com/simstudioai/sim', title: 'Sim' },
    ])
  })

  it.each([
    { ...call, status: 'error' as const },
    { ...call, name: 'sim_cli' },
    {
      ...call,
      params: { specPassage: 'Use the Mothership repository.', query: 'Mothership repository' },
    },
    {
      ...call,
      result: {
        success: true,
        data: { results: [{ citationId: 'different', content: 'simstudioai/sim' }] },
      },
    },
    {
      ...call,
      result: {
        success: true,
        data: { results: [{ citationId: 'repo', content: 'simstudioai/mothership' }] },
      },
    },
  ])(
    'preserves the answer for review but rejects failed, unrelated, or fabricated evidence',
    (toolCall) => {
      const [verified] = verifyRecoveryEvidence(support, [answer], [toolCall])
      expect(verified.answer).toBe(answer.answer)
      expect(verified.sources).toEqual([])
      expect(verified.evidenceError).toContain('repo')
    }
  )

  it('does not turn an unsafe retrieved URL into a clickable source', () => {
    const [verified] = verifyRecoveryEvidence(
      support,
      [answer],
      [
        {
          ...call,
          result: {
            success: true,
            data: {
              results: [
                {
                  citationId: 'repo',
                  content: 'simstudioai/sim',
                  citationUrl: 'javascript:alert(1)',
                },
              ],
            },
          },
        },
      ]
    )
    expect(verified.sources?.[0].url).toBeUndefined()
  })
})
