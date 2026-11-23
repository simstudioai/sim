import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import { executableInactiveParams } from '../catalog/activity'
import type { BlockCatalog, CatalogBlock, CatalogSubBlock } from '../catalog/types'
import { canonicalEquals, canonicalHash } from '../equivalence'
import { parseWorkflowLock } from '../lock'
import type {
  CanonicalBlock,
  CanonicalParam,
  CanonicalWorkflow,
  ResourceKeyResolver,
  SubBlockId,
  Value,
} from '../model'
import type { CanonicalizeOptions } from '.'
import { canonicalize } from '.'

/*
 * The catalog below is hand-projected from real registry configs (apps/sim/blocks/blocks:
 * slack.ts, agent.ts, condition.ts, router_v2.ts, function.ts, variables.ts, api.ts,
 * start_trigger.ts, table.ts, gmail.ts with triggers/gmail/poller.ts, generic_webhook.ts with
 * triggers/generic/webhook.ts) down to the fields canonicalize reads.
 */

function sb(
  fields: Partial<CatalogSubBlock> & Pick<CatalogSubBlock, 'id' | 'type'>
): CatalogSubBlock {
  return { valueKind: 'string', storage: 'native', ...fields }
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
    outputs: {},
    graph: { canBeTarget: true, errorPort: true, container: null, annotationOnly: false },
    ...extra,
  }
}

const SEND_OPERATIONS = ['send', 'ephemeral']

const CATALOG: BlockCatalog = {
  catalogVersion: 1,
  hash: 'fixture',
  sdkMajor: 1,
  builders: {},
  triggers: {},
  blocks: {
    slack: block('slack', [
      sb({ id: 'operation', type: 'dropdown' }),
      sb({
        id: 'credential',
        type: 'oauth-input',
        canonicalParamId: 'oauthCredential',
        mode: 'basic',
        valueKind: 'resource',
        resourceKind: 'credential',
      }),
      sb({
        id: 'manualCredential',
        type: 'short-input',
        canonicalParamId: 'oauthCredential',
        mode: 'advanced',
      }),
      sb({
        id: 'channel',
        type: 'channel-selector',
        canonicalParamId: 'channel',
        mode: 'basic',
        valueKind: 'picked',
      }),
      sb({
        id: 'manualChannel',
        type: 'short-input',
        canonicalParamId: 'channel',
        mode: 'advanced',
        condition: { opaque: true },
      }),
      sb({
        id: 'text',
        type: 'long-input',
        condition: { field: 'operation', value: SEND_OPERATIONS },
      }),
      sb({ id: 'threadTs', type: 'short-input', mode: 'advanced' }),
      sb({
        id: 'pageLimit',
        type: 'short-input',
        condition: { opaque: true },
        visibleFor: { read: true, send: false },
      }),
      sb({ id: 'destinationType', type: 'dropdown' }),
      sb({
        id: 'dmUserId',
        type: 'short-input',
        condition: { opaque: true },
        visibleFor: { read: false, send: true },
        visibleWhen: { send: { field: 'destinationType', value: 'dm' } },
      }),
      sb({ id: 'botToken', type: 'short-input', mode: 'trigger', surface: 'trigger' }),
      sb({ id: 'signingSecret', type: 'short-input', mode: 'trigger', surface: 'trigger' }),
      sb({
        id: 'signingSecret',
        type: 'short-input',
        surface: 'action',
        condition: { field: 'operation', value: 'never' },
      }),
      sb({ id: 'scopeNote', type: 'short-input', context: 'tool-input' }),
    ]),
    agent: block('agent', [
      sb({ id: 'messages', type: 'messages-input', valueKind: 'json' }),
      sb({ id: 'model', type: 'combobox' }),
      sb({
        id: 'vertexProject',
        type: 'short-input',
        condition: { opaque: true },
        visibleForModel: { 'gpt-5.5': false, 'vertex/gemini': true },
      }),
      sb({
        id: 'tools',
        type: 'tool-input',
        valueKind: 'tools',
        structured: 'tools',
        storage: 'native',
      }),
      sb({ id: 'responseFormat', type: 'code', valueKind: 'code', language: 'json' }),
    ]),
    table: block('table', [
      sb({
        id: 'tableId',
        type: 'table-selector',
        canonicalParamId: 'tableId',
        mode: 'basic',
        valueKind: 'resource',
        resourceKind: 'table',
      }),
      sb({
        id: 'manualTableId',
        type: 'short-input',
        canonicalParamId: 'tableId',
        mode: 'advanced',
      }),
      sb({ id: 'limit', type: 'short-input' }),
      sb({ id: 'includeMeta', type: 'switch', valueKind: 'boolean', valueShape: 'boolean' }),
    ]),
    knowledge: block('knowledge', [
      sb({
        id: 'knowledgeBaseIds',
        type: 'knowledge-base-selector',
        multiple: true,
        valueShape: 'json',
        valueKind: 'resource',
        resourceKind: 'knowledge-base',
      }),
      sb({
        id: 'tagFilters',
        type: 'knowledge-tag-filters',
        valueKind: 'json',
        storage: 'json-string',
      }),
    ]),
    condition: block(
      'condition',
      [
        sb({
          id: 'conditions',
          type: 'condition-input',
          valueKind: 'branches',
          structured: 'branches',
          storage: 'json-string',
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
    router_v2: block(
      'router_v2',
      [
        sb({ id: 'context', type: 'long-input' }),
        sb({
          id: 'routes',
          type: 'router-input',
          valueKind: 'branches',
          structured: 'branches',
          storage: 'json-string',
        }),
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
    function: block('function', [
      sb({ id: 'language', type: 'dropdown' }),
      sb({ id: 'code', type: 'code', valueKind: 'code' }),
    ]),
    variables: block('variables', [
      sb({ id: 'variables', type: 'variables-input', valueKind: 'json', structured: 'variables' }),
    ]),
    api: block('api', [
      sb({ id: 'url', type: 'short-input' }),
      sb({
        id: 'headers',
        type: 'table',
        valueKind: 'array',
        structured: 'tableRows',
        valueShape: 'json',
        columns: ['Key', 'Value'],
      }),
    ]),
    start_trigger: block(
      'start_trigger',
      [
        sb({
          id: 'inputFormat',
          type: 'input-format',
          valueKind: 'array',
          structured: 'inputFormat',
        }),
      ],
      { category: 'triggers' }
    ),
    gmail: block('gmail', [
      sb({ id: 'operation', type: 'dropdown', surface: 'action' }),
      sb({
        id: 'credential',
        type: 'oauth-input',
        canonicalParamId: 'oauthCredential',
        mode: 'basic',
        surface: 'action',
      }),
      sb({
        id: 'manualCredential',
        type: 'short-input',
        canonicalParamId: 'oauthCredential',
        mode: 'advanced',
        surface: 'action',
      }),
      sb({
        id: 'triggerCredentials',
        type: 'oauth-input',
        canonicalParamId: 'oauthCredential',
        mode: 'trigger',
        surface: 'trigger',
      }),
      sb({ id: 'labelIds', type: 'dropdown', mode: 'trigger', surface: 'trigger' }),
    ]),
    generic_webhook: block(
      'generic_webhook',
      [
        sb({
          id: 'requireAuth',
          type: 'switch',
          mode: 'trigger',
          surface: 'trigger',
          valueShape: 'boolean',
        }),
        sb({ id: 'token', type: 'short-input', mode: 'trigger', surface: 'trigger' }),
      ],
      { category: 'triggers' }
    ),
    custom_block_acme: block(
      'custom_block_acme',
      [
        sb({ id: '9b0c0d5e-field', type: 'short-input' }),
        sb({ id: 'workflowId', type: 'short-input' }),
      ],
      { custom: { sourceWorkflowId: 'wf-src' } }
    ),
    custom_block_legacy: block(
      'custom_block_legacy',
      [
        sb({ id: 'workflowId', type: 'short-input' }),
        sb({ id: 'inputMapping', type: 'short-input' }),
      ],
      { custom: { sourceWorkflowId: 'wf-src' } }
    ),
  },
}

type SubBlocks = Record<string, unknown>

function blockState(
  id: string,
  type: string,
  name: string,
  values: SubBlocks = {},
  extra: Partial<BlockState> = {}
): BlockState {
  const subBlocks: BlockState['subBlocks'] = {}
  for (const [subBlockId, value] of Object.entries(values)) {
    subBlocks[subBlockId] = { id: subBlockId, type: 'short-input', value: value as never }
  }
  return {
    id,
    type,
    name,
    position: { x: 0, y: 0 },
    subBlocks,
    outputs: {},
    enabled: true,
    ...extra,
  }
}

function workflow(blocks: BlockState[], extra: Partial<WorkflowState> = {}): WorkflowState {
  return {
    blocks: Object.fromEntries(blocks.map((b) => [b.id, b])),
    edges: [],
    loops: {},
    parallels: {},
    ...extra,
  }
}

const META = { name: 'Fixture', description: null }

function run(state: WorkflowState, options: Partial<CanonicalizeOptions> = {}) {
  return canonicalize(state, { catalog: CATALOG, meta: META, ...options })
}

function onlyBlock(result: ReturnType<typeof run>, key: string): CanonicalBlock {
  const found = result.workflow.blocks[key]
  expect(found).toBeDefined()
  return found
}

/** The params source leaves out of a block: the one inactivity rule print and compile use. */
function inactiveOf(result: ReturnType<typeof run>, key: string): SubBlockId[] {
  return executableInactiveParams(onlyBlock(result, key), CATALOG)
}

function value(param: CanonicalParam | undefined): Value | undefined {
  return param?.kind === 'value' ? param.value : undefined
}

function codes(result: ReturnType<typeof run>): string[] {
  return result.diagnostics.map((d) => d.code)
}

/** The diagnostics `parseWorkflowLock` gives a lock built from `result`'s identity. */
function lockDiagnostics(result: ReturnType<typeof run>) {
  const blocks = Object.fromEntries(
    Object.entries(result.identity.blocks).map(([key, entry], order) => [
      key,
      { ...entry, ident: `block${order}`, order },
    ])
  )
  return parseWorkflowLock({ version: 1, blocks, variables: result.identity.variables }).diagnostics
}

describe('canonicalize: keys and names', () => {
  it('keys a block by its normalized name', () => {
    const result = run(workflow([blockState('b1', 'function', 'My Code.v2')]))
    expect(Object.keys(result.workflow.blocks)).toEqual(['mycodev2'])
    expect(result.identity.blocks.mycodev2.id).toBe('b1')
  })

  it('gives the dot-free name the key and keys the dotted loser key~2 with an error', () => {
    const result = run(
      workflow([blockState('b1', 'function', 'Agent.1'), blockState('b2', 'function', 'Agent 1')])
    )
    expect(result.identity.blocks.agent1.id).toBe('b2')
    expect(result.identity.blocks['agent1~2'].id).toBe('b1')
    expect(codes(result)).toContain('E_CANON_LEGACY_NAME_COLLISION')
  })

  it('keeps the first of two dot-free colliding names, as the resolver does', () => {
    const result = run(
      workflow([blockState('b1', 'function', 'agent 1'), blockState('b2', 'function', 'Agent1')])
    )
    expect(result.identity.blocks.agent1.id).toBe('b1')
    expect(result.identity.blocks['agent1~2'].id).toBe('b2')
  })

  it('skips a ~n suffix another block already owns', () => {
    const result = run(
      workflow([
        blockState('b1', 'function', 'x'),
        blockState('b2', 'function', 'x~2'),
        blockState('b3', 'function', 'X'),
      ])
    )
    expect(result.identity.blocks['x~3'].id).toBe('b3')
  })

  it('warns when a name normalizes to a reserved prefix', () => {
    const result = run(workflow([blockState('b1', 'function', 'Loop')]))
    expect(codes(result)).toContain('W_CANON_RESERVED_NAME')
  })

  it('rewrites reference prefixes to the normalized form the resolver matches', () => {
    const result = run(
      workflow([
        blockState('b1', 'function', 'My Agent'),
        blockState('b2', 'function', 'Code', {
          code: 'return <My Agent.content> + <unknown block.x> + <loop.index> + a<b',
        }),
      ])
    )
    expect(value(onlyBlock(result, 'code').params.code)).toBe(
      'return <myagent.content> + <unknown block.x> + <loop.index> + a<b'
    )
  })

  it('rewrites variable references by id or name to the variable key', () => {
    const result = run(
      workflow(
        [
          blockState('b1', 'function', 'Code', {
            code: '<variable.v-1> <variable.MyVar.x> <variable.My Var.x>',
          }),
        ],
        {
          variables: { 'v-1': { id: 'v-1', name: 'My Var', type: 'string', value: 'a' } },
        }
      )
    )
    expect(value(onlyBlock(result, 'code').params.code)).toBe(
      '<variable.myvar> <variable.myvar.x> <variable.My Var.x>'
    )
    expect(result.identity.variables).toEqual({ myvar: 'v-1' })
  })
})

describe('canonicalize: params', () => {
  it('drops runtime ids, synthetic tool mirrors and parked keys', () => {
    const result = run(
      workflow([
        blockState('b1', 'slack', 'Slack', {
          operation: 'send',
          webhookId: 'wh',
          triggerPath: 'b1',
          triggerConfig: { a: 1 },
          triggerId: 'slack_webhook',
          'tools-tool-0-channel': 'C1',
          _removed_legacy: 'secret',
        }),
      ])
    )
    expect(Object.keys(onlyBlock(result, 'slack').params)).toEqual(['operation'])
  })

  it('drops a null value and keeps an empty string', () => {
    const result = run(
      workflow([blockState('b1', 'slack', 'Slack', { operation: '', text: null })])
    )
    const params = onlyBlock(result, 'slack').params
    expect(params.operation).toEqual({ kind: 'value', value: '' })
    expect(params.text).toBeUndefined()
  })

  it('keeps stored outputs out of the model', () => {
    const plain = run(workflow([blockState('b1', 'function', 'Code', { code: 'x' })]))
    const withOutputs = run(
      workflow([
        blockState(
          'b1',
          'function',
          'Code',
          { code: 'x' },
          {
            outputs: { result: { type: 'json' } } as BlockState['outputs'],
          }
        ),
      ])
    )
    expect(canonicalEquals(plain.workflow, withOutputs.workflow)).toBe(true)
  })

  it('decodes structured JSON text and never decodes code or long-input', () => {
    const result = run(
      workflow([
        blockState('b1', 'knowledge', 'KB', { tagFilters: ' [ {"tag":"a"} ] ' }),
        blockState('b2', 'agent', 'Agent', { responseFormat: '{"type":"object"}' }),
        blockState('b3', 'slack', 'Slack', { operation: 'send', text: '{"blocks":[]}' }),
      ])
    )
    expect(value(onlyBlock(result, 'kb').params.tagFilters)).toEqual([{ tag: 'a' }])
    expect(value(onlyBlock(result, 'agent').params.responseFormat)).toBe('{"type":"object"}')
    expect(value(onlyBlock(result, 'slack').params.text)).toBe('{"blocks":[]}')
  })

  it('keeps undecodable structured text and reports it', () => {
    const result = run(workflow([blockState('b1', 'knowledge', 'KB', { tagFilters: '[{oops' })]))
    expect(value(onlyBlock(result, 'kb').params.tagFilters)).toBe('[{oops')
    expect(codes(result)).toContain('W_CANON_UNDECODABLE_JSON')
  })

  it('drops table row ids and blank starter rows but keeps other row shapes', () => {
    const result = run(
      workflow([
        blockState('b1', 'api', 'API', {
          headers: [
            { id: 'r1', cells: { Key: 'a', Value: '1' } },
            { id: 'r2', cells: { Key: '', Value: '' } },
            { name: 'flat', value: 'row' },
          ],
        }),
      ])
    )
    expect(value(onlyBlock(result, 'api').params.headers)).toEqual([
      { cells: { Key: 'a', Value: '1' } },
      { name: 'flat', value: 'row' },
    ])
  })

  it('moves inputFormat ids to identity items, keeping ids of shared names inline', () => {
    const result = run(
      workflow([
        blockState('b1', 'start_trigger', 'Start', {
          inputFormat: [
            { id: 'f1', name: 'email', type: 'string', collapsed: true },
            { id: 'f2', name: 'dup', type: 'string' },
            { id: 'f3', name: 'dup', type: 'number' },
          ],
        }),
      ])
    )
    expect(value(onlyBlock(result, 'start').params.inputFormat)).toEqual([
      { name: 'email', type: 'string' },
      { id: 'f2', name: 'dup', type: 'string' },
      { id: 'f3', name: 'dup', type: 'number' },
    ])
    expect(result.identity.blocks.start.items).toEqual({
      inputFormat: [{ name: 'email', id: 'f1' }],
    })
  })

  it('keeps an inputFormat id inline when another field shares it, so the lock parses', () => {
    const result = run(
      workflow([
        blockState('b1', 'start_trigger', 'Start', {
          inputFormat: [
            { id: 'f1', name: 'email', type: 'string' },
            { id: 'f1', name: 'phone', type: 'string' },
            { id: 'f2', name: 'age', type: 'number' },
          ],
        }),
      ])
    )
    expect(value(onlyBlock(result, 'start').params.inputFormat)).toEqual([
      { id: 'f1', name: 'email', type: 'string' },
      { id: 'f1', name: 'phone', type: 'string' },
      { name: 'age', type: 'number' },
    ])
    expect(result.identity.blocks.start.items).toEqual({
      inputFormat: [{ name: 'age', id: 'f2' }],
    })
    expect(lockDiagnostics(result)).toBeUndefined()
  })

  it('wraps a stored object that already has a $sim key as a literal', () => {
    const result = run(
      workflow([blockState('b1', 'agent', 'Agent', { messages: [{ $sim: 'var', key: 'x' }] })])
    )
    expect(value(onlyBlock(result, 'agent').params.messages)).toEqual([
      { $sim: 'literal', value: { $sim: 'var', key: 'x' } },
    ])
  })

  it('reports stored subBlock type drift and a map key that differs from subBlock.id', () => {
    const state = workflow([blockState('b1', 'function', 'Code', { code: 'x' })])
    state.blocks.b1.subBlocks.code = { id: 'other', type: 'short-input', value: 'x' }
    const result = run(state)
    expect(result.diagnostics.filter((d) => d.code === 'W_CANON_SUBBLOCK_TYPE_DRIFT')).toHaveLength(
      2
    )
    expect(value(onlyBlock(result, 'code').params.code)).toBe('x')
  })

  it('keeps a legacy or unknown block type with verbatim params', () => {
    const result = run(workflow([blockState('b1', 'legacy_v1', 'Old', { oldField: ' {"a":1} ' })]))
    expect(value(onlyBlock(result, 'old').params.oldField)).toBe(' {"a":1} ')
    expect(onlyBlock(result, 'old').type).toBe('legacy_v1')
    expect(codes(result)).toContain('W_CANON_UNKNOWN_BLOCK_TYPE')
    expect(inactiveOf(result, 'old')).toEqual([])
  })

  it('keys custom block params by subBlock id', () => {
    const result = run(
      workflow([blockState('b1', 'custom_block_acme', 'Acme', { '9b0c0d5e-field': 'v' })])
    )
    expect(value(onlyBlock(result, 'acme').params['9b0c0d5e-field'])).toBe('v')
  })
})

describe('canonicalize: resources and variables', () => {
  const resolver: ResourceKeyResolver = {
    toKey: (kind, id) => (id.startsWith('known-') ? `${kind}:${id.slice(6)}` : null),
    toId: () => null,
  }

  it('lifts selector ids through the resolver and keeps misses verbatim with a warning', () => {
    const result = run(
      workflow([
        blockState('b1', 'table', 'Table', { tableId: 'known-leads' }),
        blockState('b2', 'table', 'Table 2', { tableId: 'gone' }),
      ]),
      { resources: resolver }
    )
    expect(value(onlyBlock(result, 'table').params.tableId)).toEqual({
      $sim: 'resource',
      kind: 'table',
      key: 'table:leads',
    })
    expect(value(onlyBlock(result, 'table2').params.tableId)).toEqual({
      $sim: 'unresolved',
      kind: 'table',
      id: 'gone',
    })
    expect(codes(result)).toContain('W_CANON_UNRESOLVED_ID')
  })

  it('lifts a comma-joined multi-select into a csv node and leaves references alone', () => {
    const result = run(
      workflow([
        blockState('b1', 'knowledge', 'KB', { knowledgeBaseIds: 'known-a, known-b' }),
        blockState('b2', 'knowledge', 'KB 2', { knowledgeBaseIds: '<start.kb>' }),
      ]),
      { resources: resolver }
    )
    expect(value(onlyBlock(result, 'kb').params.knowledgeBaseIds)).toEqual({
      $sim: 'csv',
      items: [
        { $sim: 'resource', kind: 'knowledge-base', key: 'knowledge-base:a' },
        { $sim: 'resource', kind: 'knowledge-base', key: 'knowledge-base:b' },
      ],
    })
    expect(value(onlyBlock(result, 'kb2').params.knowledgeBaseIds)).toBe('<start.kb>')
  })

  it('lifts variables-input ids to var nodes, decoding JSON text', () => {
    const result = run(
      workflow(
        [
          blockState('b1', 'variables', 'Vars', {
            variables: JSON.stringify([
              { id: 'row1', variableId: 'v-1', value: '1' },
              { id: 'row2', variableId: 'v-missing', value: '2' },
            ]),
          }),
        ],
        { variables: { 'v-1': { id: 'v-1', name: 'Count', type: 'number', value: 0 } } }
      )
    )
    expect(value(onlyBlock(result, 'vars').params.variables)).toEqual([
      { id: 'row1', variableId: { $sim: 'var', key: 'count' }, value: '1' },
      { id: 'row2', variableId: { $sim: 'unresolved', kind: 'var', id: 'v-missing' }, value: '2' },
    ])
    expect(codes(result)).toContain('W_CANON_UNRESOLVED_ID')
  })
})

describe('canonicalize: modes', () => {
  it('uses an explicit override even when the other member holds the value', () => {
    const result = run(
      workflow([
        blockState(
          'b1',
          'slack',
          'Slack',
          { manualChannel: 'C9' },
          { data: { canonicalModes: { channel: 'basic' } } }
        ),
      ])
    )
    expect(onlyBlock(result, 'slack').modes.channel).toBe('basic')
  })

  it('infers advanced when only the advanced member holds a value', () => {
    const result = run(workflow([blockState('b1', 'slack', 'Slack', { manualChannel: 'C9' })]))
    expect(onlyBlock(result, 'slack').modes).toEqual({
      channel: 'advanced',
      oauthCredential: 'basic',
    })
  })

  it('makes every pair advanced under legacy advancedMode unless overridden', () => {
    const result = run(
      workflow([
        blockState(
          'b1',
          'slack',
          'Slack',
          { channel: 'C1' },
          {
            advancedMode: true,
            data: { canonicalModes: { oauthCredential: 'basic' } },
          }
        ),
      ])
    )
    expect(onlyBlock(result, 'slack').modes).toEqual({
      channel: 'advanced',
      oauthCredential: 'basic',
    })
  })
})

describe('canonicalize: inactive params', () => {
  it('keeps a stale hidden value and marks it inactive', () => {
    const result = run(
      workflow([blockState('b1', 'slack', 'Slack', { operation: 'read', text: 'old' })])
    )
    expect(value(onlyBlock(result, 'slack').params.text)).toBe('old')
    expect(inactiveOf(result, 'slack')).toEqual(['text'])
  })

  it('treats a non-empty standalone advanced field as active even with advanced off', () => {
    const result = run(
      workflow([blockState('b1', 'slack', 'Slack', { operation: 'send', threadTs: '1.2' })])
    )
    expect(inactiveOf(result, 'slack')).toEqual([])
  })

  it('marks the dormant member of a pair inactive and counts an opaque condition as active', () => {
    const result = run(
      workflow([
        blockState(
          'b1',
          'slack',
          'Slack',
          { channel: 'C1', manualChannel: 'C9' },
          {
            data: { canonicalModes: { channel: 'advanced' } },
          }
        ),
      ])
    )
    expect(inactiveOf(result, 'slack')).toEqual(['channel'])
  })

  it('reads an opaque condition the catalog expanded per operation from visibleFor', () => {
    const send = run(
      workflow([blockState('b1', 'slack', 'Slack', { operation: 'send', pageLimit: '5' })])
    )
    expect(inactiveOf(send, 'slack')).toEqual(['pageLimit'])
    const read = run(
      workflow([blockState('b1', 'slack', 'Slack', { operation: 'read', pageLimit: '5' })])
    )
    expect(inactiveOf(read, 'slack')).toEqual([])
  })

  it('reads the clause an operation still asks (visibleWhen) and the per-model data', () => {
    const inactive = (type: string, values: Record<string, unknown>) =>
      inactiveOf(run(workflow([blockState('b1', type, 'B', values)])), 'b')
    expect(
      inactive('slack', { operation: 'send', destinationType: 'channel', dmUserId: 'U1' })
    ).toEqual(['dmUserId'])
    expect(inactive('slack', { operation: 'send', destinationType: 'dm', dmUserId: 'U1' })).toEqual(
      []
    )
    expect(inactive('agent', { model: 'gpt-5.5', vertexProject: 'p' })).toEqual(['vertexProject'])
    expect(inactive('agent', { model: 'vertex/gemini', vertexProject: 'p' })).toEqual([])
    expect(inactive('agent', { model: '<start.model>', vertexProject: 'p' })).toEqual([])
  })

  it('marks trigger fields inactive outside trigger mode and active inside it', () => {
    const action = run(
      workflow([blockState('b1', 'slack', 'Slack', { operation: 'send', botToken: 't' })])
    )
    expect(inactiveOf(action, 'slack')).toEqual(['botToken'])
    const trigger = run(
      workflow([
        blockState(
          'b1',
          'slack',
          'Slack',
          { botToken: 't', signingSecret: 's' },
          { triggerMode: true }
        ),
      ])
    )
    expect(inactiveOf(trigger, 'slack')).toEqual([])
  })

  it('marks action fields inactive on a trigger-mode block', () => {
    const result = run(
      workflow([
        blockState(
          'b1',
          'slack',
          'Slack',
          { operation: 'send', botToken: 't' },
          { triggerMode: true }
        ),
      ])
    )
    expect(inactiveOf(result, 'slack')).toEqual(['operation'])
  })

  it('counts a duplicated id active when any surface declaration serializes', () => {
    const action = run(
      workflow([blockState('b1', 'slack', 'Slack', { operation: 'send', signingSecret: 's' })])
    )
    expect(inactiveOf(action, 'slack')).toEqual(['signingSecret'])
  })

  it('keeps a trigger field active in trigger mode when it shares a canonical id with an action pair', () => {
    const trigger = run(
      workflow([
        blockState(
          'b1',
          'gmail',
          'Gmail',
          { triggerCredentials: 'cred-1', labelIds: 'INBOX' },
          { triggerMode: true }
        ),
      ])
    )
    expect(inactiveOf(trigger, 'gmail')).toEqual([])
    const action = run(
      workflow([
        blockState('b1', 'gmail', 'Gmail', {
          operation: 'send_gmail',
          credential: 'cred-1',
          triggerCredentials: 'cred-1',
        }),
      ])
    )
    expect(inactiveOf(action, 'gmail')).toEqual(['triggerCredentials'])
  })

  it('keeps every field of a trigger-category block active in and out of trigger mode', () => {
    for (const triggerMode of [false, true]) {
      const result = run(
        workflow([
          blockState(
            'b1',
            'generic_webhook',
            'Webhook',
            { requireAuth: true, token: 't' },
            { triggerMode }
          ),
        ])
      )
      expect(inactiveOf(result, 'webhook')).toEqual([])
    }
  })

  it('marks tool-input-only and undeclared fields inactive, except on schema-agnostic custom blocks', () => {
    const result = run(
      workflow([
        blockState('b1', 'slack', 'Slack', { operation: 'send', scopeNote: 'x', legacyField: 'y' }),
        blockState('b2', 'custom_block_acme', 'Acme', { undeclared: 'z', workflowId: 'wf' }),
        blockState('b3', 'custom_block_legacy', 'Legacy', { undeclared: 'z', workflowId: 'wf' }),
      ])
    )
    expect(inactiveOf(result, 'slack')).toEqual(['scopeNote', 'legacyField'])
    expect(inactiveOf(result, 'acme')).toEqual(['undeclared', 'workflowId'])
    expect(inactiveOf(result, 'legacy')).toEqual(['workflowId'])
  })
})

describe('canonicalize: tools', () => {
  const tools = [
    {
      type: 'table',
      title: 'Leads',
      params: { tableId: 'tbl-1', manualTableId: '', limit: '10', includeMeta: 'true' },
      isExpanded: true,
    },
    { type: 'table', toolId: 'table_query', params: { manualTableId: 'tbl-2' } },
    {
      type: 'custom-tool',
      customToolId: 'ct-1',
      schema: { name: 'x' },
      code: 'return 1',
      usageControl: 'force',
      futureKey: 1,
    },
  ]

  it('lifts index-scoped modes over legacy type-scoped ones, independently per tool', () => {
    const result = run(
      workflow([
        blockState(
          'b1',
          'agent',
          'Agent',
          { tools },
          {
            data: { canonicalModes: { 'table:tableId': 'advanced', '0:tableId': 'basic' } },
          }
        ),
      ])
    )
    const param = onlyBlock(result, 'agent').params.tools
    expect(param?.kind).toBe('tools')
    if (param?.kind !== 'tools') return
    expect(param.tools[0].modes).toEqual({ tableId: 'basic' })
    expect(param.tools[1].modes).toEqual({ tableId: 'advanced' })
  })

  it('decodes params by sub-block shape, drops isExpanded and keeps unknown keys', () => {
    const result = run(
      workflow([blockState('b1', 'agent', 'Agent', { tools: JSON.stringify(tools) })])
    )
    const param = onlyBlock(result, 'agent').params.tools
    if (param?.kind !== 'tools') throw new Error('expected tools')
    expect(param.tools[0]).toEqual({
      type: 'table',
      title: 'Leads',
      params: {
        tableId: { $sim: 'unresolved', kind: 'table', id: 'tbl-1' },
        manualTableId: '',
        limit: '10',
        includeMeta: true,
      },
      modes: { tableId: 'basic' },
    })
    expect(param.tools[2]).toEqual({
      type: 'custom-tool',
      params: {},
      modes: {},
      usageControl: 'force',
      customTool: {
        ref: { $sim: 'unresolved', kind: 'custom-tool', id: 'ct-1' },
        snapshot: { schema: { name: 'x' }, code: 'return 1' },
      },
      extra: { futureKey: 1 },
    })
  })

  it('keeps a list with an untyped entry verbatim as a value', () => {
    const result = run(
      workflow([blockState('b1', 'agent', 'Agent', { tools: [{ title: 'no type' }] })])
    )
    expect(onlyBlock(result, 'agent').params.tools).toEqual({
      kind: 'value',
      value: [{ title: 'no type' }],
    })
  })
})

describe('canonicalize: branches', () => {
  const conditionRows = (id: string) => [
    {
      id: `${id}-if`,
      title: 'if',
      value: '<start.x> > 1',
      showTags: false,
      searchTerm: '',
      cursorPosition: 3,
    },
    {
      id: `${id}-else-if-1700000000000`,
      title: 'else if',
      value: 'true',
      activeSourceBlockId: null,
    },
    { id: `${id}-else-if-1700000000001`, title: 'else if', value: 'false' },
    { id: `${id}-else`, title: 'else', value: '' },
  ]

  it('names rows by position with copilot-style keys and strips UI state', () => {
    const result = run(
      workflow([
        blockState('c1', 'condition', 'Cond', { conditions: JSON.stringify(conditionRows('c1')) }),
      ])
    )
    const cond = onlyBlock(result, 'cond')
    expect(cond.params.conditions).toBeUndefined()
    expect(cond.branches).toEqual({
      kind: 'condition',
      rows: [
        { key: 'if', value: '<start.x> > 1' },
        { key: 'elseIf0', value: 'true' },
        { key: 'elseIf1', value: 'false' },
        { key: 'else', value: '' },
      ],
    })
    expect(result.identity.blocks.cond.branches).toEqual({
      if: 'c1-if',
      elseIf0: 'c1-else-if-1700000000000',
      elseIf1: 'c1-else-if-1700000000001',
      else: 'c1-else',
    })
  })

  it('takes keys from the lock by row id first, then a persisted row key', () => {
    const rows = conditionRows('c1').map((row, index) =>
      index === 1 ? { ...row, key: 'isVip' } : row
    )
    const result = run(workflow([blockState('c1', 'condition', 'Cond', { conditions: rows })]), {
      lock: {
        blocks: { cond: { id: 'c1', parent: null, branches: { highValue: 'c1-if' } } },
      },
    })
    expect(onlyBlock(result, 'cond').branches?.rows?.map((row) => row.key)).toEqual([
      'highValue',
      'isVip',
      'elseIf1',
      'else',
    ])
  })

  it('keys rows the same whatever their id format', () => {
    const uuidRows = conditionRows('c1').map((row, index) => ({
      ...row,
      id: `00000000-0000-4000-8000-00000000000${index}`,
    }))
    const a = run(
      workflow([blockState('c1', 'condition', 'Cond', { conditions: conditionRows('c1') })])
    )
    const b = run(workflow([blockState('c1', 'condition', 'Cond', { conditions: uuidRows })]))
    expect(canonicalEquals(a.workflow, b.workflow)).toBe(true)
  })

  it('records a non-positional title as an override, and a missing title, with a warning', () => {
    const rows = [
      { id: 'a', title: 'if', value: 'x' },
      { id: 'b', title: 'Otherwise', value: '' },
      { id: 'c', value: '' },
    ]
    const result = run(workflow([blockState('c1', 'condition', 'Cond', { conditions: rows })]))
    expect(onlyBlock(result, 'cond').branches?.rows).toEqual([
      { key: 'if', value: 'x' },
      { key: 'elseIf0', value: '', titleOverride: 'Otherwise' },
      { key: 'else', value: '', titleMissing: true },
    ])
    expect(codes(result)).toContain('W_CANON_TITLE_OVERRIDE')
  })

  it('leaves a never-persisted list as rows: null, answering to the implicit ids', () => {
    const result = run(
      workflow(
        [
          blockState('c1', 'condition', 'Cond'),
          blockState('f1', 'function', 'A'),
          blockState('f2', 'function', 'B'),
        ],
        {
          edges: [
            { id: 'e1', source: 'c1', target: 'f1', sourceHandle: 'condition-c1-if' },
            { id: 'e2', source: 'c1', target: 'f2', sourceHandle: 'condition-c1-else' },
          ],
        }
      )
    )
    expect(onlyBlock(result, 'cond').branches).toEqual({ kind: 'condition', rows: null })
    expect(result.workflow.edges).toEqual([
      { from: 'cond', port: { kind: 'branch', key: 'else' }, to: 'b' },
      { from: 'cond', port: { kind: 'branch', key: 'if' }, to: 'a' },
    ])
  })

  it('names router rows route0..n and treats a stored "Route n" title as positional', () => {
    const result = run(
      workflow([
        blockState('r1', 'router_v2', 'Router', {
          routes: JSON.stringify([
            { id: 'r1-route1', title: 'Route 1', value: 'billing' },
            { id: 'r1-x', title: 'route-1700', value: 'support' },
          ]),
        }),
      ])
    )
    expect(onlyBlock(result, 'router').branches?.rows).toEqual([
      { key: 'route0', value: 'billing' },
      { key: 'route1', value: 'support', titleOverride: 'route-1700' },
    ])
    expect(codes(result)).not.toContain('W_CANON_TITLE_OVERRIDE')
  })

  it('keeps an unliftable branch value verbatim as a param', () => {
    const result = run(
      workflow([blockState('c1', 'condition', 'Cond', { conditions: '{not json' })])
    )
    const cond = onlyBlock(result, 'cond')
    expect(cond.params.conditions).toEqual({ kind: 'value', value: '{not json' })
    expect(cond.branches?.rows).toBeNull()
    expect(result.diagnostics.filter((d) => d.code === 'W_CANON_UNDECODABLE_JSON')).toHaveLength(1)
  })

  it('keeps a list whose rows share an id verbatim, so its lock parses', () => {
    const shared = [
      { id: 'r1', title: 'if', value: 'a' },
      { id: 'r1', title: 'else', value: '' },
    ]
    const derivedClash = [
      { id: 'c1-cond-1', title: 'if', value: 'a' },
      { title: 'else', value: '' },
    ]
    for (const rows of [shared, derivedClash]) {
      const stored = JSON.stringify(rows)
      const result = run(workflow([blockState('c1', 'condition', 'Cond', { conditions: stored })]))
      const cond = onlyBlock(result, 'cond')
      expect(cond.params.conditions).toEqual({ kind: 'value', value: stored })
      expect(cond.branches?.rows).toBeNull()
      expect(codes(result)).toContain('W_CANON_UNDECODABLE_JSON')
      expect(lockDiagnostics(result)).toBeUndefined()
    }
  })
})

describe('canonicalize: edges', () => {
  const blocks = [
    blockState('f1', 'function', 'A'),
    blockState('f2', 'function', 'B', {}, { errorEnabled: false }),
    blockState('f3', 'function', 'C'),
  ]

  it('heals side-anchored and empty handles, derives errorPort from an error edge, and sorts', () => {
    const result = run(
      workflow(blocks, {
        edges: [
          { id: 'e2', source: 'f2', target: 'f3', sourceHandle: 'error' },
          {
            id: 'e1',
            source: 'f1',
            target: 'f2',
            sourceHandle: 'source-right',
            targetHandle: 'target-left',
          },
          { id: 'e3', source: 'f1', target: 'f3', sourceHandle: '' },
          { id: 'e4', source: 'f1', target: 'f3', sourceHandle: null },
        ],
      })
    )
    expect(result.workflow.edges).toEqual([
      { from: 'a', port: { kind: 'out' }, to: 'b' },
      { from: 'a', port: { kind: 'out' }, to: 'c' },
      { from: 'b', port: { kind: 'error' }, to: 'c' },
    ])
    expect(onlyBlock(result, 'b').errorPort).toBe(true)
    expect(onlyBlock(result, 'a').errorPort).toBe(false)
  })

  it('keeps unknown handles as raw ports, drops dangling edges and reports scope violations', () => {
    const result = run(
      workflow(
        [
          ...blocks,
          blockState('l1', 'loop', 'Loop 1', {}, { data: { loopType: 'for', count: 3 } }),
          blockState(
            'in',
            'function',
            'Inside',
            {},
            { data: { parentId: 'l1', extent: 'parent' } }
          ),
        ],
        {
          edges: [
            { id: 'e1', source: 'f1', target: 'f2', sourceHandle: 'legacy-handle' },
            { id: 'e2', source: 'f1', target: 'ghost' },
            { id: 'e3', source: 'f1', target: 'in' },
            { id: 'e4', source: 'l1', target: 'in', sourceHandle: 'loop-start-source' },
            { id: 'e5', source: 'l1', target: 'f3', sourceHandle: 'loop-end-source' },
          ],
        }
      )
    )
    expect(result.workflow.edges).toContainEqual({
      from: 'a',
      port: { kind: 'raw', handle: 'legacy-handle' },
      to: 'b',
    })
    expect(result.workflow.edges).toContainEqual({
      from: 'loop1',
      port: { kind: 'subflowStart' },
      to: 'inside',
    })
    expect(result.workflow.edges).toContainEqual({
      from: 'loop1',
      port: { kind: 'subflowEnd' },
      to: 'c',
    })
    expect(codes(result)).toEqual(
      expect.arrayContaining(['W_CANON_RAW_HANDLE', 'W_CANON_DANGLING_EDGE', 'E_CANON_EDGE_SCOPE'])
    )
    expect(result.workflow.edges.some((edge) => edge.to === 'ghost')).toBe(false)
  })

  it('reports a duplicated stored edge once', () => {
    const result = run(
      workflow(
        [
          ...blocks,
          blockState('l1', 'loop', 'Loop 1', {}, { data: { loopType: 'for', count: 3 } }),
          blockState('in', 'function', 'In', {}, { data: { parentId: 'l1', extent: 'parent' } }),
        ],
        {
          edges: [
            { id: 'e1', source: 'f1', target: 'in', sourceHandle: 'legacy-handle' },
            { id: 'e2', source: 'f1', target: 'in', sourceHandle: 'legacy-handle' },
          ],
        }
      )
    )
    expect(result.workflow.edges).toHaveLength(1)
    expect(codes(result).filter((code) => code === 'W_CANON_RAW_HANDLE')).toHaveLength(1)
    expect(codes(result).filter((code) => code === 'E_CANON_EDGE_SCOPE')).toHaveLength(1)
  })
})

describe('canonicalize: subflows', () => {
  it('reads block.data first, fills from the loops map, and keeps a raw 0 count with a warning', () => {
    const result = run(
      workflow(
        [
          blockState(
            'l1',
            'loop',
            'Each',
            {},
            { data: { loopType: 'forEach', count: 0, collection: '<start.items>' } }
          ),
        ],
        {
          loops: {
            l1: {
              id: 'l1',
              nodes: [],
              iterations: 9,
              loopType: 'for',
              whileCondition: 'w',
              enabled: true,
            },
          },
        }
      )
    )
    expect(onlyBlock(result, 'each').subflow).toEqual({
      kind: 'loop',
      loopType: 'forEach',
      iterations: 0,
      forEachItems: '<start.items>',
      whileCondition: 'w',
    })
    expect(codes(result)).toContain('W_CANON_SUBFLOW_REPAIRED')
  })

  it('reports an invalid stored loop type as the runtime reads it, never from the loops map', () => {
    const cases = [
      { loopType: '', message: 'the runtime runs "for"' },
      { loopType: 'bogus', message: 'the runtime fails with "Unknown loop type"' },
    ]
    for (const { loopType, message } of cases) {
      const result = run(
        workflow(
          [
            blockState(
              'l1',
              'loop',
              'Each',
              {},
              { data: { loopType, count: 2 } as BlockState['data'] }
            ),
          ],
          {
            loops: {
              l1: { id: 'l1', nodes: [], iterations: 2, loopType: 'forEach', enabled: true },
            },
          }
        )
      )
      const each = onlyBlock(result, 'each')
      expect(each.subflow).toMatchObject({ kind: 'loop', loopType: 'for' })
      expect(Object.getOwnPropertyDescriptor(each.extra ?? {}, 'loopType')?.value).toBe(loopType)
      const repaired = result.diagnostics.filter((d) => d.code === 'W_CANON_SUBFLOW_REPAIRED')
      expect(repaired).toHaveLength(1)
      expect(repaired[0].message).toContain(message)
    }
  })

  it('takes the count that runs, not a count only the loops map holds', () => {
    const result = run(
      workflow([blockState('l1', 'loop', 'Each', {}, { data: { loopType: 'for' } })], {
        loops: {
          l1: { id: 'l1', nodes: [], iterations: 9, loopType: 'for', enabled: true },
        },
      })
    )
    expect(onlyBlock(result, 'each').subflow).toEqual({
      kind: 'loop',
      loopType: 'for',
      iterations: 5,
    })
  })

  it('keeps an unknown parallel type under extra and reports it', () => {
    const result = run(
      workflow([
        blockState(
          'p1',
          'parallel',
          'Fan',
          {},
          { data: { parallelType: 'weird' as never, count: 3, batchSize: 50 } }
        ),
      ])
    )
    const fan = onlyBlock(result, 'fan')
    expect(fan.subflow).toEqual({ kind: 'parallel', count: 3, batchSize: 50 })
    expect(fan.extra).toEqual({ parallelType: 'weird' })
    expect(result.diagnostics.filter((d) => d.code === 'W_CANON_SUBFLOW_REPAIRED')).toHaveLength(2)
  })

  it('takes the parent from data.parentId, and keeps a dangling parent under extra', () => {
    const result = run(
      workflow([
        blockState('l1', 'loop', 'Each', {}, { data: { loopType: 'for', count: 2 } }),
        blockState('a', 'function', 'In', {}, { data: { parentId: 'l1', extent: 'parent' } }),
        blockState('b', 'function', 'Lost', {}, { data: { parentId: 'gone' } }),
      ])
    )
    expect(onlyBlock(result, 'in').parent).toBe('each')
    expect(onlyBlock(result, 'in').extra).toBeUndefined()
    expect(onlyBlock(result, 'lost').parent).toBeNull()
    expect(onlyBlock(result, 'lost').extra).toEqual({ parentId: 'gone' })
    expect(codes(result)).toContain('W_CANON_DANGLING_PARENT')
  })
})

describe('canonicalize: block fields', () => {
  it('carries locked, triggerMode and advancedMode, raw retry, and unknown data under extra', () => {
    const result = run(
      workflow([
        blockState(
          'b1',
          'function',
          'Code',
          {},
          {
            locked: true,
            retry: { enabled: false, maxTries: 4, waitBetweenTriesMs: 10 },
            data: { width: 100, someFutureFlag: 'x' } as BlockState['data'],
            layout: { measuredWidth: 3 },
            position: { x: 5, y: 6 },
          }
        ),
      ])
    )
    const code = onlyBlock(result, 'code')
    expect(code.locked).toBe(true)
    expect(code.retry).toEqual({ enabled: false, maxTries: 4, waitBetweenTriesMs: 10 })
    expect(code.extra).toEqual({ someFutureFlag: 'x' })
    expect(result.layout.code).toEqual({ x: 5, y: 6, w: 100 })
  })

  it('pins an out-of-range retry the way the loader does, so it reads the same before and after a load', () => {
    const result = run(
      workflow([
        blockState(
          'b1',
          'function',
          'Code',
          {},
          {
            retry: { enabled: true, maxTries: 10, waitBetweenTriesMs: 60000 },
          }
        ),
      ])
    )
    expect(onlyBlock(result, 'code').retry).toEqual({
      enabled: true,
      maxTries: 5,
      waitBetweenTriesMs: 5000,
    })
  })
})

/*
 * Idempotence (the input side of O3): stored encodings that execute identically canonicalize to
 * equal models. A seeded generator builds random workflows, then re-encodes each one in ways the
 * canvas, the edit engine and jsonb produce, and every re-encoding must compare and hash equal.
 */
/** A runtime global (Node 17+, browsers); this package type-checks with `types: []`. */
declare function structuredClone<T>(value: T): T

function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffleKeys(value: unknown, random: () => number): unknown {
  if (Array.isArray(value)) return value.map((item) => shuffleKeys(item, random))
  if (value === null || typeof value !== 'object') return value
  const entries = Object.entries(value).map(
    ([key, member]) => [key, shuffleKeys(member, random)] as const
  )
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[entries[i], entries[j]] = [entries[j], entries[i]]
  }
  return Object.fromEntries(entries)
}

function randomWorkflow(random: () => number): WorkflowState {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]
  const rowCount = 1 + Math.floor(random() * 4)
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    id: `c-${index}-${Math.floor(random() * 1000)}`,
    title: index === 0 ? 'if' : index === rowCount - 1 ? 'else' : 'else if',
    value: pick(['', 'x > 1', '<start.a> === 2']),
  }))
  const blocks = [
    blockState('s', 'start_trigger', 'Start', {
      inputFormat: [{ id: 'f1', name: pick(['a', 'b']), type: 'string' }],
    }),
    blockState('c', 'condition', 'Cond', { conditions: JSON.stringify(rows) }),
    blockState(
      'sl',
      'slack',
      'Slack',
      {
        operation: pick(['send', 'read']),
        text: pick(['hi', '']),
        [pick(['channel', 'manualChannel'])]: 'C1',
      },
      {
        data:
          random() < 0.5
            ? { canonicalModes: { channel: pick(['basic', 'advanced'] as const) } }
            : {},
      }
    ),
    blockState(
      'ag',
      'agent',
      'Agent',
      {
        tools: [
          { type: 'table', params: { tableId: 't', limit: pick(['5', '']) } },
          { type: 'table', params: { manualTableId: 'm' } },
        ],
      },
      {
        data: {
          canonicalModes: { [`${pick([0, 1])}:tableId`]: pick(['basic', 'advanced'] as const) },
        },
      }
    ),
    blockState('api', 'api', 'API', {
      headers: [{ id: 'h', cells: { Key: 'k', Value: pick(['v', 'w']) } }],
    }),
  ]
  return workflow(blocks, {
    edges: [
      { id: 'e1', source: 's', target: 'c', sourceHandle: 'source' },
      { id: 'e2', source: 'c', target: 'sl', sourceHandle: `condition-${rows[0].id}` },
      { id: 'e3', source: 'sl', target: 'ag', sourceHandle: 'error' },
      { id: 'e4', source: 'ag', target: 'api', sourceHandle: null },
    ],
  })
}

type Reencoding = (state: WorkflowState, random: () => number) => WorkflowState

const REENCODINGS: Record<string, Reencoding> = {
  'jsonb key order': (state, random) => shuffleKeys(state, random) as WorkflowState,
  'JSON text with whitespace vs native arrays': (state) => {
    const next = structuredClone(state)
    const conditions = next.blocks.c.subBlocks.conditions
    conditions.value = JSON.stringify(JSON.parse(String(conditions.value)), null, 2)
    const tools = next.blocks.ag.subBlocks.tools
    tools.value = ` ${JSON.stringify(tools.value)} ` as never
    return next
  },
  'condition UI junk': (state) => {
    const next = structuredClone(state)
    const conditions = next.blocks.c.subBlocks.conditions
    const rows = JSON.parse(String(conditions.value)) as Array<Record<string, unknown>>
    conditions.value = JSON.stringify(
      rows.map((row) => ({
        ...row,
        showTags: true,
        showEnvVars: false,
        searchTerm: 'q',
        cursorPosition: 4,
        activeSourceBlockId: 'x',
      }))
    )
    return next
  },
  'legacy type-scoped tool modes': (state) => {
    // `${i}:tableId` alone equals the legacy `table:tableId` baseline (which reaches both table
    // tools) plus an index key pinning the other tool to the mode it inferred before: tool 0
    // holds the basic member, tool 1 the advanced one.
    const next = structuredClone(state)
    const data = next.blocks.ag.data ?? {}
    const [[indexKey, mode]] = Object.entries(data.canonicalModes ?? {})
    const other = indexKey.startsWith('0:') ? 1 : 0
    next.blocks.ag.data = {
      ...data,
      canonicalModes: {
        'table:tableId': mode,
        [`${other}:tableId`]: other === 0 ? 'basic' : 'advanced',
      },
    }
    return next
  },
  'editor-only tool and field state': (state) => {
    const next = structuredClone(state)
    const tools = next.blocks.ag.subBlocks.tools.value as unknown as Array<Record<string, unknown>>
    next.blocks.ag.subBlocks.tools.value = tools.map((tool) => ({
      ...tool,
      isExpanded: true,
    })) as never
    const fields = next.blocks.s.subBlocks.inputFormat.value as unknown as Array<
      Record<string, unknown>
    >
    next.blocks.s.subBlocks.inputFormat.value = fields.map((field) => ({
      ...field,
      collapsed: true,
    })) as never
    const headers = next.blocks.api.subBlocks.headers.value as unknown as unknown[]
    next.blocks.api.subBlocks.headers.value = [
      ...headers,
      { id: 'starter', cells: { Key: '', Value: '' } },
    ] as never
    return next
  },
  'side-anchored and empty handles': (state) => {
    const next = structuredClone(state)
    next.edges = next.edges.map((edge: WorkflowState['edges'][number]) =>
      edge.sourceHandle === 'source'
        ? { ...edge, sourceHandle: 'source-right' }
        : edge.sourceHandle === null
          ? { ...edge, sourceHandle: '' }
          : edge
    )
    return next
  },
  'synthetic mirrors and runtime ids': (state) => {
    const next = structuredClone(state)
    next.blocks.ag.subBlocks['tools-tool-0-limit'] = {
      id: 'tools-tool-0-limit',
      type: 'short-input',
      value: '5',
    }
    next.blocks.s.subBlocks.triggerPath = { id: 'triggerPath', type: 'short-input', value: 's' }
    return next
  },
  'stored subBlock type drift': (state) => {
    const next = structuredClone(state)
    next.blocks.sl.subBlocks.operation = { ...next.blocks.sl.subBlocks.operation, type: 'combobox' }
    return next
  },
}

describe('canonicalize: equivalent encodings give equal models (idempotence)', () => {
  for (const [name, reencode] of Object.entries(REENCODINGS)) {
    it(name, () => {
      for (let seed = 1; seed <= 40; seed++) {
        const random = mulberry32(seed)
        const state = randomWorkflow(random)
        const base = run(state).workflow
        const other = run(reencode(state, random)).workflow
        expect(canonicalEquals(base, other), `seed ${seed}`).toBe(true)
        expect(canonicalHash(other)).toBe(canonicalHash(base))
      }
    })
  }

  it('is deterministic and never mutates its input', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const state = randomWorkflow(mulberry32(seed))
      const snapshot = structuredClone(state)
      const first = run(state)
      const second = run(state)
      expect(state).toEqual(snapshot)
      expect(second).toEqual(first)
    }
  })

  it('distinguishes a semantic change from a re-encoding', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const state = randomWorkflow(mulberry32(seed))
      const changed = structuredClone(state)
      changed.blocks.api.subBlocks.url = { id: 'url', type: 'short-input', value: 'https://x' }
      const a: CanonicalWorkflow = run(state).workflow
      const b: CanonicalWorkflow = run(changed).workflow
      expect(canonicalEquals(a, b)).toBe(false)
      expect(canonicalHash(a)).not.toBe(canonicalHash(b))
    }
  })
})
