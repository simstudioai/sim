/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { indexWorkflowSearchMatches } from '@/lib/workflows/search-replace/indexer'
import { workflowSearchMatchMatchesQuery } from '@/lib/workflows/search-replace/resource-resolvers'
import {
  createSearchReplaceWorkflowFixture,
  SEARCH_REPLACE_BLOCK_CONFIGS,
} from '@/lib/workflows/search-replace/search-replace.fixtures'

describe('indexWorkflowSearchMatches', () => {
  it('finds plain text matches across nested subblock values', () => {
    const workflow = createSearchReplaceWorkflowFixture()

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'email',
      mode: 'text',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })

    expect(matches.map((match) => [match.blockId, match.subBlockId, match.valuePath])).toEqual([
      ['agent-1', 'systemPrompt', []],
      ['agent-1', 'systemPrompt', []],
      ['api-1', 'body', ['content']],
      ['locked-1', 'systemPrompt', []],
    ])
    expect(matches.at(-1)?.editable).toBe(false)
    expect(matches.at(-1)?.reason).toBe('Block is locked')
  })

  it('indexes environment tokens and workflow references embedded in strings', () => {
    const workflow = createSearchReplaceWorkflowFixture()

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'OLD_SECRET',
      mode: 'resource',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })

    expect(matches.filter((match) => match.kind === 'environment')).toHaveLength(2)
    expect(matches.every((match) => match.rawValue === '{{OLD_SECRET}}')).toBe(true)

    const references = indexWorkflowSearchMatches({
      workflow,
      query: 'start.output',
      mode: 'resource',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })
    expect(references.map((match) => match.kind)).toEqual(['workflow-reference'])
  })

  it('classifies structured resources by subblock type instead of UUID shape', () => {
    const workflow = createSearchReplaceWorkflowFixture()

    const matches = indexWorkflowSearchMatches({
      workflow,
      mode: 'resource',
      includeResourceMatchesWithoutQuery: true,
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })

    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'oauth-credential',
          rawValue: 'gmail-credential-old',
          resource: expect.objectContaining({ providerId: 'gmail' }),
        }),
        expect.objectContaining({ kind: 'knowledge-base', rawValue: 'kb-old' }),
        expect.objectContaining({ kind: 'knowledge-base', rawValue: 'kb-second' }),
        expect.objectContaining({ kind: 'knowledge-document', rawValue: 'doc-old' }),
      ])
    )
  })

  it('can enumerate resource candidates before display-label filtering', () => {
    const workflow = createSearchReplaceWorkflowFixture()

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'Test LMFAO',
      mode: 'all',
      includeResourceMatchesWithoutQuery: true,
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })

    const knowledgeMatch = matches.find(
      (match) => match.kind === 'knowledge-base' && match.rawValue === 'kb-old'
    )
    expect(knowledgeMatch).toBeDefined()
    expect(
      workflowSearchMatchMatchesQuery(
        { ...knowledgeMatch!, displayLabel: 'Test LMFAO' },
        'Test LMFAO'
      )
    ).toBe(true)
  })

  it('captures selector context for selector-backed resources', () => {
    const workflow = createSearchReplaceWorkflowFixture()

    const matches = indexWorkflowSearchMatches({
      workflow,
      mode: 'resource',
      includeResourceMatchesWithoutQuery: true,
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })

    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'selector-resource',
          rawValue: 'INBOX',
          resource: expect.objectContaining({
            selectorKey: 'gmail.labels',
            selectorContext: expect.objectContaining({
              oauthCredential: 'gmail-credential-old',
              workspaceId: 'workspace-1',
              workflowId: 'workflow-1',
            }),
          }),
        }),
        expect.objectContaining({
          kind: 'knowledge-document',
          rawValue: 'doc-old',
          resource: expect.objectContaining({
            selectorKey: 'knowledge.documents',
            selectorContext: expect.objectContaining({
              knowledgeBaseId: 'kb-old,kb-second',
            }),
          }),
        }),
      ])
    )
  })

  it('marks snapshot view matches as searchable but not editable', () => {
    const workflow = createSearchReplaceWorkflowFixture()

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'email',
      mode: 'text',
      isSnapshotView: true,
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })

    expect(matches.every((match) => !match.editable)).toBe(true)
    expect(matches.every((match) => match.reason === 'Snapshot view is readonly')).toBe(true)
  })
})
