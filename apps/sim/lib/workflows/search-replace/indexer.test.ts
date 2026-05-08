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
import { WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS } from '@/lib/workflows/search-replace/subflow-fields'

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

  it('does not index internal row metadata in structured subblock values', () => {
    const workflow = createSearchReplaceWorkflowFixture()

    const rowMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'row-1',
      mode: 'text',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })
    workflow.blocks['api-1'].subBlocks.body.value = {
      filtersById: {
        'filter-1': {
          id: 'filter-2',
          collapsed: false,
          value: '',
        },
      },
    }
    const objectMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'filter-2',
      mode: 'text',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })

    expect(rowMatches).toEqual([])
    expect(objectMatches).toEqual([])
  })

  it('indexes non-string scalar values as searchable but not editable', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['api-1'].subBlocks.body.value = { count: 2, enabled: true }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: '2',
      mode: 'text',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    }).filter((match) => match.blockId === 'api-1')

    expect(matches).toEqual([
      expect.objectContaining({
        valuePath: ['count'],
        rawValue: '2',
        editable: false,
        reason: 'Only text values can be replaced',
      }),
    ])
  })

  it('indexes loop and parallel editor settings for navigation', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['parallel-1'] = {
      id: 'parallel-1',
      type: 'parallel',
      name: 'Parallel 1',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {},
      data: {
        parallelType: 'count',
        count: 20,
      },
    }
    workflow.blocks['loop-1'] = {
      id: 'loop-1',
      type: 'loop',
      name: 'Loop 1',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {},
      data: {
        loopType: 'forEach',
        collection: "['item-2']",
      },
    }

    const countMatches = indexWorkflowSearchMatches({
      workflow,
      query: '20',
      mode: 'text',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })
    const collectionMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'item-2',
      mode: 'text',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })

    expect(countMatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blockId: 'parallel-1',
          subBlockId: WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.iterations,
          canonicalSubBlockId: WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.iterations,
          fieldTitle: 'Parallel Iterations',
          editable: true,
          target: {
            kind: 'subflow',
            fieldId: WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.iterations,
          },
        }),
      ])
    )
    expect(collectionMatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blockId: 'loop-1',
          subBlockId: WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.items,
          canonicalSubBlockId: WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.items,
          fieldTitle: 'Collection Items',
          editable: true,
          target: {
            kind: 'subflow',
            fieldId: WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.items,
          },
        }),
      ])
    )
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

  it('does not match opaque structured resource ids during display-label filtering', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['knowledge-1'].subBlocks.knowledgeBaseIds.value = 'kb-2-opaque-id'

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: '2',
      mode: 'all',
      includeResourceMatchesWithoutQuery: true,
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })
    const knowledgeMatch = matches.find(
      (match) => match.kind === 'knowledge-base' && match.rawValue === 'kb-2-opaque-id'
    )

    expect(knowledgeMatch).toBeDefined()
    expect(
      workflowSearchMatchMatchesQuery({ ...knowledgeMatch!, displayLabel: 'Support Articles' }, '2')
    ).toBe(false)
    expect(
      workflowSearchMatchMatchesQuery(
        { ...knowledgeMatch!, displayLabel: 'Support Articles 2' },
        '2'
      )
    ).toBe(true)
  })

  it('does not index structured resource ids as plain text matches', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['knowledge-1'].subBlocks.knowledgeBaseIds.value = 'kb-2-opaque-id'

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: '2',
      mode: 'all',
      includeResourceMatchesWithoutQuery: true,
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })

    expect(
      matches.some(
        (match) =>
          match.kind === 'text' &&
          match.blockId === 'knowledge-1' &&
          match.subBlockId === 'knowledgeBaseIds'
      )
    ).toBe(false)
    expect(
      matches.some(
        (match) =>
          match.kind === 'knowledge-base' &&
          match.blockId === 'knowledge-1' &&
          match.subBlockId === 'knowledgeBaseIds'
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

  it('marks readonly workflow matches as searchable but not editable', () => {
    const workflow = createSearchReplaceWorkflowFixture()

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'email',
      mode: 'text',
      isReadOnly: true,
      readonlyReason: 'Workflow is locked',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })

    expect(matches.every((match) => !match.editable)).toBe(true)
    expect(matches.every((match) => match.reason === 'Workflow is locked')).toBe(true)
  })
})
