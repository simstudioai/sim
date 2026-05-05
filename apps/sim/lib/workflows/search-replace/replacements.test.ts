/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { indexWorkflowSearchMatches } from '@/lib/workflows/search-replace/indexer'
import { buildWorkflowSearchReplacePlan } from '@/lib/workflows/search-replace/replacements'
import {
  createSearchReplaceWorkflowFixture,
  SEARCH_REPLACE_BLOCK_CONFIGS,
} from '@/lib/workflows/search-replace/search-replace.fixtures'

describe('buildWorkflowSearchReplacePlan', () => {
  it('replaces selected text ranges across blocks without touching unselected matches', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'email',
      mode: 'text',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })
    const selectedMatchIds = new Set(matches.slice(0, 2).map((match) => match.id))

    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds,
      defaultReplacement: 'message',
    })

    expect(plan.conflicts).toEqual([])
    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0]).toMatchObject({
      blockId: 'agent-1',
      subBlockId: 'systemPrompt',
      nextValue: 'message {{OLD_SECRET}} and then message again. Use <start.output>.',
    })
  })

  it('replaces environment tokens while preserving surrounding text', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'OLD_SECRET',
      mode: 'resource',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })
    const selectedMatchIds = new Set(matches.map((match) => match.id))

    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds,
      defaultReplacement: 'NEW_SECRET',
      resourceReplacementOptions: [
        { kind: 'environment', value: '{{NEW_SECRET}}', label: '{{NEW_SECRET}}' },
      ],
    })

    expect(plan.conflicts).toEqual([])
    expect(plan.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blockId: 'agent-1',
          subBlockId: 'systemPrompt',
          nextValue: 'Email {{NEW_SECRET}} and then email again. Use <start.output>.',
        }),
        expect.objectContaining({
          blockId: 'api-1',
          subBlockId: 'headers',
          nextValue: [
            { id: 'row-1', cells: { Key: 'Authorization', Value: 'Bearer {{NEW_SECRET}}' } },
          ],
        }),
      ])
    )
  })

  it('replaces exact structured resources in comma-separated values', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'kb-old',
      mode: 'resource',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })

    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set(matches.map((match) => match.id)),
      defaultReplacement: 'kb-new',
      resourceReplacementOptions: [
        { kind: 'knowledge-base', value: 'kb-new', label: 'New Knowledge Base' },
      ],
    })

    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0].nextValue).toBe('kb-new,kb-second')
  })

  it('replaces all compatible knowledge base references across blocks', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['knowledge-2'] = {
      ...workflow.blocks['knowledge-1'],
      id: 'knowledge-2',
      name: 'Knowledge 2',
      subBlocks: {
        ...workflow.blocks['knowledge-1'].subBlocks,
        knowledgeBaseIds: {
          id: 'knowledgeBaseIds',
          type: 'knowledge-base-selector',
          value: 'kb-old',
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'kb-old',
      mode: 'resource',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    }).filter((match) => match.kind === 'knowledge-base')

    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set(matches.map((match) => match.id)),
      defaultReplacement: 'kb-new',
      resourceReplacementOptions: [
        { kind: 'knowledge-base', value: 'kb-new', label: 'New Knowledge Base' },
      ],
    })

    expect(plan.conflicts).toEqual([])
    expect(plan.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ blockId: 'knowledge-1', nextValue: 'kb-new,kb-second' }),
        expect.objectContaining({ blockId: 'knowledge-2', nextValue: 'kb-new' }),
      ])
    )
  })

  it('rejects structured resource replacements that are not resolvable options', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'kb-old',
      mode: 'resource',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })

    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set(matches.map((match) => match.id)),
      defaultReplacement: 'missing-kb',
      resourceReplacementOptions: [
        { kind: 'knowledge-base', value: 'kb-new', label: 'New Knowledge Base' },
      ],
    })

    expect(plan.updates).toEqual([])
    expect(plan.conflicts).toEqual([
      { matchId: matches[0].id, reason: 'Choose a valid knowledge base replacement.' },
    ])
  })

  it('rejects stale matches without partial writes', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'email',
      mode: 'text',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })
    workflow.blocks['agent-1'].subBlocks.systemPrompt.value = 'changed'

    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set([matches[0].id]),
      defaultReplacement: 'message',
    })

    expect(plan.updates).toEqual([])
    expect(plan.conflicts).toEqual([
      { matchId: matches[0].id, reason: 'Target text changed since search' },
    ])
  })
})
