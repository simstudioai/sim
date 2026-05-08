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
import { WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS } from '@/lib/workflows/search-replace/subflow-fields'

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

  it('replaces only the selected duplicate structured resource occurrence', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['knowledge-1'].subBlocks.knowledgeBaseIds.value = 'kb-old,kb-old,kb-second'

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'kb-old',
      mode: 'resource',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    }).filter((match) => match.kind === 'knowledge-base')

    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set([matches[0].id]),
      defaultReplacement: 'kb-new',
      resourceReplacementOptions: [
        { kind: 'knowledge-base', value: 'kb-new', label: 'New Knowledge Base' },
      ],
    })

    expect(plan.conflicts).toEqual([])
    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0].nextValue).toBe('kb-new,kb-old,kb-second')
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

  it('replaces loop and parallel subflow editor values', () => {
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
    }).filter((match) => match.target.kind === 'subflow')
    const collectionMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'item-2',
      mode: 'text',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    }).filter((match) => match.target.kind === 'subflow')

    const countPlan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches: countMatches,
      selectedMatchIds: new Set(countMatches.map((match) => match.id)),
      defaultReplacement: '3',
    })
    const collectionPlan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches: collectionMatches,
      selectedMatchIds: new Set(collectionMatches.map((match) => match.id)),
      defaultReplacement: 'item-3',
    })

    expect(countPlan.conflicts).toEqual([])
    expect(countPlan.subflowUpdates).toEqual([
      expect.objectContaining({
        blockId: 'parallel-1',
        blockType: 'parallel',
        fieldId: WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.iterations,
        previousValue: '20',
        nextValue: 3,
      }),
    ])
    expect(collectionPlan.conflicts).toEqual([])
    expect(collectionPlan.subflowUpdates).toEqual([
      expect.objectContaining({
        blockId: 'loop-1',
        blockType: 'loop',
        fieldId: WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.items,
        previousValue: "['item-2']",
        nextValue: "['item-3']",
      }),
    ])
  })

  it('replaces JSON-backed tag value fields without touching tag metadata', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['tag-block-1'] = {
      id: 'tag-block-1',
      type: 'custom',
      name: 'Tag Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        tagFilters: {
          id: 'tagFilters',
          type: 'knowledge-tag-filters',
          value: JSON.stringify([
            {
              id: 'filter-open',
              tagName: 'Status',
              fieldType: 'text',
              operator: 'eq',
              tagValue: 'open ticket',
              collapsed: false,
            },
          ]),
        },
        documentTags: {
          id: 'documentTags',
          type: 'document-tag-entry',
          value: JSON.stringify([
            {
              id: 'tag-open',
              tagName: 'Priority',
              fieldType: 'text',
              value: 'open escalation',
              collapsed: false,
            },
          ]),
        },
      },
    }
    const blockConfigs = {
      ...SEARCH_REPLACE_BLOCK_CONFIGS,
      custom: {
        subBlocks: [
          { id: 'tagFilters', title: 'Tag Filters', type: 'knowledge-tag-filters' },
          { id: 'documentTags', title: 'Document Tags', type: 'document-tag-entry' },
        ],
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'open',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'tag-block-1')

    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set(matches.map((match) => match.id)),
      defaultReplacement: 'resolved',
    })

    const tagFilterUpdate = plan.updates.find((update) => update.subBlockId === 'tagFilters')
    const documentTagUpdate = plan.updates.find((update) => update.subBlockId === 'documentTags')
    const nextTagFilterValue = JSON.parse(String(tagFilterUpdate?.nextValue))
    const nextDocumentTagValue = JSON.parse(String(documentTagUpdate?.nextValue))

    expect(plan.conflicts).toEqual([])
    expect(nextTagFilterValue).toEqual([
      {
        id: 'filter-open',
        tagName: 'Status',
        fieldType: 'text',
        operator: 'eq',
        tagValue: 'resolved ticket',
        collapsed: false,
      },
    ])
    expect(nextDocumentTagValue).toEqual([
      {
        id: 'tag-open',
        tagName: 'Priority',
        fieldType: 'text',
        value: 'resolved escalation',
        collapsed: false,
      },
    ])
  })

  it('replaces JSON-backed condition branch values without touching branch metadata', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['branch-1'] = {
      id: 'branch-1',
      type: 'custom',
      name: 'Branch Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        conditions: {
          id: 'conditions',
          type: 'condition-input',
          value: JSON.stringify([
            {
              id: 'branch-open',
              title: 'if',
              value: 'open ticket',
              showTags: false,
              showEnvVars: false,
            },
          ]),
        },
      },
    }
    const blockConfigs = {
      ...SEARCH_REPLACE_BLOCK_CONFIGS,
      custom: {
        subBlocks: [{ id: 'conditions', title: 'Conditions', type: 'condition-input' }],
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'open',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'branch-1')

    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set(matches.map((match) => match.id)),
      defaultReplacement: 'resolved',
    })

    const branchUpdate = plan.updates.find((update) => update.subBlockId === 'conditions')
    const nextValue = JSON.parse(String(branchUpdate?.nextValue))

    expect(plan.conflicts).toEqual([])
    expect(nextValue).toEqual([
      {
        id: 'branch-open',
        title: 'if',
        value: 'resolved ticket',
        showTags: false,
        showEnvVars: false,
      },
    ])
  })

  it('replaces object-backed input mapping values without changing mapping keys', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['mapping-1'] = {
      id: 'mapping-1',
      type: 'custom',
      name: 'Mapping Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        inputMapping: {
          id: 'inputMapping',
          type: 'input-mapping',
          value: { customerEmail: 'old email value' },
        },
      },
    }
    const blockConfigs = {
      ...SEARCH_REPLACE_BLOCK_CONFIGS,
      custom: {
        subBlocks: [{ id: 'inputMapping', title: 'Input Mapping', type: 'input-mapping' }],
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'old',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'mapping-1')

    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set(matches.map((match) => match.id)),
      defaultReplacement: 'new',
    })

    expect(plan.conflicts).toEqual([])
    expect(plan.updates).toEqual([
      expect.objectContaining({
        subBlockId: 'inputMapping',
        nextValue: { customerEmail: 'new email value' },
      }),
    ])
  })

  it('rejects invalid subflow iteration replacements', () => {
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
        count: 2,
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: '2',
      mode: 'text',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    }).filter((match) => match.target.kind === 'subflow')

    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set(matches.map((match) => match.id)),
      defaultReplacement: '25',
    })

    expect(plan.subflowUpdates).toEqual([])
    expect(plan.conflicts).toEqual([
      {
        matchId: matches[0].id,
        reason: 'Subflow iteration count must be between 1 and 20',
      },
    ])
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
