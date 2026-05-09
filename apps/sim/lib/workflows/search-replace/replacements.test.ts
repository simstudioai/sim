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

  it('replaces a selected duplicate structured resource when duplicates are separated', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['knowledge-1'].subBlocks.knowledgeBaseIds.value = 'kb-old,kb-second,kb-old'

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'kb-old',
      mode: 'resource',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    }).filter((match) => match.kind === 'knowledge-base')

    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set([matches[1].id]),
      defaultReplacement: 'kb-new',
      resourceReplacementOptions: [
        { kind: 'knowledge-base', value: 'kb-new', label: 'New Knowledge Base' },
      ],
    })

    expect(plan.conflicts).toEqual([])
    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0].nextValue).toBe('kb-old,kb-second,kb-new')
  })

  it('conflicts when a selected duplicate structured resource occurrence is removed', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['knowledge-1'].subBlocks.knowledgeBaseIds.value = 'kb-old,kb-second,kb-old'

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'kb-old',
      mode: 'resource',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    }).filter((match) => match.kind === 'knowledge-base')

    workflow.blocks['knowledge-1'].subBlocks.knowledgeBaseIds.value = 'kb-old,kb-second'

    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set([matches[1].id]),
      defaultReplacement: 'kb-new',
      resourceReplacementOptions: [
        { kind: 'knowledge-base', value: 'kb-new', label: 'New Knowledge Base' },
      ],
    })

    expect(plan.updates).toEqual([])
    expect(plan.conflicts).toEqual([
      { matchId: matches[1].id, reason: 'Target resource changed since search' },
    ])
  })

  it('replaces duplicate structured resources with blank comma segments consistently', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['knowledge-1'].subBlocks.knowledgeBaseIds.value = 'kb-old,,kb-second,kb-old'

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'kb-old',
      mode: 'resource',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    }).filter((match) => match.kind === 'knowledge-base')

    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set([matches[1].id]),
      defaultReplacement: 'kb-new',
      resourceReplacementOptions: [
        { kind: 'knowledge-base', value: 'kb-new', label: 'New Knowledge Base' },
      ],
    })

    expect(plan.conflicts).toEqual([])
    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0].nextValue).toBe('kb-old,,kb-second,kb-new')
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

  it('replaces selector-backed workflow and knowledge document resources with scoped options', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['workflow-tool-1'] = {
      id: 'workflow-tool-1',
      type: 'custom',
      name: 'Workflow Tool',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        workflowId: {
          id: 'workflowId',
          type: 'workflow-selector',
          value: 'workflow-old',
        },
      },
    }
    const blockConfigs = {
      ...SEARCH_REPLACE_BLOCK_CONFIGS,
      custom: {
        subBlocks: [
          {
            id: 'workflowId',
            title: 'Workflow',
            type: 'workflow-selector',
            selectorKey: 'sim.workflows',
          },
        ],
      },
    }

    const workflowMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'workflow-old',
      mode: 'resource',
      workspaceId: 'workspace-1',
      workflowId: 'current-workflow',
      blockConfigs,
    }).filter((match) => match.kind === 'workflow')
    const documentMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'doc-old',
      mode: 'resource',
      workspaceId: 'workspace-1',
      workflowId: 'current-workflow',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    }).filter((match) => match.kind === 'knowledge-document')

    const workflowPlan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches: workflowMatches,
      selectedMatchIds: new Set(workflowMatches.map((match) => match.id)),
      defaultReplacement: 'workflow-new',
      resourceReplacementOptions: [
        {
          kind: 'workflow',
          value: 'workflow-new',
          label: 'New Workflow',
          resourceGroupKey: workflowMatches[0].resource?.resourceGroupKey,
        },
      ],
    })
    const documentPlan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches: documentMatches,
      selectedMatchIds: new Set(documentMatches.map((match) => match.id)),
      defaultReplacement: 'doc-new',
      resourceReplacementOptions: [
        {
          kind: 'knowledge-document',
          value: 'doc-new',
          label: 'New Document',
          resourceGroupKey: documentMatches[0].resource?.resourceGroupKey,
        },
      ],
    })

    expect(workflowPlan.conflicts).toEqual([])
    expect(workflowPlan.updates).toEqual([
      expect.objectContaining({
        blockId: 'workflow-tool-1',
        subBlockId: 'workflowId',
        nextValue: 'workflow-new',
      }),
    ])
    expect(documentPlan.conflicts).toEqual([])
    expect(documentPlan.updates).toEqual([
      expect.objectContaining({
        blockId: 'knowledge-1',
        subBlockId: 'documentId',
        nextValue: 'doc-new',
      }),
    ])
  })

  it('replaces structured file resources stored as serialized tool input params', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['tool-input-1'] = {
      id: 'tool-input-1',
      type: 'custom',
      name: 'Tool Input Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        tools: {
          id: 'tools',
          type: 'tool-input',
          value: [
            {
              type: 'slack',
              toolId: 'slack_message',
              operation: 'send',
              title: 'Slack message',
              params: {
                authMethod: 'oauth',
                credential: 'slack-credential',
                text: 'message with file',
                attachmentFiles: JSON.stringify({
                  name: 'contract.pdf',
                  key: 'file-key-old',
                  path: '/contract.pdf',
                  size: 12,
                  type: 'application/pdf',
                }),
              },
            },
          ],
        },
      },
    }
    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'contract',
      mode: 'all',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
        },
      },
    }).filter((match) => match.kind === 'file')

    const replacementFile = {
      name: 'contract-v2.pdf',
      key: 'file-key-new',
      path: '/contract-v2.pdf',
      size: 24,
      type: 'application/pdf',
    }
    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set(matches.map((match) => match.id)),
      defaultReplacement: JSON.stringify(replacementFile),
      resourceReplacementOptions: [
        { kind: 'file', value: JSON.stringify(replacementFile), label: replacementFile.name },
      ],
    })

    expect(plan.conflicts).toEqual([])
    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0].nextValue).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({
          attachmentFiles: JSON.stringify(replacementFile),
        }),
      }),
    ])
  })

  it('replaces one duplicate file occurrence in a serialized tool input file array', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    const files = [
      {
        name: 'first.pdf',
        key: 'file-key-old',
        path: '/first.pdf',
        size: 12,
        type: 'application/pdf',
      },
      {
        name: 'second.pdf',
        key: 'file-key-other',
        path: '/second.pdf',
        size: 14,
        type: 'application/pdf',
      },
      {
        name: 'third.pdf',
        key: 'file-key-old',
        path: '/third.pdf',
        size: 16,
        type: 'application/pdf',
      },
    ]
    workflow.blocks['tool-input-1'] = {
      id: 'tool-input-1',
      type: 'custom',
      name: 'Tool Input Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        tools: {
          id: 'tools',
          type: 'tool-input',
          value: [
            {
              type: 'slack',
              toolId: 'slack_message',
              operation: 'send',
              title: 'Slack message',
              params: {
                authMethod: 'oauth',
                credential: 'slack-credential',
                text: 'message with files',
                attachmentFiles: JSON.stringify(files),
              },
            },
          ],
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'file-key-old',
      mode: 'resource',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
        },
      },
    }).filter((match) => match.kind === 'file')
    const replacementFile = {
      name: 'replacement.pdf',
      key: 'file-key-new',
      path: '/replacement.pdf',
      size: 24,
      type: 'application/pdf',
    }
    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set([matches[1].id]),
      defaultReplacement: JSON.stringify(replacementFile),
      resourceReplacementOptions: [
        { kind: 'file', value: JSON.stringify(replacementFile), label: replacementFile.name },
      ],
    })
    const nextTools = plan.updates[0].nextValue as Array<{ params: { attachmentFiles: string } }>

    expect(plan.conflicts).toEqual([])
    expect(JSON.parse(nextTools[0].params.attachmentFiles)).toEqual([
      files[0],
      files[1],
      replacementFile,
    ])
  })

  it('conflicts when a selected duplicate file occurrence is removed', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    const files = [
      {
        name: 'first.pdf',
        key: 'file-key-old',
        path: '/first.pdf',
        size: 12,
        type: 'application/pdf',
      },
      {
        name: 'second.pdf',
        key: 'file-key-other',
        path: '/second.pdf',
        size: 14,
        type: 'application/pdf',
      },
      {
        name: 'third.pdf',
        key: 'file-key-old',
        path: '/third.pdf',
        size: 16,
        type: 'application/pdf',
      },
    ]
    workflow.blocks['tool-input-1'] = {
      id: 'tool-input-1',
      type: 'custom',
      name: 'Tool Input Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        tools: {
          id: 'tools',
          type: 'tool-input',
          value: [
            {
              type: 'slack',
              toolId: 'slack_message',
              operation: 'send',
              title: 'Slack message',
              params: {
                authMethod: 'oauth',
                credential: 'slack-credential',
                text: 'message with files',
                attachmentFiles: JSON.stringify(files),
              },
            },
          ],
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'file-key-old',
      mode: 'resource',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
        },
      },
    }).filter((match) => match.kind === 'file')

    workflow.blocks['tool-input-1'].subBlocks.tools.value = [
      {
        type: 'slack',
        toolId: 'slack_message',
        operation: 'send',
        title: 'Slack message',
        params: {
          authMethod: 'oauth',
          credential: 'slack-credential',
          text: 'message with files',
          attachmentFiles: JSON.stringify([files[0], files[1]]),
        },
      },
    ]

    const replacementFile = {
      name: 'replacement.pdf',
      key: 'file-key-new',
      path: '/replacement.pdf',
      size: 24,
      type: 'application/pdf',
    }
    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set([matches[1].id]),
      defaultReplacement: JSON.stringify(replacementFile),
      resourceReplacementOptions: [
        { kind: 'file', value: JSON.stringify(replacementFile), label: replacementFile.name },
      ],
    })

    expect(plan.updates).toEqual([])
    expect(plan.conflicts).toEqual([
      { matchId: matches[1].id, reason: 'Target resource changed since search' },
    ])
  })

  it('conflicts when a selected duplicate file occurrence becomes a single file object', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    const firstFile = {
      name: 'first.pdf',
      key: 'file-key-old',
      path: '/first.pdf',
      size: 12,
      type: 'application/pdf',
    }
    const secondFile = {
      name: 'second.pdf',
      key: 'file-key-old',
      path: '/second.pdf',
      size: 14,
      type: 'application/pdf',
    }
    workflow.blocks['tool-input-1'] = {
      id: 'tool-input-1',
      type: 'custom',
      name: 'Tool Input Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        tools: {
          id: 'tools',
          type: 'tool-input',
          value: [
            {
              type: 'slack',
              toolId: 'slack_message',
              operation: 'send',
              title: 'Slack message',
              params: {
                authMethod: 'oauth',
                credential: 'slack-credential',
                text: 'message with files',
                attachmentFiles: [firstFile, secondFile],
              },
            },
          ],
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'file-key-old',
      mode: 'resource',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
        },
      },
    }).filter((match) => match.kind === 'file')

    workflow.blocks['tool-input-1'].subBlocks.tools.value = [
      {
        type: 'slack',
        toolId: 'slack_message',
        operation: 'send',
        title: 'Slack message',
        params: {
          authMethod: 'oauth',
          credential: 'slack-credential',
          text: 'message with files',
          attachmentFiles: firstFile,
        },
      },
    ]

    const replacementFile = {
      name: 'replacement.pdf',
      key: 'file-key-new',
      path: '/replacement.pdf',
      size: 24,
      type: 'application/pdf',
    }
    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set([matches[1].id]),
      defaultReplacement: JSON.stringify(replacementFile),
      resourceReplacementOptions: [
        { kind: 'file', value: JSON.stringify(replacementFile), label: replacementFile.name },
      ],
    })

    expect(plan.updates).toEqual([])
    expect(plan.conflicts).toEqual([
      { matchId: matches[1].id, reason: 'Target resource changed since search' },
    ])
  })

  it('clears nested tool-input dependents when replacing a parent resource', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['tool-input-1'] = {
      id: 'tool-input-1',
      type: 'custom',
      name: 'Tool Input Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        tools: {
          id: 'tools',
          type: 'tool-input',
          value: [
            {
              type: 'workflow_input',
              toolId: 'workflow_executor',
              title: 'Workflow',
              params: {
                workflowId: 'workflow-old',
                inputMapping: JSON.stringify({ customerEmail: 'old email value' }),
              },
            },
          ],
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'workflow-old',
      mode: 'resource',
      workspaceId: 'workspace-1',
      workflowId: 'current-workflow',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
        },
      },
    }).filter((match) => match.kind === 'workflow')
    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set(matches.map((match) => match.id)),
      defaultReplacement: 'workflow-new',
      resourceReplacementOptions: [
        {
          kind: 'workflow',
          value: 'workflow-new',
          label: 'New Workflow',
          resourceGroupKey: matches[0].resource?.resourceGroupKey,
        },
      ],
    })

    expect(plan.conflicts).toEqual([])
    expect(plan.updates).toEqual([
      expect.objectContaining({
        subBlockId: 'tools',
        nextValue: [
          expect.objectContaining({
            params: expect.objectContaining({
              workflowId: 'workflow-new',
              inputMapping: '',
            }),
          }),
        ],
      }),
    ])
  })

  it('preserves selected nested dependent replacements when replacing a parent resource', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['tool-input-1'] = {
      id: 'tool-input-1',
      type: 'custom',
      name: 'Tool Input Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        tools: {
          id: 'tools',
          type: 'tool-input',
          value: [
            {
              type: 'workflow_input',
              toolId: 'workflow_executor',
              title: 'Workflow',
              params: {
                workflowId: 'workflow-old',
                inputMapping: JSON.stringify({ customerEmail: 'old email value' }),
              },
            },
          ],
        },
      },
    }
    const blockConfigs = {
      ...SEARCH_REPLACE_BLOCK_CONFIGS,
      custom: {
        subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
      },
    }
    const workflowMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'workflow-old',
      mode: 'resource',
      workspaceId: 'workspace-1',
      workflowId: 'current-workflow',
      blockConfigs,
    }).filter((match) => match.kind === 'workflow')
    const mappingMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'old email',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.subBlockType === 'workflow-input-mapper')
    const matches = [...workflowMatches, ...mappingMatches]
    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set(matches.map((match) => match.id)),
      replacementByMatchId: {
        [workflowMatches[0].id]: 'workflow-new',
        [mappingMatches[0].id]: 'new email',
      },
      resourceReplacementOptions: [
        {
          kind: 'workflow',
          value: 'workflow-new',
          label: 'New Workflow',
          resourceGroupKey: workflowMatches[0].resource?.resourceGroupKey,
        },
      ],
    })
    const nextTools = plan.updates[0].nextValue as Array<{
      params: { inputMapping: string; workflowId: string }
    }>

    expect(plan.conflicts).toEqual([])
    expect(nextTools[0].params.workflowId).toBe('workflow-new')
    expect(JSON.parse(nextTools[0].params.inputMapping)).toEqual({
      customerEmail: 'new email value',
    })
  })

  it('replaces serialized workflow-input mapper values without changing keys', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['tool-input-1'] = {
      id: 'tool-input-1',
      type: 'custom',
      name: 'Tool Input Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        tools: {
          id: 'tools',
          type: 'tool-input',
          value: [
            {
              type: 'workflow_input',
              toolId: 'workflow_executor',
              title: 'Workflow',
              params: {
                workflowId: 'workflow-old',
                inputMapping: JSON.stringify({ customerEmail: 'old email value' }),
              },
            },
          ],
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'old email',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
        },
      },
    }).filter((match) => match.subBlockType === 'workflow-input-mapper')
    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set(matches.map((match) => match.id)),
      defaultReplacement: 'new email',
    })
    const nextTools = plan.updates[0].nextValue as Array<{ params: { inputMapping: string } }>

    expect(plan.conflicts).toEqual([])
    expect(JSON.parse(nextTools[0].params.inputMapping)).toEqual({
      customerEmail: 'new email value',
    })
  })

  it('replaces object-valued fallback tool params without changing metadata', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['tool-input-1'] = {
      id: 'tool-input-1',
      type: 'custom',
      name: 'Tool Input Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        tools: {
          id: 'tools',
          type: 'tool-input',
          value: [
            {
              type: 'mcp',
              title: 'MCP tool',
              params: {
                payload: {
                  type: 'metadata-type',
                  filter: { status: 'old customer' },
                },
              },
            },
          ],
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'old',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
        },
      },
    }).filter((match) => match.blockId === 'tool-input-1')
    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set(matches.map((match) => match.id)),
      defaultReplacement: 'new',
    })
    const nextTools = plan.updates[0].nextValue as Array<{
      params: { payload: { type: string; filter: { status: string } } }
    }>

    expect(plan.conflicts).toEqual([])
    expect(nextTools[0].params.payload).toEqual({
      type: 'metadata-type',
      filter: { status: 'new customer' },
    })
  })

  it('replaces serialized JSON fallback tool param values without changing keys', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['tool-input-1'] = {
      id: 'tool-input-1',
      type: 'custom',
      name: 'Tool Input Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        tools: {
          id: 'tools',
          type: 'tool-input',
          value: [
            {
              type: 'mcp',
              title: 'MCP tool',
              params: {
                payload: JSON.stringify({ customer: { name: 'old customer' } }),
              },
            },
          ],
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'old',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
        },
      },
    }).filter((match) => match.blockId === 'tool-input-1')
    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set(matches.map((match) => match.id)),
      defaultReplacement: 'new',
    })
    const nextTools = plan.updates[0].nextValue as Array<{ params: { payload: string } }>

    expect(plan.conflicts).toEqual([])
    expect(JSON.parse(nextTools[0].params.payload)).toEqual({
      customer: { name: 'new customer' },
    })
  })

  it('replaces stringified variables-input values without changing metadata', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['variables-1'] = {
      id: 'variables-1',
      type: 'custom',
      name: 'Variables',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        assignments: {
          id: 'assignments',
          type: 'variables-input',
          value: JSON.stringify([
            {
              id: 'assignment-id',
              variableId: 'variable-id',
              variableName: 'customer',
              type: 'string',
              value: 'old customer',
              isExisting: true,
            },
          ]),
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'old',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'assignments', title: 'Variables', type: 'variables-input' }],
        },
      },
    }).filter((match) => match.blockId === 'variables-1')

    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set(matches.map((match) => match.id)),
      defaultReplacement: 'new',
    })
    const nextAssignments = JSON.parse(plan.updates[0].nextValue as string)

    expect(plan.conflicts).toEqual([])
    expect(nextAssignments).toEqual([
      {
        id: 'assignment-id',
        variableId: 'variable-id',
        variableName: 'customer',
        type: 'string',
        value: 'new customer',
        isExisting: true,
      },
    ])
  })

  it('replaces stringified table cell values without changing row metadata', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['table-1'] = {
      id: 'table-1',
      type: 'custom',
      name: 'Table',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        rows: {
          id: 'rows',
          type: 'table',
          value: JSON.stringify([{ id: 'row-id', cells: { Name: 'old customer' } }]),
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'old',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'rows', title: 'Rows', type: 'table', columns: ['Name'] }],
        },
      },
    }).filter((match) => match.blockId === 'table-1')

    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set(matches.map((match) => match.id)),
      defaultReplacement: 'new',
    })
    const nextRows = JSON.parse(plan.updates[0].nextValue as string)

    expect(plan.conflicts).toEqual([])
    expect(nextRows).toEqual([{ id: 'row-id', cells: { Name: 'new customer' } }])
  })

  it('allows replacing text matches with an empty string', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'email',
      mode: 'text',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    }).filter((match) => match.blockId === 'agent-1')

    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set([matches[0].id]),
      defaultReplacement: '',
    })

    expect(plan.conflicts).toEqual([])
    expect(plan.updates).toEqual([
      expect.objectContaining({
        nextValue: ' {{OLD_SECRET}} and then email again. Use <start.output>.',
      }),
    ])
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

  it('replaces workspace file upload resources with the selected file object', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['file-upload-1'] = {
      id: 'file-upload-1',
      type: 'custom',
      name: 'File Upload Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        file: {
          id: 'file',
          type: 'file-upload',
          value: {
            name: 'old.csv',
            path: '/workspace/ws-1/old-key',
            key: 'old-key',
            size: 42,
            type: 'text/csv',
          },
        },
      },
    }
    const blockConfigs = {
      ...SEARCH_REPLACE_BLOCK_CONFIGS,
      custom: {
        subBlocks: [{ id: 'file', title: 'File', type: 'file-upload' }],
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'old',
      mode: 'resource',
      blockConfigs,
    }).filter((match) => match.blockId === 'file-upload-1')
    const replacementFile = {
      name: 'new.csv',
      path: '/workspace/ws-1/new-key',
      key: 'new-key',
      size: 84,
      type: 'text/csv',
    }

    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set(matches.map((match) => match.id)),
      defaultReplacement: JSON.stringify(replacementFile),
      resourceReplacementOptions: [
        { kind: 'file', value: JSON.stringify(replacementFile), label: 'new.csv' },
      ],
    })

    expect(plan.conflicts).toEqual([])
    expect(plan.updates).toEqual([
      expect.objectContaining({
        subBlockId: 'file',
        nextValue: replacementFile,
      }),
    ])
  })

  it('rejects invalid file upload replacement payloads', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['file-upload-1'] = {
      id: 'file-upload-1',
      type: 'custom',
      name: 'File Upload Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        file: {
          id: 'file',
          type: 'file-upload',
          value: {
            name: 'old.csv',
            path: '/workspace/ws-1/old-key',
            key: 'old-key',
          },
        },
      },
    }
    const blockConfigs = {
      ...SEARCH_REPLACE_BLOCK_CONFIGS,
      custom: {
        subBlocks: [{ id: 'file', title: 'File', type: 'file-upload' }],
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'old',
      mode: 'resource',
      blockConfigs,
    }).filter((match) => match.blockId === 'file-upload-1')

    const plan = buildWorkflowSearchReplacePlan({
      blocks: workflow.blocks,
      matches,
      selectedMatchIds: new Set(matches.map((match) => match.id)),
      defaultReplacement: '"not-a-file-object"',
      resourceReplacementOptions: [
        { kind: 'file', value: '"not-a-file-object"', label: 'Invalid file' },
      ],
    })

    expect(plan.updates).toEqual([])
    expect(plan.conflicts).toEqual([
      {
        matchId: matches[0].id,
        reason: 'Replacement file is no longer valid',
      },
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
