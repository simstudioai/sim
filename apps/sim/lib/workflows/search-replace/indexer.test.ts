import { describe, expect, it, vi } from 'vitest'
import {
  getToolInputParamConfigs,
  indexWorkflowSearchMatches,
} from '@/lib/workflows/search-replace/indexer'
import { workflowSearchMatchMatchesQuery } from '@/lib/workflows/search-replace/resources'
import {
  createSearchReplaceWorkflowFixture,
  SEARCH_REPLACE_BLOCK_CONFIGS,
} from '@/lib/workflows/search-replace/search-replace.fixtures'

/**
 * Asserts real tool params and outputs, which the global `@/tools/metadata`
 * and `@/tools/metadata-outputs` mocks in vitest.setup.ts empty.
 */
vi.unmock('@/tools/metadata')
vi.unmock('@/tools/metadata-outputs')

describe('indexWorkflowSearchMatches', () => {
  it('marks generic tool-param fallbacks as non-authoritative', () => {
    expect(
      getToolInputParamConfigs({
        tool: { type: 'custom-tool', params: { apiKey: 'literal-secret' } },
      })
    ).toEqual([
      expect.objectContaining({
        paramId: 'apiKey',
        authoritative: false,
        value: 'literal-secret',
      }),
    ])
  })

  it.each(['custom-tool', 'mcp'])(
    'keeps %s params non-authoritative when its tool ID collides with a built-in',
    (type) => {
      expect(
        getToolInputParamConfigs({
          tool: { type, toolId: 'gmail_send', params: { body: 'literal-secret' } },
        })
      ).toEqual([
        expect.objectContaining({
          paramId: 'body',
          authoritative: false,
          value: 'literal-secret',
        }),
      ])
    }
  )

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

  it('keeps exact ranges for duplicate matches in the same text field', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['agent-1'].subBlocks.systemPrompt.value = 'alpha beta alpha'

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'alpha',
      mode: 'text',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    }).filter((match) => match.blockId === 'agent-1' && match.subBlockId === 'systemPrompt')

    expect(matches.map((match) => match.range)).toEqual([
      { start: 0, end: 5 },
      { start: 11, end: 16 },
    ])
    expect(matches.map((match) => match.rawValue)).toEqual(['alpha', 'alpha'])
  })

  it('finds matches in block names', () => {
    const workflow = createSearchReplaceWorkflowFixture()

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'agent',
      mode: 'text',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })

    const blockNameMatches = matches.filter((match) => match.target.kind === 'block-name')
    expect(blockNameMatches.map((match) => [match.blockId, match.rawValue])).toEqual([
      ['agent-1', 'Agent'],
      ['locked-1', 'Agent'],
    ])
    expect(blockNameMatches.every((match) => match.editable === false)).toBe(true)
    expect(blockNameMatches.every((match) => match.navigable === true)).toBe(true)
    expect(blockNameMatches[0]?.fieldTitle).toBe('Block name')
  })

  it('matches a block name containing a non-breaking space against a typed space', () => {
    const workflow = {
      blocks: {
        'nbsp-1': {
          id: 'nbsp-1',
          type: 'function',
          name: 'Load\u00a0Prompt',
          position: { x: 0, y: 0 },
          subBlocks: {},
          outputs: {},
          enabled: true,
        },
      },
    } as ReturnType<typeof createSearchReplaceWorkflowFixture>

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'load prompt',
      mode: 'text',
      blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
    })

    const blockNameMatches = matches.filter((match) => match.target.kind === 'block-name')
    // The raw value keeps the original characters so replacements stay exact.
    expect(blockNameMatches.map((match) => match.rawValue)).toEqual(['Load\u00a0Prompt'])
  })

  describe('a markdown field is searched as it renders', () => {
    /*
     * The rich-text editor backslash-escapes every markdown-significant character in prose, so a
     * Note the reader sees as `{{TE_SERET}}` is stored as `{{TE\_SERET}}`. Searching what is on
     * screen has to see through that, and the range has to keep spanning the escaped source so
     * replace rewrites the whole `\_` instead of stranding the backslash.
     */
    const NOTE_CONFIGS = {
      note: { subBlocks: [{ id: 'content', type: 'long-input', searchTextFormat: 'markdown' }] },
      function: { subBlocks: [{ id: 'code', type: 'code' }] },
    } as unknown as typeof SEARCH_REPLACE_BLOCK_CONFIGS

    function workflowWith(noteContent: string, code: string) {
      return {
        blocks: {
          'note-1': {
            id: 'note-1',
            type: 'note',
            name: 'Note',
            position: { x: 0, y: 0 },
            enabled: true,
            horizontalHandles: true,
            subBlocks: { content: { id: 'content', type: 'long-input', value: noteContent } },
            outputs: {},
          },
          'fn-1': {
            id: 'fn-1',
            type: 'function',
            name: 'Fn',
            position: { x: 0, y: 0 },
            enabled: true,
            horizontalHandles: true,
            subBlocks: { code: { id: 'code', type: 'code', value: code } },
            outputs: {},
          },
        },
      } as unknown as Parameters<typeof indexWorkflowSearchMatches>[0]['workflow']
    }

    it('finds an escaped underscore by what the reader sees', () => {
      const matches = indexWorkflowSearchMatches({
        workflow: workflowWith('{{TE\\_SERET}}', ''),
        query: '{{TE_',
        mode: 'text',
        blockConfigs: NOTE_CONFIGS,
      })
      expect(matches.map((match) => match.blockId)).toContain('note-1')
    })

    it('keeps the range over the escape, so replace cannot strand a backslash', () => {
      const content = 'uses SB\\_ACTION here'
      const [match] = indexWorkflowSearchMatches({
        workflow: workflowWith(content, ''),
        query: 'SB_ACTION',
        mode: 'text',
        blockConfigs: NOTE_CONFIGS,
      })
      expect(content.slice(match.range!.start, match.range!.end)).toBe('SB\\_ACTION')
      expect(match.rawValue).toBe('SB\\_ACTION')
    })

    /* A code field stores what the author typed: a backslash there is theirs, not an escape. */
  })

  describe('block references search under the name the canvas shows', () => {
    /**
     * The panel's own pipeline: index everything, then keep what the query
     * matches. Block references resolve no label of their own, so they reach the
     * filter with `displayLabel` fallen back to the raw token, as the hydration
     * hook leaves them.
     */
    function findReferenceMatches(query: string) {
      const workflow = createSearchReplaceWorkflowFixture()
      workflow.blocks['agent-1'].subBlocks.systemPrompt.value =
        'Summarize <api1.output> and <deletedblock.output>, then loop <loop.index>.'

      return indexWorkflowSearchMatches({
        workflow,
        query,
        mode: 'all',
        includeResourceMatchesWithoutQuery: true,
        blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
      })
        .filter((match) => match.kind === 'workflow-reference')
        .filter((match) =>
          workflowSearchMatchMatchesQuery({ ...match, displayLabel: match.rawValue }, query)
        )
    }

    it('matches a reference by the spaced block name', () => {
      expect(findReferenceMatches('API 1').map((match) => match.rawValue)).toEqual([
        '<api1.output>',
      ])
    })

    it('reads the resolved name back as the block is titled', () => {
      const [match] = findReferenceMatches('API 1')

      expect(match.searchText).toBe('API 1.output')
      expect(match.rawValue).toBe('<api1.output>')
      expect(match.range).toEqual({ start: 10, end: 23 })
    })

    /**
     * Legacy workflows can hold two names that collide only now that
     * `normalizeName` strips dots. `BlockResolver` gives the key to the dot-free
     * name whichever order the blocks arrive in, so search has to name the same
     * block or it would label the reference with a title that block does not own
     * at execution time.
     */
    it.each([
      ['dotted first', ['Hunter.io 1', 'Hunterio 1']],
      ['dot-free first', ['Hunterio 1', 'Hunter.io 1']],
    ])('names a legacy dot collision after the dot-free block (%s)', (_order, names) => {
      const workflow = createSearchReplaceWorkflowFixture()
      workflow.blocks['knowledge-1'].name = names[0]
      workflow.blocks['api-1'].name = names[1]
      workflow.blocks['agent-1'].subBlocks.systemPrompt.value = 'Read <hunterio1.email>.'

      const matches = indexWorkflowSearchMatches({
        workflow,
        mode: 'all',
        includeResourceMatchesWithoutQuery: true,
        blockConfigs: SEARCH_REPLACE_BLOCK_CONFIGS,
      })

      expect(
        matches
          .filter((match) => match.kind === 'workflow-reference')
          .map((match) => match.searchText)
      ).toEqual(['Hunterio 1.email'])
    })
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

  it('indexes fixed option display labels as non-editable matches', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['dropdown-1'] = {
      id: 'dropdown-1',
      type: 'custom',
      name: 'Dropdown Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        operation: { id: 'operation', type: 'dropdown', value: 'send_email' },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'Email',
      mode: 'text',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [
            {
              id: 'operation',
              title: 'Operation',
              type: 'dropdown',
              options: [{ id: 'send_email', label: 'Send Email' }],
            },
          ],
        },
      },
    }).filter((match) => match.blockId === 'dropdown-1')

    expect(matches).toEqual([
      expect.objectContaining({
        subBlockId: 'operation',
        valuePath: [],
        searchText: 'send email',
        rawValue: 'email',
        editable: false,
        reason: 'Display labels cannot be replaced',
      }),
    ])
  })

  it('aligns multi-resource matches to visible occurrence paths', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['kb-1'] = {
      id: 'kb-1',
      type: 'custom',
      name: 'Knowledge Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: {
        knowledgeBase: {
          id: 'knowledgeBase',
          type: 'knowledge-base-selector',
          value: 'alpha-resource,beta-resource',
        },
      },
    }

    const matches = indexWorkflowSearchMatches({
      workflow,
      query: 'beta-resource',
      mode: 'resource',
      blockConfigs: {
        ...SEARCH_REPLACE_BLOCK_CONFIGS,
        custom: {
          subBlocks: [
            {
              id: 'knowledgeBase',
              title: 'Knowledge Base',
              type: 'knowledge-base-selector',
              multiSelect: true,
            },
          ],
        },
      },
    }).filter((match) => match.blockId === 'kb-1')

    expect(matches).toEqual([
      expect.objectContaining({
        valuePath: [1],
        structuredOccurrenceIndex: 1,
        rawValue: 'beta-resource',
      }),
    ])
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

    expect(matches.filter((match) => match.blockId === 'dropdown-1')).toEqual([
      expect.objectContaining({
        subBlockId: 'operation',
        valuePath: [],
        searchText: 'send email',
        rawValue: 'send',
        editable: false,
        reason: 'Display labels cannot be replaced',
      }),
    ])
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
    expect(variableNameMatches).toEqual([
      expect.objectContaining({
        subBlockId: 'assignments',
        valuePath: [0, 'variableName'],
        fieldTitle: 'Variable',
        searchText: 'needleVariable',
        editable: false,
      }),
    ])
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
        fallbackModels: {
          id: 'fallbackModels',
          type: 'model-fallback-list',
          value: [{ id: 'row-1', model: 'fallback-visible-model', apiKey: '{{HIDDEN_KEY_REF}}' }],
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
          { id: 'fallbackModels', title: 'Fallback models', type: 'model-fallback-list' },
        ],
      },
    }

    const containsMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'contains visible',
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
    const fallbackMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'fallback-visible',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'structured-1')

    expect(fallbackMatches).toEqual([
      expect.objectContaining({
        subBlockId: 'fallbackModels',
        valuePath: [0, 'model'],
        searchText: 'fallback-visible-model',
      }),
    ])
    /** A row key is a `{{VAR}}` reference; text search must never offer to rewrite it. */
    const keyMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'HIDDEN_KEY_REF',
      mode: 'text',
      blockConfigs,
    }).filter((match) => match.blockId === 'structured-1')
    expect(keyMatches).toEqual([])
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
    expect(excludedMatches).toEqual([
      expect.objectContaining({
        subBlockId: 'skills',
        valuePath: [0, 'name'],
        searchText: 'Skill Hidden Name',
        editable: false,
      }),
    ])
    expect(timeMatches).toEqual([
      expect.objectContaining({
        subBlockId: 'runAt',
        valuePath: [],
        searchText: '12:30 PM',
        editable: false,
        reason: 'Display labels cannot be replaced',
      }),
    ])
    expect(mappingMatches).toEqual([
      expect.objectContaining({
        subBlockId: 'mapping',
        valuePath: ['childInput'],
        searchText: 'mapped visible value',
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

    expect(matches).toEqual([
      expect.objectContaining({
        subBlockId: 'mcpArgs',
        valuePath: ['prompt'],
        searchText: 'customer prompt',
      }),
    ])
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
        native: {
          name: 'Customer Mailer',
          subBlocks: [],
        },
      },
    }).filter((match) => match.blockId === 'tool-input-1')

    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subBlockId: 'tools',
          valuePath: [0, 'title'],
          searchText: 'Customer Mailer',
        }),
        expect.objectContaining({
          subBlockId: 'tools',
          valuePath: [0, 'params', 'body'],
          searchText: 'hello customer',
        }),
      ])
    )
    expect(matches.some((match) => match.searchText === 'Customer notifier')).toBe(false)
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

  it('indexes only the active variable-capable Agent tool mode value', () => {
    const workflow = createSearchReplaceWorkflowFixture()
    workflow.blocks['tool-input-1'] = {
      id: 'tool-input-1',
      type: 'custom',
      name: 'Tool Input Block',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      data: { canonicalModes: { '0:agentToolUsageControl': 'advanced' } },
      subBlocks: {
        tools: {
          id: 'tools',
          type: 'tool-input',
          value: [
            {
              type: 'native',
              usageControl: 'auto',
              usageControlExpression: '<route.toolMode>',
            },
          ],
        },
      },
    }
    const blockConfigs = {
      ...SEARCH_REPLACE_BLOCK_CONFIGS,
      custom: { subBlocks: [{ id: 'tools', title: 'Tools', type: 'tool-input' as const }] },
      native: { name: 'Native', subBlocks: [] },
    }

    const advancedMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'route',
      mode: 'all',
      blockConfigs,
    }).filter((match) => match.blockId === 'tool-input-1')

    expect(advancedMatches.map((match) => match.kind)).toEqual(['text', 'workflow-reference'])
    expect(advancedMatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldTitle: 'Permission Mode',
          valuePath: [0, 'usageControlExpression'],
          searchText: '<route.toolMode>',
        }),
      ])
    )

    workflow.blocks['tool-input-1'].data = {
      canonicalModes: { '0:agentToolUsageControl': 'basic' },
    }
    const basicMatches = indexWorkflowSearchMatches({
      workflow,
      query: 'route',
      mode: 'all',
      blockConfigs,
    }).filter((match) => match.blockId === 'tool-input-1')

    expect(basicMatches).toHaveLength(0)
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
