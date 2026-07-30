/**
 * Guards backwards compatibility for Exa workflows saved before the API refresh.
 *
 * The serializer (`extractBlockParams`) decides which stored sub-block values
 * survive: a value whose sub-block config was removed is dropped, and a value
 * whose sub-block condition does not match the current operation is dropped too
 * (an `advanced` field still serializes when it holds a non-empty stored value).
 * These tests assert the block config satisfies those rules, since the config is
 * what drives that behavior.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ExaBlock } from '@/blocks/blocks/exa'
import { agentTool } from '@/tools/exa/agent'
import { searchTool } from '@/tools/exa/search'

/** Drives postProcess against a run that is already terminal on creation. */
async function settleRun(status: string, stopReason: string | null = null) {
  return agentTool.postProcess?.(
    {
      success: true,
      output: {
        runId: 'agent_run_1',
        status,
        stopReason,
        text: status === 'completed' ? 'the answer' : '',
      },
    } as never,
    { apiKey: 'k', query: 'q' } as never,
    {} as never
  )
}

const subBlockIds = new Set(ExaBlock.subBlocks.map((subBlock) => subBlock.id))

function conditionValues(id: string): unknown[] {
  return ExaBlock.subBlocks
    .filter((subBlock) => subBlock.id === id)
    .flatMap((subBlock) => {
      const value = subBlock.condition?.value
      return Array.isArray(value) ? value : [value]
    })
}

describe('legacy Exa workflow replay', () => {
  it('drops livecrawl and useAutoprompt, which no sub-block declares any more', () => {
    expect(subBlockIds.has('livecrawl')).toBe(false)
    expect(subBlockIds.has('useAutoprompt')).toBe(false)
  })

  it('routes a saved research operation to the agent tool', () => {
    expect(ExaBlock.tools.config?.tool?.({ operation: 'exa_research' })).toBe('exa_agent')
  })

  it('keeps carrying a stored research query, whose condition still matches', () => {
    expect(conditionValues('query')).toContain('exa_research')
  })

  it('carries the agent inputs across for a replayed research operation', () => {
    for (const id of ['effort', 'outputSchema', 'systemPrompt', 'previousRunId']) {
      expect(conditionValues(id)).toContain('exa_research')
    }
  })

  it('still declares the deprecated crawl-date filters so saved values survive', () => {
    expect(subBlockIds.has('startCrawlDate')).toBe(true)
    expect(subBlockIds.has('endCrawlDate')).toBe(true)
  })

  it('still sends a legacy search type and remaps a retired category', () => {
    const body = searchTool.request.body?.({
      query: 'q',
      apiKey: 'k',
      type: 'neural',
      category: 'news_article',
    } as never) as Record<string, any>
    expect(body.type).toBe('neural')
    expect(body.category).toBe('news')
  })

  it('emits the retired research output shape so downstream references resolve', async () => {
    const settled = await settleRun('completed')
    expect(settled?.output.research).toEqual([
      { title: 'Research Complete', url: '', summary: 'the answer', text: 'the answer', score: 1 },
    ])
  })

  it('sends no freshness control when a workflow configured none', () => {
    const body = searchTool.request.body?.({
      query: 'q',
      apiKey: 'k',
      text: true,
    } as never) as Record<string, any>
    expect(body.contents.livecrawl).toBeUndefined()
    expect(body.contents.maxAgeHours).toBeUndefined()
  })
})
