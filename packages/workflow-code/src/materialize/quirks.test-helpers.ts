/**
 * One stored workflow per storage quirk, each a shape real stored
 * graphs hold. The O1/O3 tests run every one of them through canonicalize and materialize.
 */

import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { blockState, edge, workflowState } from './fixtures.test-helpers'

const START = blockState('start', 'start_trigger', 'Start', {
  inputFormat: [{ id: 'f-q', name: 'question', type: 'string', value: '', collapsed: true }],
})

export const QUIRK_STATES: Array<[string, WorkflowState]> = [
  [
    'stale hidden values and a standalone advanced field with advanced off',
    workflowState([
      blockState('s1', 'slack', 'Slack', {
        operation: 'read',
        text: 'stale text the operation no longer shows',
        threadTs: '1700000000.0001',
      }),
    ]),
  ],
  [
    'explicit, inferred and legacy advancedMode pair modes',
    workflowState([
      blockState(
        's1',
        'slack',
        'Explicit',
        { operation: 'send', credential: 'cred-1', manualChannel: 'C9' },
        { data: { canonicalModes: { oauthCredential: 'basic', channel: 'advanced' } } }
      ),
      blockState('s2', 'slack', 'Inferred', { operation: 'send', manualChannel: 'C9' }),
      blockState(
        's3',
        'slack',
        'Legacy',
        { operation: 'send', channel: 'C1' },
        { advancedMode: true }
      ),
    ]),
  ],
  [
    'tool lists with index and legacy modes, stored as text, isExpanded, custom tools',
    workflowState([
      blockState(
        'a1',
        'agent',
        'Agent',
        {
          model: 'gpt-4o',
          tools: JSON.stringify([
            {
              type: 'slack',
              operation: 'send',
              toolId: 'slack_message',
              title: 'Slack',
              params: { channel: 'C1', notify: 'true', limit: '5', manualChannel: '' },
              isExpanded: true,
              usageControl: 'auto',
            },
            {
              type: 'slack',
              operation: 'send',
              params: { manualChannel: 'C2' },
              isExpanded: false,
            },
            {
              type: 'custom-tool',
              customToolId: 'ct-1',
              schema: { type: 'function', function: { name: 'lookup' } },
              code: 'return 1',
              usageControl: 'force',
              extraFlag: 1,
            },
          ]),
        },
        {
          data: {
            canonicalModes: { '0:channel': 'basic', 'slack:channel': 'advanced' },
          },
        }
      ),
    ]),
  ],
  [
    'condition titles, every row id format, UI junk and whitespace in the JSON',
    workflowState(
      [
        blockState('c1', 'condition', 'Gate', {
          conditions: `[ {"id":"c1-if","title":"if","value":"<start.input> > 1","showTags":false,"searchTerm":"x"},
          {"id":"c1-else-if-1700000000","title":"Otherwise if","value":"true","cursorPosition":3},
          {"id":"0f3a7c58-3b9e-4b8e-9c2a-9b2b4b8f2a11","value":"false"},
          {"title":"else","value":""} ]`,
        }),
        blockState('r1', 'router_v2', 'Router', {
          context: 'route it',
          routes: JSON.stringify([
            { id: 'r1-route1', title: 'Route 1', value: 'sales' },
            { id: 'r1-route2', title: 'Support', value: 'support', key: 'support' },
          ]),
        }),
        blockState('f1', 'function', 'Sales', { code: 'return 1' }),
        blockState('f2', 'function', 'Support', { code: 'return 2' }),
      ],
      {
        edges: [
          edge('e1', 'c1', 'f1', 'condition-c1-if'),
          edge('e2', 'c1', 'f2', 'condition-c1-else-if-1700000000'),
          edge('e3', 'r1', 'f1', 'router-r1-route1'),
          edge('e4', 'r1', 'f2', 'router-r1-route2'),
        ],
      }
    ),
  ],
  [
    'never-persisted conditions with an edge on the implicit if handle',
    workflowState(
      [blockState('c1', 'condition', 'Gate'), blockState('f1', 'function', 'Next', { code: '' })],
      { edges: [edge('e1', 'c1', 'f1', 'condition-c1-if')] }
    ),
  ],
  [
    'JSON text with whitespace in structured fields and resource ids, code left as text',
    workflowState([
      blockState('k1', 'knowledge', 'KB', {
        knowledgeBaseIds: 'kb-1, missing-kb',
        tagFilters: ' [ {"tagName":"team","tagValue":"core"} ] ',
      }),
      blockState('a1', 'agent', 'Writer', { responseFormat: '{ "type": "object" }' }),
    ]),
  ],
  [
    'trigger runtime ids, triggerConfig, and stored outputs',
    workflowState([
      blockState(
        't1',
        'slack',
        'Slack Trigger',
        {
          botToken: '{{SLACK_BOT}}',
          webhookId: 'wh-1',
          triggerPath: 't1',
          triggerConfig: { botToken: '{{SLACK_BOT}}' },
          triggerId: 'slack_webhook',
        },
        { triggerMode: true, outputs: { event: { type: 'json' } } }
      ),
    ]),
  ],
  [
    'loop and parallel configs duplicated in data and the maps, count 0, nesting',
    workflowState(
      [
        blockState(
          'l1',
          'loop',
          'Outer',
          {},
          {
            data: {
              loopType: 'forEach',
              collection: '<start.items>',
              count: 0,
              width: 500,
              height: 300,
            },
          }
        ),
        blockState(
          'p1',
          'parallel',
          'Fan',
          {},
          {
            data: { parentId: 'l1', extent: 'parent', count: 3, batchSize: 40 },
          }
        ),
        blockState(
          'f1',
          'function',
          'Work',
          { code: 'return <loop.currentItem>' },
          {
            data: { parentId: 'p1', extent: 'parent' },
          }
        ),
      ],
      {
        loops: {
          l1: {
            id: 'l1',
            nodes: ['p1'],
            iterations: 0,
            loopType: 'forEach',
            forEachItems: '<start.items>',
            whileCondition: '',
            enabled: true,
          },
        },
        parallels: {
          p1: { id: 'p1', nodes: ['f1'], count: 3, batchSize: 40, enabled: true },
        },
        edges: [
          edge('e1', 'p1', 'f1', 'parallel-start-source'),
          edge('e2', 'l1', 'p1', 'loop-start-source'),
        ],
      }
    ),
  ],
  [
    'side-anchored and empty handles, an error edge with errorEnabled off, duplicates, dangling',
    workflowState(
      [
        START,
        blockState('f1', 'function', 'Fetch', { code: 'x' }),
        blockState('f2', 'function', 'Handle', { code: 'y' }),
      ],
      {
        edges: [
          edge('e1', 'start', 'f1', 'source-right', { data: { animated: true } }),
          edge('e2', 'start', 'f1', ''),
          edge('e3', 'f1', 'f2', 'error'),
          edge('e4', 'f2', 'gone', 'source'),
          edge('e5', 'f1', 'f2', 'mystery-handle'),
        ],
      }
    ),
  ],
  [
    'legacy normalized-name collisions and dotted names',
    workflowState([
      blockState('b1', 'function', 'Agent.1', { code: '<agent1.result>' }),
      blockState('b2', 'function', 'Agent 1', { code: 'a' }),
      blockState('b3', 'function', 'agent1', { code: 'b' }),
    ]),
  ],
  [
    'a locked block, raw retry kept while disabled, enabled off',
    workflowState([
      blockState(
        'f1',
        'function',
        'Locked',
        { code: 'x' },
        {
          locked: true,
          enabled: false,
          retry: { enabled: false, maxTries: 4, waitBetweenTriesMs: 1500 },
          errorEnabled: true,
        }
      ),
    ]),
  ],
  [
    'synthetic tool mirrors, parked keys, type drift and a map key that differs from id',
    workflowState([
      blockState(
        'a1',
        'agent',
        'Agent',
        {
          model: 'gpt-4o',
          'tools-tool-0-channel': 'C1',
          _removed_systemPrompt: 'old',
        },
        {}
      ),
      {
        ...blockState('f1', 'function', 'Code'),
        subBlocks: {
          code: { id: 'code', type: 'short-input', value: 'return 1' },
          language: { id: 'lang', type: 'dropdown', value: 'javascript' },
        },
      },
    ]),
  ],
  [
    'table row ids and a blank starter row, inputFormat duplicate and empty names',
    workflowState([
      blockState('h1', 'api', 'Call', {
        url: 'https://example.com',
        headers: [
          { id: 'row-1', cells: { Key: 'Accept', Value: 'json' } },
          { id: 'row-2', cells: { Key: '', Value: '' } },
        ],
      }),
      blockState('s1', 'start_trigger', 'Start', {
        inputFormat: [
          { id: 'f-a', name: 'a', type: 'string', collapsed: false },
          { id: 'f-dup1', name: 'dup', type: 'string' },
          { id: 'f-dup2', name: 'dup', type: 'number' },
          { id: 'legacy-7', name: '', type: 'string' },
        ],
      }),
    ]),
  ],
  [
    'empty string kept apart from null',
    workflowState([
      blockState('s1', 'slack', 'Slack', { operation: '', text: null, threadTs: '' }),
    ]),
  ],
  [
    'variables and variables-input ids, with a literal $sim object',
    workflowState(
      [
        blockState('v1', 'variables', 'Set', {
          variables: JSON.stringify([
            { id: 'row-a', variableId: 'var-1', variableName: 'count', value: '1' },
            { id: 'row-b', variableId: 'var-gone', value: '2' },
          ]),
        }),
        blockState('f1', 'function', 'Code', { code: '<variable.var-1>' }),
        blockState('x1', 'api', 'Raw', { url: { $sim: 'not-a-node', x: 1 } }),
      ],
      {
        variables: {
          'var-1': { id: 'var-1', name: 'Count', type: 'number', value: 1 },
          'var-2': { id: 'var-2', name: 'Payload', type: 'object', value: { a: [1, null] } },
        },
      }
    ),
  ],
  [
    'unknown and legacy block types and extra data',
    workflowState([
      blockState(
        'u1',
        'custom_block_acme',
        'Acme',
        { '9b0c-field': 'v', workflowId: 'wf' },
        {
          data: { type: 'acme', customFlag: { nested: true } } as BlockState['data'],
        }
      ),
      blockState('u2', 'function_v0', 'Old Code', { code: 'legacy' }),
    ]),
  ],
]
