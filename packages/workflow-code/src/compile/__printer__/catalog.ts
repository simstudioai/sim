/**
 * A small hand-built catalog covering every construct the printer handles: triggers, an operation
 * namespace, basic/advanced pairs, selectors, code fields, branches, tools, containers, a note and
 * a trigger-mode builder. Shapes follow `catalog/types.ts`; values are illustrative only.
 */

import type {
  BlockCatalog,
  CatalogBlock,
  CatalogSubBlock,
  CatalogValueKind,
} from '../../catalog/types'

type SubBlockInit = Partial<CatalogSubBlock> & Pick<CatalogSubBlock, 'id' | 'type'>

function sb(init: SubBlockInit & { valueKind?: CatalogValueKind }): CatalogSubBlock {
  return { valueKind: 'string', storage: 'native', ...init }
}

function block(
  type: string,
  subBlocks: CatalogSubBlock[],
  extra: Partial<CatalogBlock> = {}
): CatalogBlock {
  return {
    type,
    name: type,
    category: 'blocks',
    subBlocks,
    tools: { access: [], selector: 'single' },
    inputs: {},
    outputs: {},
    graph: { canBeTarget: true, errorPort: true, container: null, annotationOnly: false },
    ...extra,
  }
}

const trigger = (type: string, subBlocks: CatalogSubBlock[]) =>
  block(type, subBlocks, {
    category: 'triggers',
    graph: { canBeTarget: false, errorPort: false, container: null, annotationOnly: false },
  })

export const catalog: BlockCatalog = {
  catalogVersion: 1,
  hash: 'fixture',
  sdkMajor: 1,
  blocks: {
    start_trigger: trigger('start_trigger', [
      sb({
        id: 'inputFormat',
        type: 'input-format',
        valueKind: 'array',
        structured: 'inputFormat',
      }),
    ]),
    webhook: trigger('webhook', [
      sb({ id: 'requireAuth', type: 'switch', valueKind: 'boolean' }),
      sb({ id: 'token', type: 'short-input', password: true }),
      sb({
        id: 'inputFormat',
        type: 'input-format',
        valueKind: 'array',
        structured: 'inputFormat',
      }),
    ]),
    agent: block('agent', [
      sb({ id: 'model', type: 'combobox', required: true }),
      sb({ id: 'messages', type: 'messages-input', valueKind: 'array' }),
      sb({ id: 'systemPrompt', type: 'long-input' }),
      sb({ id: 'responseFormat', type: 'code', valueKind: 'code', language: 'json' }),
      sb({ id: 'tools', type: 'tool-input', valueKind: 'tools', structured: 'tools' }),
      sb({ id: 'temperature', type: 'slider', valueKind: 'number', min: 0, max: 2 }),
      sb({
        id: 'memoryType',
        type: 'dropdown',
        options: [
          { id: 'none', label: 'None' },
          { id: 'conversation', label: 'Conversation' },
        ],
      }),
      sb({
        id: 'conversationId',
        type: 'short-input',
        condition: { field: 'memoryType', value: 'conversation' },
      }),
    ]),
    slack: block('slack', [
      sb({
        id: 'operation',
        type: 'dropdown',
        options: [
          { id: 'send', label: 'Send Message' },
          { id: 'read', label: 'Read Messages' },
        ],
      }),
      sb({
        id: 'authMethod',
        type: 'dropdown',
        options: [
          { id: 'oauth', label: 'OAuth' },
          { id: 'bot_token', label: 'Bot token' },
        ],
      }),
      sb({
        id: 'credential',
        type: 'oauth-input',
        valueKind: 'resource',
        resourceKind: 'credential',
      }),
      sb({ id: 'botToken', type: 'short-input', password: true }),
      sb({
        id: 'channel',
        type: 'channel-selector',
        valueKind: 'picked',
        mode: 'basic',
        canonicalParamId: 'channel',
      }),
      sb({
        id: 'manualChannel',
        type: 'short-input',
        mode: 'advanced',
        canonicalParamId: 'channel',
      }),
      sb({ id: 'text', type: 'long-input', required: true }),
      sb({ id: 'limit', type: 'short-input', condition: { field: 'operation', value: 'read' } }),
    ]),
    function: block('function', [
      sb({
        id: 'language',
        type: 'dropdown',
        options: [
          { id: 'javascript', label: 'JavaScript' },
          { id: 'python', label: 'Python' },
          { id: 'shell', label: 'Shell' },
        ],
      }),
      sb({ id: 'code', type: 'code', valueKind: 'code', language: 'javascript' }),
    ]),
    condition: block(
      'condition',
      [
        sb({
          id: 'conditions',
          type: 'condition-input',
          valueKind: 'branches',
          structured: 'branches',
        }),
      ],
      {
        graph: {
          canBeTarget: true,
          errorPort: false,
          container: null,
          annotationOnly: false,
          branches: { subBlockId: 'conditions', kind: 'condition' },
        },
      }
    ),
    router: block(
      'router',
      [
        sb({ id: 'context', type: 'long-input' }),
        sb({ id: 'model', type: 'combobox' }),
        sb({ id: 'routes', type: 'router-input', valueKind: 'branches', structured: 'branches' }),
      ],
      {
        graph: {
          canBeTarget: true,
          errorPort: false,
          container: null,
          annotationOnly: false,
          branches: { subBlockId: 'routes', kind: 'router' },
        },
      }
    ),
    table: block('table', [
      sb({
        id: 'operation',
        type: 'dropdown',
        options: [
          { id: 'insert_row', label: 'Insert Row' },
          { id: 'query_rows', label: 'Query Rows' },
        ],
      }),
      sb({
        id: 'tableSelector',
        type: 'table-selector',
        valueKind: 'resource',
        resourceKind: 'table',
        mode: 'basic',
        canonicalParamId: 'tableId',
      }),
      sb({
        id: 'manualTableId',
        type: 'short-input',
        mode: 'advanced',
        canonicalParamId: 'tableId',
      }),
      sb({ id: 'data', type: 'code', valueKind: 'code', language: 'json' }),
      sb({ id: 'limit', type: 'short-input' }),
      sb({
        id: 'knowledgeBases',
        type: 'knowledge-base-selector',
        valueKind: 'resource',
        resourceKind: 'knowledge-base',
        multiple: true,
      }),
    ]),
    note: block('note', [sb({ id: 'content', type: 'long-input' })], {
      graph: { canBeTarget: false, errorPort: false, container: null, annotationOnly: true },
    }),
    variables: block('variables', [
      sb({ id: 'variables', type: 'variables-input', valueKind: 'array', structured: 'variables' }),
    ]),
    api: block('api', [
      sb({ id: 'url', type: 'short-input', required: true }),
      sb({
        id: 'method',
        type: 'dropdown',
        options: [
          { id: 'GET', label: 'GET' },
          { id: 'POST', label: 'POST' },
        ],
      }),
      sb({ id: 'headers', type: 'table', valueKind: 'array' }),
      sb({ id: 'body', type: 'code', valueKind: 'code', language: 'json' }),
    ]),
    gmail: block(
      'gmail',
      [
        sb({
          id: 'operation',
          type: 'dropdown',
          surface: 'action',
          options: [{ id: 'send_gmail', label: 'Send Email' }],
        }),
        sb({
          id: 'credential',
          type: 'oauth-input',
          valueKind: 'resource',
          resourceKind: 'credential',
        }),
        sb({ id: 'to', type: 'short-input', surface: 'action' }),
        sb({ id: 'subject', type: 'short-input', surface: 'action' }),
        sb({ id: 'body', type: 'long-input', surface: 'action' }),
        sb({ id: 'selectedTriggerId', type: 'dropdown', surface: 'trigger', mode: 'trigger' }),
        sb({
          id: 'labelIds',
          type: 'dropdown',
          surface: 'trigger',
          mode: 'trigger',
          multiple: true,
        }),
        sb({
          id: 'markAsRead',
          type: 'switch',
          valueKind: 'boolean',
          surface: 'trigger',
          mode: 'trigger',
        }),
      ],
      { triggerAllowed: true }
    ),
    response: block('response', [
      sb({ id: 'dataMode', type: 'dropdown', options: [{ id: 'structured', label: 'Builder' }] }),
      sb({ id: 'builderData', type: 'response-format', valueKind: 'object' }),
    ]),
    loop: block('loop', [], {
      graph: { canBeTarget: true, errorPort: false, container: 'loop', annotationOnly: false },
    }),
    parallel: block('parallel', [], {
      graph: { canBeTarget: true, errorPort: false, container: 'parallel', annotationOnly: false },
    }),
  },
  triggers: {},
  builders: {
    'trigger.start': { type: 'start_trigger' },
    'trigger.webhook': { type: 'webhook' },
    agent: { type: 'agent' },
    'slack.sendMessage': { type: 'slack', operation: 'send' },
    'slack.readMessages': { type: 'slack', operation: 'read' },
    fn: { type: 'function' },
    condition: { type: 'condition' },
    router: { type: 'router' },
    'table.insertRow': { type: 'table', operation: 'insert_row' },
    'table.queryRows': { type: 'table', operation: 'query_rows' },
    note: { type: 'note' },
    setVariables: { type: 'variables' },
    api: { type: 'api' },
    'gmail.sendEmail': { type: 'gmail', operation: 'send_gmail' },
    'trigger.gmail.poller': {
      type: 'gmail',
      triggerMode: true,
      fixed: { selectedTriggerId: 'gmail_poller' },
    },
    response: { type: 'response' },
  },
}
