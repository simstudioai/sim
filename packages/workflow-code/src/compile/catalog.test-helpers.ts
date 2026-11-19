import type {
  BlockCatalog,
  CatalogBlock,
  CatalogBlockGraph,
  CatalogOutput,
  CatalogSubBlock,
} from '../catalog/types'

/**
 * A small hand-built catalog for compile tests: one block per grammar feature (operation
 * builder, basic/advanced pair, branches, containers, triggers, code, notes), shaped exactly like
 * the `BlockCatalog` contract so tests never depend on the registry projection.
 */

/** The flags the registry projection sets by subBlock type (`TYPE_RULES`, value-kind.ts). */
const TYPE_FLAGS: Partial<Record<CatalogSubBlock['type'], Partial<CatalogSubBlock>>> = {
  'short-input': { acceptsNumber: true },
  'long-input': { acceptsNumber: true, neverDecoded: true },
  code: { neverDecoded: true },
  'filter-builder': { tableFilter: true },
}

function sub(
  id: string,
  type: CatalogSubBlock['type'],
  valueKind: CatalogSubBlock['valueKind'],
  extra: Partial<CatalogSubBlock> = {}
): CatalogSubBlock {
  return { id, type, valueKind, storage: 'native', ...TYPE_FLAGS[type], ...extra }
}

const ANY: CatalogOutput = { type: 'json' }
const TEXT: CatalogOutput = { type: 'string' }

function graph(extra: Partial<CatalogBlockGraph> = {}): CatalogBlockGraph {
  return {
    canBeTarget: true,
    errorPort: true,
    container: null,
    annotationOnly: false,
    ...extra,
  }
}

function block(
  type: string,
  subBlocks: CatalogSubBlock[],
  outputs: Record<string, CatalogOutput>,
  extra: Partial<CatalogBlock> = {}
): CatalogBlock {
  return {
    type,
    name: type,
    category: 'blocks',
    subBlocks,
    tools: { access: [], selector: 'single' },
    outputs,
    graph: graph(),
    ...extra,
  }
}

export const TEST_CATALOG: BlockCatalog = {
  catalogVersion: 1,
  hash: 'test',
  sdkMajor: 1,
  builders: {
    'trigger.start': { type: 'start_trigger' },
    'trigger.gmail.poller': {
      type: 'gmail',
      triggerMode: true,
      fixed: { selectedTriggerId: 'gmail_poller' },
    },
    agent: { type: 'agent' },
    api: { type: 'api' },
    condition: { type: 'condition' },
    router: { type: 'router_v2' },
    fn: { type: 'function' },
    note: { type: 'note' },
    'slack.sendMessage': { type: 'slack', operation: 'send' },
    'slack.listChannels': { type: 'slack', operation: 'list_channels' },
    'table.insertRow': { type: 'table', operation: 'insert_row' },
    'mail.send': { type: 'mail' },
    human: { type: 'human_in_the_loop_v2' },
  },
  blocks: {
    start_trigger: block(
      'start_trigger',
      [sub('inputFormat', 'input-format', 'array', { structured: 'inputFormat' })],
      { input: ANY, conversationId: TEXT, files: ANY },
      {
        category: 'triggers',
        dynamicOutputs: { source: 'inputFormat', param: 'inputFormat' },
        graph: graph({ canBeTarget: false, errorPort: false }),
      }
    ),
    agent: block(
      'agent',
      [
        sub('model', 'combobox', 'string', { required: true }),
        sub('messages', 'messages-input', 'array'),
        sub('responseFormat', 'code', 'json', { language: 'json' }),
        sub('temperature', 'slider', 'number', { min: 0, max: 1, valueShape: 'number' }),
        sub('tools', 'tool-input', 'tools', { structured: 'tools' }),
      ],
      { content: TEXT, model: TEXT, tokens: ANY },
      { dynamicOutputs: { source: 'responseFormat', param: 'responseFormat' } }
    ),
    api: block(
      'api',
      [
        sub('url', 'short-input', 'string', { required: true }),
        sub('method', 'dropdown', 'string', {
          options: [
            { id: 'GET', label: 'GET' },
            { id: 'POST', label: 'POST' },
          ],
          valueDefault: { constant: 'GET' },
        }),
        sub('headers', 'table', 'object', { valueShape: 'json' }),
        sub('body', 'code', 'json', { language: 'json' }),
      ],
      {
        data: ANY,
        status: { type: 'number' },
        headers: { type: 'json', properties: { contentType: TEXT } },
      }
    ),
    human_in_the_loop_v2: block(
      'human_in_the_loop_v2',
      [sub('inputFormat', 'input-format', 'array', { structured: 'inputFormat' })],
      { url: TEXT, submission: ANY },
      { dynamicOutputs: { source: 'humanForm', param: 'inputFormat' } }
    ),
    condition: block(
      'condition',
      [sub('conditions', 'condition-input', 'branches', { structured: 'branches' })],
      { conditionResult: { type: 'boolean' }, selectedPath: ANY, selectedOption: TEXT },
      { graph: graph({ branches: { subBlockId: 'conditions', kind: 'condition' } }) }
    ),
    router_v2: block(
      'router_v2',
      [
        sub('context', 'long-input', 'string', { required: true }),
        sub('routes', 'router-input', 'branches', { structured: 'branches' }),
        sub('model', 'combobox', 'string'),
      ],
      { selectedRoute: TEXT, reasoning: TEXT },
      { graph: graph({ branches: { subBlockId: 'routes', kind: 'router' } }) }
    ),
    function: block(
      'function',
      [
        sub('language', 'dropdown', 'string', {
          options: [
            { id: 'javascript', label: 'JavaScript' },
            { id: 'python', label: 'Python' },
            { id: 'shell', label: 'Shell' },
          ],
        }),
        sub('code', 'code', 'code', { required: true }),
      ],
      { result: ANY, stdout: TEXT }
    ),
    note: block(
      'note',
      [sub('content', 'long-input', 'string')],
      {},
      {
        graph: graph({ annotationOnly: true, canBeTarget: false, errorPort: false }),
      }
    ),
    slack: block(
      'slack',
      [
        sub('operation', 'dropdown', 'string', {
          options: [
            { id: 'send', label: 'Send Message' },
            { id: 'list_channels', label: 'List Channels' },
          ],
        }),
        sub('authMethod', 'dropdown', 'string', {
          options: [
            { id: 'oauth', label: 'OAuth' },
            { id: 'bot_token', label: 'Bot token' },
          ],
        }),
        sub('credential', 'oauth-input', 'resource', {
          resourceKind: 'credential',
          condition: { field: 'authMethod', value: 'oauth' },
        }),
        sub('botToken', 'short-input', 'string', {
          password: true,
          condition: { field: 'authMethod', value: 'bot_token' },
        }),
        sub('channel', 'channel-selector', 'picked', {
          mode: 'basic',
          canonicalParamId: 'channel',
          condition: { field: 'operation', value: 'send' },
        }),
        sub('manualChannel', 'short-input', 'string', {
          mode: 'advanced',
          canonicalParamId: 'channel',
          condition: { field: 'operation', value: 'send' },
        }),
        sub('text', 'long-input', 'string', {
          required: { field: 'operation', value: 'send' },
          condition: { field: 'operation', value: 'send' },
        }),
        sub('limit', 'short-input', 'number', {
          condition: { field: 'operation', value: 'list_channels' },
        }),
        sub('threadTs', 'short-input', 'string', { condition: { opaque: true } }),
      ],
      { ts: TEXT, channel: TEXT, to: TEXT },
      { category: 'tools' }
    ),
    table: block(
      'table',
      [
        sub('operation', 'dropdown', 'string', {
          options: [{ id: 'insert_row', label: 'Insert Row' }],
        }),
        sub('tableId', 'table-selector', 'resource', { resourceKind: 'table' }),
        sub('data', 'code', 'json', { language: 'json' }),
        sub('filterBuilder', 'filter-builder', 'json', {
          mode: 'basic',
          canonicalParamId: 'filterInput',
        }),
        sub('filter', 'code', 'json', {
          language: 'json',
          mode: 'advanced',
          canonicalParamId: 'filterInput',
        }),
      ],
      { row: ANY }
    ),
    gmail: block(
      'gmail',
      [
        sub('credential', 'oauth-input', 'resource', {
          resourceKind: 'credential',
          surface: 'trigger',
          mode: 'trigger',
        }),
        sub('labelIds', 'dropdown', 'array', {
          surface: 'trigger',
          mode: 'trigger',
          multiple: true,
          valueShape: 'json',
        }),
        sub('markAsRead', 'switch', 'boolean', {
          surface: 'trigger',
          mode: 'trigger',
          valueShape: 'boolean',
        }),
        sub('selectedTriggerId', 'dropdown', 'string', { surface: 'trigger', hidden: true }),
        sub('to', 'short-input', 'string', { surface: 'action' }),
      ],
      { email: ANY },
      { triggerAllowed: true }
    ),
    mail: block(
      'mail',
      [
        sub('credential', 'oauth-input', 'resource', {
          resourceKind: 'credential',
          mode: 'basic',
          canonicalParamId: 'oauthCredential',
        }),
        sub('manualCredential', 'short-input', 'string', {
          mode: 'advanced',
          canonicalParamId: 'oauthCredential',
        }),
        sub('apiKey', 'short-input', 'string', { password: true }),
        sub('to', 'short-input', 'string'),
      ],
      { id: TEXT },
      { category: 'tools', paramAliases: { action: { oauthCredential: 'credential' } } }
    ),
    loop: block(
      'loop',
      [],
      { results: ANY },
      { graph: graph({ container: 'loop', errorPort: false }) }
    ),
    parallel: block(
      'parallel',
      [],
      { results: ANY },
      { graph: graph({ container: 'parallel', errorPort: false }) }
    ),
  },
  triggers: {},
}
