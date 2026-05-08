/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { indexWorkflowSearchMatches } from '@/lib/workflows/search-replace/indexer'
import { workflowSearchMatchMatchesQuery } from '@/lib/workflows/search-replace/resources'
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

  it('indexes input format fields by visible nested field labels', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['start-1'] = {
      id: 'start-1',
      type: 'start_trigger',
      name: 'Start',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        inputFormat: {
          id: 'inputFormat',
          type: 'input-format',
          value: [
            {
              id: 'internal-field-id',
              name: 'customerInput',
              type: 'string',
              description: 'Incoming payload',
              value: 'sample',
              collapsed: false,
            },
          ],
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'in',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        start_trigger: {
          subBlocks: [{ id: 'inputFormat', title: 'Inputs', type: 'input-format' }],
        },
      },
    }).filter((match) => match.blockId === 'start-1')

    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          valuePath: [0, 'name'],
          fieldTitle: 'Name',
          searchText: 'customerInput',
        }),
        expect.objectContaining({
          valuePath: [0, 'description'],
          fieldTitle: 'Description',
          searchText: 'Incoming payload',
        }),
      ])
    )
    expect(matches.some((match) => match.rawValue === 'internal-field-id')).toBe(false)
    expect(matches.some((match) => match.valuePath.join('.') === '0.type')).toBe(false)
  })

  it('does not index evaluator type metadata', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['evaluator-1'] = {
      id: 'evaluator-1',
      type: 'custom',
      name: 'Evaluator',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        metrics: {
          id: 'metrics',
          type: 'eval-input',
          value: [
            {
              id: 'metric-1',
              name: 'Accuracy',
              type: 'score-kind',
              description: 'Factual correctness',
            },
          ],
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'score-kind',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'metrics', title: 'Metrics', type: 'eval-input' }],
        },
      },
    }).filter((match) => match.blockId === 'evaluator-1')

    expect(matches).toEqual([])
  })

  it('uses the same mode visibility as the editor', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['mode-1'] = {
      id: 'mode-1',
      type: 'custom',
      name: 'Mode Block',
      position: { x: 0, y: 0 },
      enabled: true,
      advancedMode: false,
      triggerMode: false,
      outputs: {},
      subBlocks: {
        basicOnly: { id: 'basicOnly', type: 'short-input', value: 'visible-basic' },
        advancedOnly: { id: 'advancedOnly', type: 'short-input', value: 'hidden-advanced' },
        triggerOnly: { id: 'triggerOnly', type: 'short-input', value: 'hidden-trigger' },
        triggerManual: { id: 'triggerManual', type: 'short-input', value: 'hidden-trigger-manual' },
        triggerConfig: {
          id: 'triggerConfig',
          type: 'trigger-config',
          value: 'visible-trigger-config',
        },
      },
    }
    const blockConfigs = {
      ...SEARCH_REPLACE_BLOCK_CONFIGS,
      custom: {
        subBlocks: [
          { id: 'basicOnly', title: 'Basic', type: 'short-input', mode: 'basic' },
          { id: 'advancedOnly', title: 'Advanced', type: 'short-input', mode: 'advanced' },
          {
            id: 'triggerOnly',
            title: 'Trigger',
            type: 'short-input',
            mode: 'trigger',
            canonicalParamId: 'triggerValue',
          },
          {
            id: 'triggerManual',
            title: 'Trigger Manual',
            type: 'short-input',
            mode: 'trigger-advanced',
            canonicalParamId: 'triggerValue',
          },
          { id: 'triggerConfig', title: 'Trigger Config', type: 'trigger-config' },
        ],
      },
    }

    expect(
      indexWorkflowSearchMatches({
        workflow,
        query: 'hidden',
        mode: 'text',
        blockConfigs,
      }).filter((match) => match.blockId === 'mode-1')
    ).toEqual([])

    workflow.blocks['mode-1'].advancedMode = true
    const advancedMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'advanced',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'mode-1')
    const basicMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'basic',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'mode-1')

    expect(advancedMatches).toHaveLength(1)
    expect(advancedMatches[0].subBlockId).toBe('advancedOnly')
    expect(basicMatches).toEqual([])

    workflow.blocks['mode-1'].triggerMode = true
    const triggerMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'hidden-trigger',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'mode-1')
    const nonTriggerMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'advanced',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'mode-1')

    expect(triggerMatches).toHaveLength(1)
    expect(triggerMatches[0].subBlockId).toBe('triggerOnly')
    expect(nonTriggerMatches).toEqual([])

    const triggerConfigMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'trigger-config',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'mode-1')
    const triggerManualMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'trigger-manual',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'mode-1')

    expect(triggerConfigMatches).toHaveLength(1)
    expect(triggerConfigMatches[0].subBlockId).toBe('triggerConfig')
    expect(triggerManualMatches).toEqual([])
  })

  it('does not index fixed-choice dropdown values as text replacements', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['dropdown-1'] = {
      id: 'dropdown-1',
      type: 'custom',
      name: 'Dropdown Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        operation: {
          id: 'operation',
          type: 'dropdown',
          value: 'send_email',
        },
        flags: {
          id: 'flags',
          type: 'dropdown',
          value: ['read', 'unread'],
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'send',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [
            {
              id: 'operation',
              title: 'Operation',
              type: 'dropdown',
              options: [{ label: 'Send Email', id: 'send_email' }],
            },
            {
              id: 'flags',
              title: 'Flags',
              type: 'dropdown',
              multiSelect: true,
              options: [
                { label: 'Read', id: 'read' },
                { label: 'Unread', id: 'unread' },
              ],
            },
          ],
        },
      },
    })

    expect(matches.filter((match) => match.blockId === 'dropdown-1')).toEqual([])
  })

  it('does not index display-only subblocks that render from config', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['display-1'] = {
      id: 'display-1',
      type: 'custom',
      name: 'Display',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        help: { id: 'help', type: 'text', value: 'stored shadow text' },
        scheduleInfo: { id: 'scheduleInfo', type: 'schedule-info', value: 'stored schedule text' },
        modal: { id: 'modal', type: 'modal', value: 'stored modal text' },
        webhook: { id: 'webhook', type: 'webhook-config', value: 'stored webhook text' },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'stored',
      mode: 'all',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [
            { id: 'help', title: 'Help', type: 'text', defaultValue: 'Rendered help' },
            { id: 'scheduleInfo', title: 'Schedule', type: 'schedule-info' },
            { id: 'modal', title: 'Modal', type: 'modal' },
            { id: 'webhook', title: 'Webhook', type: 'webhook-config' },
          ],
        },
      },
    }).filter((match) => match.blockId === 'display-1')

    expect(matches).toEqual([])
  })

  it('indexes only value fields for JSON-backed knowledge tag subblocks', () => {
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
              valueTo: 'closed ticket',
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

    const valueMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'open',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'tag-block-1')
    const tagNameMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'Status',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'tag-block-1')
    const typeMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'text',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'tag-block-1')

    expect(valueMatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subBlockId: 'tagFilters',
          valuePath: [0, 'tagValue'],
          fieldTitle: 'Value',
          searchText: 'open ticket',
        }),
        expect.objectContaining({
          subBlockId: 'documentTags',
          valuePath: [0, 'value'],
          fieldTitle: 'Value',
          searchText: 'open escalation',
        }),
      ])
    )
    expect(tagNameMatches).toEqual([])
    expect(typeMatches).toEqual([])
  })

  it('indexes only assignment values for stringified variables input', () => {
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
              id: 'assignment-needle-id',
              variableId: 'variable-needle-id',
              variableName: 'needleVariable',
              type: 'string',
              value: 'safe needle value',
              isExisting: true,
            },
          ]),
        },
      },
    }
    const blockConfigs = {
      ...SEARCH_REPLACE_BLOCK_CONFIGS,
      custom: {
        subBlocks: [{ id: 'assignments', title: 'Variables', type: 'variables-input' }],
      },
    }

    const valueMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'needle value',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'variables-1')
    const metadataMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'variable-needle-id',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'variables-1')
    const variableNameMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'needleVariable',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'variables-1')

    expect(valueMatches).toEqual([
      expect.objectContaining({
        subBlockId: 'assignments',
        valuePath: [0, 'value'],
        fieldTitle: 'Value',
        searchText: 'safe needle value',
      }),
    ])
    expect(metadataMatches).toEqual([])
    expect(variableNameMatches).toEqual([])
  })

  it('indexes table cells from stringified table values without exposing row metadata', () => {
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
          value: JSON.stringify([{ id: 'row-needle-id', cells: { Name: 'Acme needle' } }]),
        },
      },
    }
    const blockConfigs = {
      ...SEARCH_REPLACE_BLOCK_CONFIGS,
      custom: {
        subBlocks: [{ id: 'rows', title: 'Rows', type: 'table', columns: ['Name'] }],
      },
    }

    const cellMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'needle',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'table-1')
    const metadataMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'row-needle-id',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'table-1')

    expect(cellMatches).toEqual([
      expect.objectContaining({
        subBlockId: 'rows',
        valuePath: [0, 'cells', 'Name'],
        fieldTitle: 'Name',
        searchText: 'Acme needle',
      }),
    ])
    expect(metadataMatches).toEqual([])
  })

  it('indexes only editable branch values for JSON-backed condition and router subblocks', () => {
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
              id: 'branch-hidden-id',
              title: 'branch hidden title',
              value: 'branch visible value',
              showTags: false,
            },
          ]),
        },
        routes: {
          id: 'routes',
          type: 'router-input',
          value: JSON.stringify([
            {
              id: 'route-hidden-id',
              title: 'route hidden title',
              value: 'route visible value',
              showTags: false,
            },
          ]),
        },
      },
    }
    const blockConfigs = {
      ...SEARCH_REPLACE_BLOCK_CONFIGS,
      custom: {
        subBlocks: [
          { id: 'conditions', title: 'Conditions', type: 'condition-input' },
          { id: 'routes', title: 'Routes', type: 'router-input' },
        ],
      },
    }

    const visibleMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'visible',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'branch-1')
    const hiddenMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'hidden',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'branch-1')

    expect(visibleMatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subBlockId: 'conditions',
          valuePath: [0, 'value'],
          fieldTitle: 'Condition',
        }),
        expect.objectContaining({
          subBlockId: 'routes',
          valuePath: [0, 'value'],
          fieldTitle: 'Route',
        }),
      ])
    )
    expect(hiddenMatches).toEqual([])
  })

  it('does not index non-editable builder enums or message metadata', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['structured-1'] = {
      id: 'structured-1',
      type: 'custom',
      name: 'Structured Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        messages: {
          id: 'messages',
          type: 'messages-input',
          value: [{ role: 'user', content: 'user visible content' }],
        },
        filters: {
          id: 'filters',
          type: 'filter-builder',
          value: [
            {
              id: 'filter-1',
              column: 'status',
              operator: 'contains',
              value: 'contains visible value',
              logicalOperator: 'and',
            },
          ],
        },
        sorts: {
          id: 'sorts',
          type: 'sort-builder',
          value: [{ id: 'sort-1', column: 'status', direction: 'asc' }],
        },
        skills: {
          id: 'skills',
          type: 'skill-input',
          value: [{ skillId: 'skill-hidden-id', name: 'Skill Hidden Name' }],
        },
        runAt: {
          id: 'runAt',
          type: 'time-input',
          value: '12:30',
        },
        mapping: {
          id: 'mapping',
          type: 'input-mapping',
          value: { childInput: 'mapped visible value' },
        },
      },
    }
    const blockConfigs = {
      ...SEARCH_REPLACE_BLOCK_CONFIGS,
      custom: {
        subBlocks: [
          { id: 'messages', title: 'Messages', type: 'messages-input' },
          { id: 'filters', title: 'Filters', type: 'filter-builder' },
          { id: 'sorts', title: 'Sorts', type: 'sort-builder' },
          { id: 'skills', title: 'Skills', type: 'skill-input' },
          { id: 'runAt', title: 'Run At', type: 'time-input' },
          { id: 'mapping', title: 'Input Mapping', type: 'input-mapping' },
        ],
      },
    }

    const containsMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'contains',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'structured-1')
    const userMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'user',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'structured-1')
    const excludedMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'hidden',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'structured-1')
    const timeMatches = indexWorkflowSearchMatches({
      workflow,
      query: '12',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'structured-1')
    const mappingMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'mapped',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'structured-1')

    expect(containsMatches).toEqual([
      expect.objectContaining({
        subBlockId: 'filters',
        valuePath: [0, 'value'],
        searchText: 'contains visible value',
      }),
    ])
    expect(userMatches).toEqual([
      expect.objectContaining({
        subBlockId: 'messages',
        valuePath: [0, 'content'],
        searchText: 'user visible content',
      }),
    ])
    expect(excludedMatches).toEqual([])
    expect(timeMatches).toEqual([])
    expect(mappingMatches).toEqual([
      expect.objectContaining({
        subBlockId: 'mapping',
        valuePath: ['childInput'],
        searchText: 'mapped visible value',
      }),
    ])
  })

  it('does not index skill-shaped values even when persisted under a legacy id', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['legacy-agent-1'] = {
      id: 'legacy-agent-1',
      type: 'custom',
      name: 'Legacy Agent',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        legacySkills: {
          id: 'legacySkills',
          type: 'short-input',
          value: [{ skillId: 'skill-vik-id', name: 'vik-skill' }],
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'vik',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: { subBlocks: [] },
      },
    }).filter((match) => match.blockId === 'legacy-agent-1')

    expect(matches).toEqual([])
  })

  it('indexes only editable variable assignment values as text', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['variables-1'] = {
      id: 'variables-1',
      type: 'variables',
      name: 'Variables',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        variables: {
          id: 'variables',
          type: 'variables-input',
          value: [
            {
              id: 'assignment-needle-id',
              variableId: 'variable-needle-id',
              variableName: 'needleVariable',
              type: 'string',
              value: 'needle assignment value',
              isExisting: true,
            },
          ],
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'needle',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        variables: {
          subBlocks: [{ id: 'variables', title: 'Variable Assignments', type: 'variables-input' }],
        },
      },
    }).filter((match) => match.blockId === 'variables-1')

    expect(matches).toEqual([
      expect.objectContaining({
        subBlockId: 'variables',
        valuePath: [0, 'value'],
        searchText: 'needle assignment value',
        editable: true,
      }),
    ])
  })

  it('does not index upload or dynamic control internals as text', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['dynamic-1'] = {
      id: 'dynamic-1',
      type: 'custom',
      name: 'Dynamic Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        upload: {
          id: 'upload',
          type: 'file-upload',
          value: {
            name: 'customer.csv',
            path: '/workspace/customer.csv',
            key: 'storage-customer-key',
          },
        },
        mcpArgs: {
          id: 'mcpArgs',
          type: 'mcp-dynamic-args',
          value: { prompt: 'customer prompt' },
        },
        slider: {
          id: 'slider',
          type: 'slider',
          value: 42,
        },
        enabled: {
          id: 'enabled',
          type: 'switch',
          value: true,
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'customer',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [
            { id: 'upload', title: 'Upload', type: 'file-upload' },
            { id: 'mcpArgs', title: 'MCP Args', type: 'mcp-dynamic-args' },
            { id: 'slider', title: 'Slider', type: 'slider' },
            { id: 'enabled', title: 'Enabled', type: 'switch' },
          ],
        },
      },
    }).filter((match) => match.blockId === 'dynamic-1')

    expect(matches).toEqual([])
  })

  it('indexes only safe user-facing paths inside tool input values', () => {
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
              type: 'native',
              toolId: 'gmail_customer_tool',
              operation: 'send_customer_message',
              title: 'Customer notifier',
              params: {
                body: 'hello customer',
                credentialId: 'credential-customer-id',
                inputMapping: JSON.stringify({ query: 'customer json value' }),
              },
              schema: {
                description: 'customer schema text',
              },
            },
          ],
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'customer',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
        },
      },
    }).filter((match) => match.blockId === 'tool-input-1')

    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subBlockId: 'tools',
          valuePath: [0, 'title'],
          searchText: 'Customer notifier',
        }),
        expect.objectContaining({
          subBlockId: 'tools',
          valuePath: [0, 'params', 'body'],
          searchText: 'hello customer',
        }),
      ])
    )
    expect(matches.some((match) => match.valuePath.includes('toolId'))).toBe(false)
    expect(matches.some((match) => match.valuePath.includes('operation'))).toBe(false)
    expect(matches.some((match) => match.valuePath.includes('credentialId'))).toBe(false)
    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          valuePath: [0, 'params', 'inputMapping', 'query'],
          searchText: 'customer json value',
        }),
      ])
    )
    expect(matches.some((match) => match.valuePath.includes('schema'))).toBe(false)
  })

  it('indexes explicit secret tool params for intentional replacement', () => {
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
                botToken: 'xoxb-hidden-token',
                text: 'visible slack body',
              },
            },
          ],
        },
      },
    }

    const hiddenMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'xoxb-hidden-token',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
        },
      },
    }).filter((match) => match.blockId === 'tool-input-1')
    const visibleMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'visible slack',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
        },
      },
    }).filter((match) => match.blockId === 'tool-input-1')

    expect(hiddenMatches).toEqual([
      expect.objectContaining({
        subBlockId: 'tools',
        valuePath: [0, 'params', 'botToken'],
        searchText: 'xoxb-hidden-token',
      }),
    ])
    expect(visibleMatches).toEqual([
      expect.objectContaining({
        subBlockId: 'tools',
        valuePath: [0, 'params', 'text'],
        searchText: 'visible slack body',
      }),
    ])
  })

  it('indexes structured resources inside tool input params using nested subblock config', () => {
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
    }).filter((match) => match.blockId === 'tool-input-1')

    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'file',
          subBlockId: 'tools',
          subBlockType: 'file-upload',
          rawValue: 'file-key-old',
          searchText: 'contract.pdf',
          valuePath: [0, 'params', 'attachmentFiles'],
        }),
      ])
    )
  })

  it('does not double index synthetic tool-input mirror subblocks', () => {
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
              type: 'api',
              toolId: 'http_request',
              title: 'API',
              params: {
                url: 'Lmfap',
              },
            },
          ],
        },
        'tools-tool-0-url': {
          id: 'tools-tool-0-url',
          type: 'short-input',
          value: 'Lmfap',
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'lmf',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
        },
      },
    }).filter((match) => match.blockId === 'tool-input-1')

    expect(matches).toEqual([
      expect.objectContaining({
        subBlockId: 'tools',
        valuePath: [0, 'params', 'url'],
        searchText: 'Lmfap',
      }),
    ])
  })

  it('attaches selector context to selector-backed tool input params', () => {
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
                channel: 'COLD',
                text: 'message',
              },
            },
          ],
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'COLD',
      mode: 'resource',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
        },
      },
    }).filter((match) => match.kind === 'selector-resource')

    expect(matches).toEqual([
      expect.objectContaining({
        rawValue: 'COLD',
        resource: expect.objectContaining({
          selectorKey: 'slack.channels',
          selectorContext: expect.objectContaining({
            oauthCredential: 'slack-credential',
            workspaceId: 'workspace-1',
            workflowId: 'workflow-1',
            excludeWorkflowId: 'workflow-1',
          }),
        }),
      }),
    ])
  })

  it('indexes workflow-input tool mappings by values without exposing JSON keys', () => {
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

    const keyMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'customerEmail',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
        },
      },
    }).filter((match) => match.blockId === 'tool-input-1')
    const valueMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'old email',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
        },
      },
    }).filter((match) => match.blockId === 'tool-input-1')

    expect(keyMatches).toEqual([])
    expect(valueMatches).toEqual([
      expect.objectContaining({
        subBlockId: 'tools',
        subBlockType: 'workflow-input-mapper',
        valuePath: [0, 'params', 'inputMapping', 'customerEmail'],
        searchText: 'old email value',
      }),
    ])
  })

  it('indexes object-backed workflow-input tool mappings by values', () => {
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
                inputMapping: { customerEmail: 'object email value' },
              },
            },
          ],
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'object email',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
        },
      },
    }).filter((match) => match.blockId === 'tool-input-1')

    expect(matches).toEqual([
      expect.objectContaining({
        subBlockId: 'tools',
        subBlockType: 'workflow-input-mapper',
        valuePath: [0, 'params', 'inputMapping', 'customerEmail'],
        searchText: 'object email value',
      }),
    ])
  })

  it('indexes object-valued fallback tool params by leaf values', () => {
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
                  filter: { status: 'open customer' },
                },
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
    const valueMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'open customer',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'tool-input-1')
    const typeMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'metadata-type',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'tool-input-1')

    expect(valueMatches).toEqual([
      expect.objectContaining({
        subBlockId: 'tools',
        subBlockType: 'workflow-input-mapper',
        valuePath: [0, 'params', 'payload', 'filter', 'status'],
        searchText: 'open customer',
      }),
    ])
    expect(typeMatches).toEqual([
      expect.objectContaining({
        subBlockId: 'tools',
        subBlockType: 'workflow-input-mapper',
        valuePath: [0, 'params', 'payload', 'type'],
        searchText: 'metadata-type',
      }),
    ])
  })

  it('indexes visible tool params ending in key', () => {
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
              type: 'custom-tool',
              title: 'Custom issue tool',
              params: {
                issueKey: 'PROJ-123',
              },
            },
          ],
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'PROJ',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
        },
      },
    }).filter((match) => match.blockId === 'tool-input-1')

    expect(matches).toEqual([
      expect.objectContaining({
        subBlockId: 'tools',
        valuePath: [0, 'params', 'issueKey'],
        searchText: 'PROJ-123',
      }),
    ])
  })

  it('indexes nested JSON object fallback tool params by values without exposing keys', () => {
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
              toolId: 'server-tool',
              title: 'MCP tool',
              params: {
                payload: JSON.stringify({ customer: { name: 'Acme Corp' } }),
              },
            },
          ],
        },
      },
    }

    const valueMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'Acme',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
        },
      },
    }).filter((match) => match.blockId === 'tool-input-1')
    const keyMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'customer',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
        },
      },
    }).filter((match) => match.blockId === 'tool-input-1')

    expect(valueMatches).toEqual([
      expect.objectContaining({
        subBlockId: 'tools',
        subBlockType: 'workflow-input-mapper',
        valuePath: [0, 'params', 'payload', 'customer', 'name'],
        searchText: 'Acme Corp',
      }),
    ])
    expect(keyMatches).toEqual([])
  })

  it('scopes MCP tool resources to the selected server', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['mcp-1'] = {
      id: 'mcp-1',
      type: 'mcp',
      name: 'MCP',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        server: {
          id: 'server',
          type: 'mcp-server-selector',
          value: 'server-a',
        },
        tool: {
          id: 'tool',
          type: 'mcp-tool-selector',
          value: 'server-a-search',
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'search',
      mode: 'resource',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        mcp: {
          subBlocks: [
            { id: 'server', title: 'Server', type: 'mcp-server-selector' },
            { id: 'tool', title: 'Tool', type: 'mcp-tool-selector', dependsOn: ['server'] },
          ],
        },
      },
    }).filter((match) => match.kind === 'mcp-tool')

    expect(matches).toEqual([
      expect.objectContaining({
        rawValue: 'server-a-search',
        resource: expect.objectContaining({
          selectorContext: expect.objectContaining({ mcpServerId: 'server-a' }),
        }),
      }),
    ])
  })

  it('does not index condition-hidden subblocks', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['condition-1'] = {
      id: 'condition-1',
      type: 'custom',
      name: 'Conditional Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        operation: {
          id: 'operation',
          type: 'dropdown',
          value: 'send',
        },
        hiddenBody: {
          id: 'hiddenBody',
          type: 'long-input',
          value: 'invisible content',
        },
        visibleBody: {
          id: 'visibleBody',
          type: 'long-input',
          value: 'visible content',
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'content',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [
            { id: 'operation', title: 'Operation', type: 'dropdown' },
            {
              id: 'hiddenBody',
              title: 'Hidden Body',
              type: 'long-input',
              condition: { field: 'operation', value: 'receive' },
            },
            {
              id: 'visibleBody',
              title: 'Visible Body',
              type: 'long-input',
              condition: { field: 'operation', value: 'send' },
            },
          ],
        },
      },
    }).filter((match) => match.blockId === 'condition-1')

    expect(matches).toEqual([
      expect.objectContaining({
        subBlockId: 'visibleBody',
        fieldTitle: 'Visible Body',
      }),
    ])
  })

  it('does not index hidden generated subblocks', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['evaluator-1'] = {
      id: 'evaluator-1',
      type: 'evaluator',
      name: 'Evaluator',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        systemPrompt: {
          id: 'systemPrompt',
          type: 'code',
          value: 'Generated content should not be searchable',
        },
        content: {
          id: 'content',
          type: 'long-input',
          value: 'Visible content should be searchable',
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'content',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        evaluator: {
          subBlocks: [
            { id: 'systemPrompt', title: 'System Prompt', type: 'code', hidden: true },
            { id: 'content', title: 'Content', type: 'long-input' },
          ],
        },
      },
    })

    expect(matches).toEqual([
      expect.objectContaining({
        blockId: 'evaluator-1',
        subBlockId: 'content',
        fieldTitle: 'Content',
      }),
    ])
  })

  it('indexes only the active member of a canonical basic/advanced pair', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['canonical-1'] = {
      id: 'canonical-1',
      type: 'custom',
      name: 'Canonical Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      data: {
        canonicalModes: { file: 'advanced' },
      },
      subBlocks: {
        fileSelector: {
          id: 'fileSelector',
          type: 'file-selector',
          value: 'basic-file-id',
        },
        fileReference: {
          id: 'fileReference',
          type: 'short-input',
          value: 'advanced-file-reference',
        },
      },
    }
    const blockConfigs = {
      ...SEARCH_REPLACE_BLOCK_CONFIGS,
      custom: {
        subBlocks: [
          {
            id: 'fileSelector',
            title: 'File',
            type: 'file-selector',
            canonicalParamId: 'file',
            mode: 'basic',
          },
          {
            id: 'fileReference',
            title: 'File',
            type: 'short-input',
            canonicalParamId: 'file',
            mode: 'advanced',
          },
        ],
      },
    }

    const basicMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'basic-file-id',
      mode: 'all',
      blockConfigs,
    }).filter((match) => match.blockId === 'canonical-1')
    const advancedMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'advanced-file',
      mode: 'all',
      blockConfigs,
    }).filter((match) => match.blockId === 'canonical-1')

    expect(basicMatches).toEqual([])
    expect(advancedMatches).toEqual([
      expect.objectContaining({
        subBlockId: 'fileReference',
        canonicalSubBlockId: 'file',
        kind: 'text',
      }),
    ])
  })

  it('indexes reactive credential-type fields only when their credential type matches', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['reactive-1'] = {
      id: 'reactive-1',
      type: 'custom',
      name: 'Reactive Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        credential: {
          id: 'credential',
          type: 'oauth-input',
          value: 'credential-1',
        },
        impersonateUserEmail: {
          id: 'impersonateUserEmail',
          type: 'short-input',
          value: 'service-account-user@example.com',
        },
      },
    }
    const blockConfigs = {
      ...SEARCH_REPLACE_BLOCK_CONFIGS,
      custom: {
        subBlocks: [
          {
            id: 'credential',
            title: 'Google Account',
            type: 'oauth-input',
            canonicalParamId: 'oauthCredential',
          },
          {
            id: 'impersonateUserEmail',
            title: 'Impersonated Account',
            type: 'short-input',
            reactiveCondition: {
              watchFields: ['oauthCredential'],
              requiredType: 'service_account',
            },
          },
        ],
      },
    }

    const hiddenMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'service-account-user',
      mode: 'text',
      blockConfigs,
      credentialTypeById: { 'credential-1': 'oauth' },
    }).filter((match) => match.blockId === 'reactive-1')
    const visibleMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'service-account-user',
      mode: 'text',
      blockConfigs,
      credentialTypeById: { 'credential-1': 'service_account' },
    }).filter((match) => match.blockId === 'reactive-1')

    expect(hiddenMatches).toEqual([])
    expect(visibleMatches).toEqual([
      expect.objectContaining({
        subBlockId: 'impersonateUserEmail',
        fieldTitle: 'Impersonated Account',
      }),
    ])
  })

  it('indexes editable combobox text and still finds inline references', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['combobox-1'] = {
      id: 'combobox-1',
      type: 'custom',
      name: 'Combobox Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        model: {
          id: 'model',
          type: 'combobox',
          value: 'claude-sonnet-4-6',
        },
        dynamicModel: {
          id: 'dynamicModel',
          type: 'combobox',
          value: '<start.model>',
        },
      },
    }
    const blockConfigs = {
      ...SEARCH_REPLACE_BLOCK_CONFIGS,
      custom: {
        subBlocks: [
          {
            id: 'model',
            title: 'Model',
            type: 'combobox',
            options: [{ label: 'Claude Sonnet', id: 'claude-sonnet-4-6' }],
          },
          {
            id: 'dynamicModel',
            title: 'Dynamic Model',
            type: 'combobox',
            options: [{ label: 'Claude Sonnet', id: 'claude-sonnet-4-6' }],
          },
        ],
      },
    }

    const textMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'claude',
      mode: 'text',
      blockConfigs,
    })
    const referenceMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'start.model',
      mode: 'resource',
      blockConfigs,
    })

    expect(textMatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blockId: 'combobox-1',
          subBlockId: 'model',
          kind: 'text',
          rawValue: 'claude',
          editable: true,
        }),
      ])
    )
    expect(referenceMatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blockId: 'combobox-1',
          subBlockId: 'dynamicModel',
          kind: 'workflow-reference',
          rawValue: '<start.model>',
        }),
      ])
    )
  })

  it('indexes evaluator metrics by visible nested field labels', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['evaluator-1'] = {
      id: 'evaluator-1',
      type: 'evaluator',
      name: 'Evaluator',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        metrics: {
          id: 'metrics',
          type: 'eval-input',
          value: [
            {
              id: 'metric-internal-id',
              name: 'Accuracy',
              description: 'Score factual correctness',
              range: { min: 0, max: 10 },
            },
          ],
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: '10',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        evaluator: {
          subBlocks: [{ id: 'metrics', title: 'Evaluation Metrics', type: 'eval-input' }],
        },
      },
    }).filter((match) => match.blockId === 'evaluator-1')

    expect(matches).toEqual([
      expect.objectContaining({
        valuePath: [0, 'range', 'max'],
        fieldTitle: 'Max Value',
        searchText: '10',
        editable: false,
        reason: 'Only text values can be replaced',
      }),
    ])

    const idMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'metric-internal-id',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        evaluator: {
          subBlocks: [{ id: 'metrics', title: 'Evaluation Metrics', type: 'eval-input' }],
        },
      },
    })

    expect(idMatches).toEqual([])
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

  it('keeps selector-like legacy state out of plain text matches when config is missing', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['legacy-resource-1'] = {
      id: 'legacy-resource-1',
      type: 'unknown_block',
      name: 'Legacy Resource',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        knowledgeBaseIds: {
          id: 'knowledgeBaseIds',
          type: 'knowledge-base-selector',
          value: 'kb-legacy',
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'kb',
      mode: 'all',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    }).filter((match) => match.blockId === 'legacy-resource-1')

    expect(matches.some((match) => match.kind === 'text')).toBe(false)
    expect(matches).toEqual([
      expect.objectContaining({
        kind: 'knowledge-base',
        rawValue: 'kb-legacy',
      }),
    ])
  })

  it('indexes workspace file uploads as resource matches by visible file name', () => {
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
            name: 'violet_polaris.csv',
            path: '/workspace/ws-1/violet-key',
            key: 'violet-key',
            size: 42,
            type: 'text/csv',
          },
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'violet',
      mode: 'all',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [{ id: 'file', title: 'File', type: 'file-upload' }],
        },
      },
    }).filter((match) => match.blockId === 'file-upload-1')

    expect(matches.some((match) => match.kind === 'text')).toBe(false)
    expect(matches).toEqual([
      expect.objectContaining({
        kind: 'file',
        rawValue: 'violet-key',
        searchText: 'violet_polaris.csv',
      }),
    ])
  })

  it('attaches selector context for workflow selectors', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['workflow-1'] = {
      id: 'workflow-1',
      type: 'workflow',
      name: 'Workflow Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        workflowId: {
          id: 'workflowId',
          type: 'workflow-selector',
          value: 'child-workflow-1',
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'child',
      mode: 'resource',
      workspaceId: 'workspace-1',
      workflowId: 'current-workflow-1',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        workflow: {
          subBlocks: [
            {
              id: 'workflowId',
              title: 'Select Workflow',
              type: 'workflow-selector',
              selectorKey: 'sim.workflows',
            },
          ],
        },
      },
    }).filter((match) => match.blockId === 'workflow-1')

    expect(matches).toEqual([
      expect.objectContaining({
        kind: 'workflow',
        rawValue: 'child-workflow-1',
        resource: expect.objectContaining({
          selectorKey: 'sim.workflows',
          selectorContext: expect.objectContaining({
            workspaceId: 'workspace-1',
            workflowId: 'current-workflow-1',
            excludeWorkflowId: 'current-workflow-1',
          }),
        }),
      }),
    ])
  })

  it('builds selector context from declared dependencies instead of sibling selectors', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['spreadsheet-1'] = {
      id: 'spreadsheet-1',
      type: 'custom',
      name: 'Spreadsheet Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        spreadsheetSelector: {
          id: 'spreadsheetSelector',
          type: 'file-selector',
          value: 'spreadsheet-1',
        },
        sheetSelector: {
          id: 'sheetSelector',
          type: 'sheet-selector',
          value: 'sheet-1',
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      mode: 'resource',
      includeResourceMatchesWithoutQuery: true,
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [
            {
              id: 'spreadsheetSelector',
              title: 'Spreadsheet',
              type: 'file-selector',
              canonicalParamId: 'spreadsheetId',
              selectorKey: 'google.drive',
            },
            {
              id: 'sheetSelector',
              title: 'Sheet',
              type: 'sheet-selector',
              selectorKey: 'google.sheets',
              dependsOn: ['spreadsheetSelector'],
            },
          ],
        },
      },
    }).filter((match) => match.blockId === 'spreadsheet-1')

    const spreadsheetMatch = matches.find((match) => match.subBlockId === 'spreadsheetSelector')
    const sheetMatch = matches.find((match) => match.subBlockId === 'sheetSelector')

    expect(spreadsheetMatch?.resource?.selectorContext).not.toHaveProperty('spreadsheetId')
    expect(sheetMatch?.resource?.selectorContext).toEqual(
      expect.objectContaining({
        spreadsheetId: 'spreadsheet-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      })
    )
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
