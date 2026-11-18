/**
 * The printer golden cases: hand-built canonical workflows, one per printer construct, over the
 * real catalog narrowed to the block types they use. The goldens they print live in
 * `packages/workflow-code/src/print/__golden__/`, next to the printer. Each case names the behavior
 * it pins so a golden diff points at the construct that changed.
 */

import {
  type AnchorKey,
  type BlockCatalog,
  type CanonicalBlock,
  type CanonicalEdge,
  type CanonicalParam,
  type CanonicalTool,
  type CanonicalVariable,
  type CanonicalWorkflow,
  type CatalogBlock,
  type CatalogBuilder,
  type CatalogTrigger,
  type CodeComment,
  catalogBlock,
  catalogBuilder,
  catalogBuilderPaths,
  catalogTrigger,
  compactBlockCatalog,
  encodeAnchor,
  type Port,
  type SourceHints,
  sha256Hex,
  stableStringify,
  toolModes,
  type Value,
} from '@sim/workflow-code'
import { editorDefaults } from '@sim/workflow-code/catalog/defaults'
import { normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'
import { registryCatalog } from '@/lib/workflows/code/catalog/registry-catalog.test-helpers'

/** Every registry block type a golden case uses. */
const GOLDEN_CATALOG_TYPES = [
  'agent',
  'api',
  'condition',
  'function',
  'generic_webhook',
  'gmail_v2',
  'mcp',
  'note',
  'response',
  'router_v2',
  'slack_v2',
  'start_trigger',
  'table_v2',
  'variables',
  'workflow_input',
]

/**
 * The live registry catalog narrowed to the golden types: their blocks, the builders that create
 * them, and the triggers they deploy as (a trigger block is its own trigger), compacted like the
 * served core shard and hashed the same way. Narrowing keeps a registry change to an unrelated
 * block from churning the goldens.
 */
function narrowedCatalog(): BlockCatalog {
  const blocks: Record<string, CatalogBlock> = {}
  for (const type of GOLDEN_CATALOG_TYPES) {
    const block = catalogBlock(registryCatalog, type)
    if (!block) throw new Error(`${type} is not in the registry catalog`)
    blocks[type] = block
  }
  const triggers: Record<string, CatalogTrigger> = {}
  const triggerIds = Object.values(blocks).flatMap((block) => [
    block.type,
    ...(block.triggers?.available ?? []),
  ])
  for (const id of triggerIds) {
    const trigger = catalogTrigger(registryCatalog, id)
    if (trigger) triggers[id] = trigger
  }
  const builders: Record<string, CatalogBuilder> = {}
  for (const builderPath of catalogBuilderPaths(registryCatalog)) {
    const builder = catalogBuilder(registryCatalog, builderPath)
    if (builder && Object.hasOwn(blocks, builder.type)) builders[builderPath] = builder
  }
  const core = compactBlockCatalog({
    catalogVersion: registryCatalog.catalogVersion,
    sdkMajor: registryCatalog.sdkMajor,
    blocks,
    triggers,
    builders,
  })
  return { ...core, hash: sha256Hex(stableStringify(core)) }
}

export const goldenCatalog: BlockCatalog = narrowedCatalog()

interface PrintCase {
  name: string
  workflow: CanonicalWorkflow
  hints?: SourceHints
}

type BlockInit = Partial<Omit<CanonicalBlock, 'params' | 'name' | 'type' | 'key'>> & {
  params?: Record<string, Value>
  tools?: Record<string, CanonicalTool[]>
}

/**
 * A block as canvas creation leaves it, then edited: every editor default of its real catalog type
 * (`editorDefaults`) is seeded first, as `createBlockFromParams` seeds them, and `params` override.
 * A case that needs a field stored-absent writes it as `null`.
 */
function blk(name: string, type: string, init: BlockInit = {}): CanonicalBlock {
  const { params = {}, tools = {}, ...rest } = init
  const canonicalParams: Record<string, CanonicalParam> = {}
  const declared = catalogBlock(goldenCatalog, type)
  for (const [id, value] of declared ? editorDefaults(declared) : []) {
    canonicalParams[id] = { kind: 'value', value }
  }
  for (const [id, value] of Object.entries(params)) {
    if (value === null) delete canonicalParams[id]
    else canonicalParams[id] = { kind: 'value', value }
  }
  for (const [id, list] of Object.entries(tools))
    canonicalParams[id] = { kind: 'tools', tools: list }
  return {
    key: normalizeWorkflowBlockName(name),
    name,
    type,
    parent: null,
    enabled: true,
    locked: false,
    triggerMode: false,
    advancedMode: false,
    errorPort: false,
    retry: null,
    params: canonicalParams,
    modes: {},
    ...rest,
  }
}

function edge(from: string, to: string, port: Port = { kind: 'out' }): CanonicalEdge {
  return { from, port, to }
}

interface WorkflowInit {
  name?: string
  description?: string | null
  blocks: CanonicalBlock[]
  edges?: CanonicalEdge[]
  variables?: CanonicalVariable[]
  comments?: Array<[AnchorKey, CodeComment[]]>
}

function wf(init: WorkflowInit): CanonicalWorkflow {
  return {
    modelVersion: 1,
    meta: { name: init.name ?? 'Fixture', description: init.description ?? null },
    blocks: Object.fromEntries(init.blocks.map((block) => [block.key, block])),
    edges: init.edges ?? [],
    variables: Object.fromEntries(
      (init.variables ?? []).map((variable) => [variable.key, variable])
    ),
    annotations: {
      comments: Object.fromEntries(init.comments ?? []),
    },
  }
}

const line = (text: string, placement: 'leading' | 'trailing' = 'leading'): CodeComment => ({
  text: ` ${text}`,
  kind: 'line',
  placement,
})

const start = (name = 'Start', inputFormat: Value = []) =>
  blk(name, 'start_trigger', { params: { inputFormat } })

export const cases: PrintCase[] = [
  {
    name: 'minimal-trigger',
    workflow: wf({ name: 'Hello', blocks: [start()] }),
  },
  {
    name: 'support-triage',
    workflow: wf({
      name: 'Support triage',
      description: 'Classifies inbound tickets and routes them.',
      variables: [{ key: 'escalations', name: 'escalations', type: 'number', value: 0 }],
      blocks: [
        blk('Ticket in', 'generic_webhook', {
          params: {
            requireAuth: true,
            token: '{{TICKETS_WEBHOOK_TOKEN}}',
            inputFormat: [
              { name: 'subject', type: 'string', value: '' },
              { name: 'body', type: 'string', value: '' },
            ],
          },
        }),
        blk('Classify', 'agent', {
          params: {
            model: 'claude-sonnet-5-5',
            messages: [
              { role: 'system', content: 'Classify support tickets.' },
              { role: 'user', content: '<ticketin.subject>\n\n<ticketin.body>' },
            ],
            temperature: 0.2,
          },
        }),
        blk('By category', 'condition', {
          branches: {
            kind: 'condition',
            rows: [
              { key: 'billing', value: "<classify.content> === 'billing'" },
              {
                key: 'urgent',
                value: '<classify.content>.includes("urgent") && <variable.escalations> < 3',
              },
              { key: 'else', value: '' },
            ],
          },
        }),
        blk('Log ticket', 'table_v2', {
          params: {
            operation: 'insert_row',
            tableSelector: { $sim: 'resource', kind: 'table', key: 'tickets' },
            data: '{\n  "subject": "<ticketin.subject>"\n}',
          },
          modes: { tableId: 'basic' },

          errorPort: true,
        }),
        blk('Notify', 'slack_v2', {
          params: {
            operation: 'send',
            credential: { $sim: 'resource', kind: 'credential', key: 'support-slack' },
            channel: 'C0SUPPORT',
            text: 'New <classify.content> ticket: <ticketin.subject>',
          },
          modes: { channel: 'basic', oauthCredential: 'basic' },
          errorPort: true,
        }),
        blk('Reply', 'response', {
          params: {
            dataMode: 'json',
            data: '{\n  "ok": true,\n  "category": "<classify.content>"\n}',
          },
        }),
      ],
      edges: [
        edge('bycategory', 'logticket', { kind: 'branch', key: 'billing' }),
        edge('bycategory', 'notify', { kind: 'branch', key: 'urgent' }),
        edge('bycategory', 'reply', { kind: 'branch', key: 'else' }),
        edge('classify', 'bycategory'),
        edge('logticket', 'notify'),
        edge('logticket', 'notify', { kind: 'error' }),
        edge('notify', 'reply'),
        edge('ticketin', 'classify'),
      ],
    }),
  },
  {
    name: 'string-escapes',
    workflow: wf({
      blocks: [
        start(),
        blk('Escapes', 'agent', {
          params: {
            model: "it's a \"model\" with 'quotes'",
            systemPrompt:
              'back\\slash `tick` $\u007bnotInterp} tab\there\r\ncrlf line\u2028ls\u2029ps 漢字 🎉 rtl\u202Eoverride zero\u200Bwidth iso\u2066late',
            messages: [{ role: 'user', content: "single 'quote' only" }],
          },
        }),
      ],
    }),
  },
  {
    name: 'templates-and-paths',
    workflow: wf({
      blocks: [
        start('Start', [
          { name: 'items', type: 'array', value: '' },
          { name: 'some-field', type: 'string', value: '' },
          { name: 'a', type: 'object', value: '' },
        ]),
        blk('Writer', 'agent', {
          params: {
            model: 'gpt-5.5',
            systemPrompt: 'Line one\nLine two without refs',
            messages: [
              {
                role: 'user',
                content:
                  'Items: <start.items[0].id> / <start.items.0> / <start.some-field> / <start.a.b>\nnext',
              },
            ],
            conversationId: '<start.conversationId>',
          },
        }),
      ],
      edges: [edge('start', 'writer')],
    }),
  },
  {
    name: 'unresolved-tokens',
    workflow: wf({
      blocks: [
        start(),
        blk('Html', 'agent', {
          params: {
            model: '{{ not valid }}',
            systemPrompt:
              '<div>hello</div> <missing.field> {{lower_ok}} <variable.nope> <loop.index>',
          },
        }),
      ],
      edges: [edge('start', 'html')],
    }),
  },
  {
    name: 'ref-cycle-literalized',
    workflow: wf({
      blocks: [
        start(),
        blk('Alpha', 'agent', {
          params: { model: 'm', messages: [{ role: 'system', content: 'See <beta.content>' }] },
        }),
        blk('Beta', 'agent', {
          params: { model: 'm', messages: [{ role: 'system', content: 'See <alpha.content>' }] },
        }),
        blk('Self', 'agent', {
          params: { model: 'm', messages: [{ role: 'system', content: 'Me: <self.content>' }] },
        }),
      ],
      edges: [edge('start', 'alpha'), edge('alpha', 'beta')],
    }),
  },
  {
    name: 'loop-foreach',
    workflow: wf({
      blocks: [
        start('Start', [{ name: 'leads', type: 'array', value: '' }]),
        blk('Each lead', 'loop', {
          subflow: {
            kind: 'loop',
            loopType: 'forEach',
            iterations: 5,
            forEachItems: '<start.leads>',
          },
        }),
        blk('Lookup', 'api', {
          parent: 'eachlead',
          params: {
            url: 'https://crm.example.com/c/<loop.currentItem.email>?i=<loop.index>',
            method: 'GET',
          },
        }),
        blk('Score', 'function', {
          parent: 'eachlead',
          params: { language: 'javascript', code: 'return <lookup.data>.score * 2' },
        }),
        blk('Summary', 'agent', {
          params: {
            model: 'm',
            messages: [
              { role: 'system', content: 'Results: <eachlead.results> and <score.result>' },
            ],
          },
        }),
      ],
      edges: [
        edge('eachlead', 'lookup', { kind: 'subflowStart' }),
        edge('eachlead', 'summary', { kind: 'subflowEnd' }),
        edge('lookup', 'score'),
        edge('start', 'eachlead'),
      ],
    }),
  },
  {
    name: 'nested-subflows',
    workflow: wf({
      blocks: [
        start('Start', [{ name: 'rows', type: 'array', value: '' }]),
        blk('Outer', 'loop', {
          subflow: { kind: 'loop', loopType: 'for', iterations: 3 },
        }),
        blk('Fan', 'parallel', {
          parent: 'outer',
          subflow: {
            kind: 'parallel',
            parallelType: 'collection',
            distribution: '<start.rows>',
            batchSize: 5,
          },
        }),
        blk('Work', 'agent', {
          parent: 'fan',
          params: {
            model: 'm',
            messages: [
              {
                role: 'system',
                content:
                  'loop <loop.index> parallel <parallel.currentItem> named <outer.index> fan <fan.index>',
              },
            ],
          },
        }),
        blk('Sibling', 'loop', {
          subflow: {
            kind: 'loop',
            loopType: 'while',
            iterations: 5,
            whileCondition: '<loop.index> < 3',
            doWhileCondition: '',
          },
        }),
        blk('Inside sibling', 'agent', {
          parent: 'sibling',
          params: {
            model: 'm',
            messages: [{ role: 'system', content: 'cannot see <work.content>' }],
          },
        }),
      ],
      edges: [
        edge('fan', 'work', { kind: 'subflowStart' }),
        edge('outer', 'fan', { kind: 'subflowStart' }),
        edge('outer', 'sibling', { kind: 'subflowEnd' }),
        edge('sibling', 'insidesibling', { kind: 'subflowStart' }),
        edge('start', 'outer'),
      ],
    }),
  },
  {
    name: 'parallel-untyped',
    workflow: wf({
      blocks: [
        start(),
        blk('Batch', 'parallel', { subflow: { kind: 'parallel', count: 4 } }),
        blk('Ping', 'api', { parent: 'batch', params: { url: 'https://x.test/<parallel.index>' } }),
      ],
      edges: [edge('batch', 'ping', { kind: 'subflowStart' }), edge('start', 'batch')],
    }),
  },
  {
    name: 'branches-null-rows',
    workflow: wf({
      blocks: [
        start(),
        blk('Gate', 'condition', { branches: { kind: 'condition', rows: null } }),
        blk('Pick', 'router_v2', {
          params: { context: 'ctx', model: 'm' },
          branches: { kind: 'router', rows: null },
        }),
        blk('Yes', 'response', { params: { dataMode: 'structured' } }),
      ],
      edges: [
        edge('gate', 'pick', { kind: 'branch', key: 'if' }),
        edge('pick', 'yes', { kind: 'branch', key: 'route0' }),
        edge('start', 'gate'),
      ],
    }),
  },
  {
    name: 'branch-titles-and-extra',
    workflow: wf({
      blocks: [
        start('Start', [{ name: 'amount', type: 'number', value: '' }]),
        blk('Check', 'condition', {
          branches: {
            kind: 'condition',
            rows: [
              { key: 'big', value: '<start.amount> > 100', titleOverride: 'Large amount' },
              { key: 'elseIf0', value: '', extra: { legacyFlag: true } },
              { key: 'else', value: 'true' },
            ],
          },
        }),
        blk('Done', 'response', {}),
      ],
      edges: [
        edge('check', 'done', { kind: 'branch', key: 'big' }),
        edge('check', 'done', { kind: 'branch', key: 'else' }),
        edge('check', 'done', { kind: 'branch', key: 'elseIf0' }),
        edge('start', 'check'),
      ],
    }),
  },
  {
    name: 'router-routes',
    workflow: wf({
      blocks: [
        start('Start', [
          { name: 'amount', type: 'number', value: '' },
          { name: 'reason', type: 'string', value: '' },
        ]),
        blk('Triage', 'router_v2', {
          params: { context: '<start.amount> for <start.reason>', model: 'claude-sonnet-5-5' },
          branches: {
            kind: 'router',
            rows: [
              { key: 'small', value: 'Under $100, auto-approve' },
              { key: 'review', value: 'Needs a manager' },
            ],
          },
        }),
        blk('Approve', 'response', {}),
        blk('Escalate', 'response', {}),
      ],
      edges: [
        edge('start', 'triage'),
        edge('triage', 'approve', { kind: 'branch', key: 'small' }),
        edge('triage', 'escalate', { kind: 'branch', key: 'review' }),
      ],
    }),
  },
  {
    name: 'pair-modes',
    workflow: wf({
      blocks: [
        start('Start', [{ name: 'channel', type: 'string', value: '' }]),
        blk('Picked basic', 'slack_v2', {
          params: { operation: 'send', channel: 'C0ONE', text: 'a' },
          modes: { channel: 'basic' },
        }),
        blk('Manual advanced', 'slack_v2', {
          params: { operation: 'send', manualChannel: '<start.channel>', text: 'b' },
          modes: { channel: 'advanced' },
        }),
        blk('Basic holding text', 'slack_v2', {
          params: { operation: 'send', channel: '<start.channel>', text: 'c' },
          modes: { channel: 'basic' },
        }),
        blk('Advanced empty', 'slack_v2', {
          params: { operation: 'send', text: 'd' },
          modes: { channel: 'advanced' },
        }),
        blk('Both members', 'slack_v2', {
          params: { operation: 'send', channel: 'C0OLD', manualChannel: 'C0NEW', text: 'e' },
          modes: { channel: 'advanced' },
        }),
        blk('Filter builder list', 'table_v2', {
          params: {
            operation: 'query_rows',
            tableSelector: { $sim: 'resource', kind: 'table', key: 'tickets' },
            filterBuilder: [{ column: 'status', operator: 'eq', value: 'open' }],
          },
          modes: { tableId: 'basic', filterInput: 'basic' },
        }),
        blk('Filter code json', 'table_v2', {
          params: {
            operation: 'query_rows',
            tableSelector: { $sim: 'resource', kind: 'table', key: 'tickets' },
            filter: '{\n  "field": "status",\n  "op": "eq",\n  "value": "open"\n}',
          },
          modes: { tableId: 'basic', filterInput: 'advanced' },
        }),
      ],
    }),
  },
  {
    name: 'resource-nodes',
    workflow: wf({
      variables: [
        { key: 'retries', name: 'retries', type: 'number', value: 2 },
        { key: 'lastrun', name: 'Last Run', type: 'string', value: 'never' },
      ],
      blocks: [
        start(),
        blk('Query', 'table_v2', {
          params: {
            operation: 'query_rows',
            tableSelector: { $sim: 'unresolved', kind: 'table', id: 'tbl_deleted' },
            knowledgeBases: [
              { $sim: 'resource', kind: 'knowledge-base', key: 'docs' },
              { $sim: 'resource', kind: 'knowledge-base', key: 'faq' },
            ],
            limit: {
              $sim: 'csv',
              items: [
                { $sim: 'resource', kind: 'knowledge-document', key: 'a' },
                { $sim: 'unresolved', kind: 'knowledge-document', id: 'doc_9' },
              ],
            },
            data: { $sim: 'literal', value: { $sim: 'user data', n: 1 } },
          },
          modes: { tableId: 'basic' },
        }),
        blk('Set vars', 'variables', {
          params: {
            variables: [
              { variableId: { $sim: 'var', key: 'retries' }, value: '<variable.retries>' },
              { variableId: { $sim: 'var', key: 'lastrun' }, value: '<query.rows>' },
            ],
          },
        }),
      ],
      edges: [edge('query', 'setvars'), edge('start', 'query')],
    }),
  },
  {
    // `vars.x` by field: in a variables-input field a var node prints bare and compiles back to the
    // node, while `<variable.x>` text prints as a template; elsewhere the text prints bare and a var
    // node needs `raw()`.
    name: 'vars-by-field',
    workflow: wf({
      variables: [{ key: 'count', name: 'count', type: 'number', value: 0 }],
      blocks: [
        start(),
        blk('Set count', 'variables', {
          params: {
            variables: [
              { variableId: { $sim: 'var', key: 'count' }, value: '<variable.count>' },
              { variableId: { $sim: 'var', key: 'count' }, value: 'count is <variable.count>' },
            ],
          },
        }),
        blk('Echo', 'agent', {
          params: {
            model: { $sim: 'var', key: 'count' },
            systemPrompt: '<variable.count>',
            temperature: 'count is <variable.count>',
          },
        }),
      ],
      edges: [edge('start', 'setcount'), edge('setcount', 'echo')],
    }),
  },
  {
    name: 'inactive-values',
    workflow: wf({
      blocks: [
        start(),
        blk('Remember', 'agent', {
          params: {
            model: 'm',
            memoryType: 'none',
            conversationId: 'stale-id',
            legacyField: 'kept',
          },
        }),
      ],
      edges: [edge('start', 'remember')],
    }),
  },
  {
    name: 'generic-block-unknown-type',
    workflow: wf({
      blocks: [
        start('Start', [{ name: 'input', type: 'string', value: '' }]),
        blk('Mystery', 'custom_block_acme', {
          params: { zeta: 1, alpha: 'a <start.input>' },
          triggerMode: true,
          modes: { someCid: 'advanced' },
        }),
      ],
    }),
  },
  {
    name: 'generic-block-legacy-operation',
    workflow: wf({
      blocks: [
        start(),
        blk('Old table op', 'table_v2', {
          params: { operation: 'delete_everything', limit: '10' },
          modes: { tableId: 'basic' },
        }),
      ],
    }),
  },
  {
    name: 'block-meta',
    workflow: wf({
      blocks: [
        start(),
        blk('Guarded', 'api', {
          params: { url: 'https://a.test', method: 'POST' },
          enabled: false,
          locked: true,
          advancedMode: true,
          errorPort: true,
          retry: { enabled: true, maxTries: 3, waitBetweenTriesMs: 1000 },
          extra: { canvasNote: 'x', width: 300 },
        }),
        blk('Flaky', 'api', {
          params: { url: 'https://b.test' },
          errorPort: true,
        }),
        blk('Fallback', 'response', {}),
      ],
      edges: [
        edge('flaky', 'fallback', { kind: 'error' }),
        edge('start', 'guarded'),
        edge('start', 'flaky'),
      ],
    }),
  },
  {
    name: 'agent-tools',
    workflow: wf({
      blocks: [
        start('Start', [{ name: 'input', type: 'string', value: '' }]),
        blk('Assistant', 'agent', {
          params: { model: 'claude-sonnet-5-5' },
          tools: {
            tools: [
              {
                type: 'slack_v2',
                operation: 'send',
                params: { channel: 'C0OPS', text: 'Approve: <start.input>' },
                modes: toolModes(registryCatalog, 'slack_v2', { channel: 'C0OPS' }),
                usageControl: 'auto',
              },
              {
                type: 'custom-tool',
                params: {},
                modes: {},
                usageControl: 'auto',
                customTool: {
                  ref: { $sim: 'resource', kind: 'custom-tool', key: 'lookup-vendor' },
                },
              },
              {
                type: 'custom-tool',
                title: 'Drifted copy',
                toolId: 'custom-drifted',
                params: {},
                modes: {},
                customTool: {
                  ref: { $sim: 'resource', kind: 'custom-tool', key: 'lookup-vendor' },
                  snapshot: { schema: { type: 'function' }, code: 'return 1' },
                },
              },
              {
                type: 'mcp',
                title: 'search_docs',
                params: {
                  serverId: { $sim: 'resource', kind: 'mcp-server', key: 'docs' },
                  toolName: 'search_docs',
                  serverName: 'Docs',
                  limit: '5',
                },
                modes: { server: 'basic', tool: 'basic' },
                usageControl: 'auto',
                extra: {
                  schema: { type: 'object', properties: { query: { type: 'string' } } },
                },
              },
              {
                type: 'mcp',
                title: 'Renamed search',
                params: {
                  serverId: { $sim: 'resource', kind: 'mcp-server', key: 'docs' },
                  toolName: 'search_docs',
                },
                modes: { server: 'basic', tool: 'basic' },
              },
              {
                type: 'workflow_input',
                title: 'Workflow',
                toolId: 'workflow_executor',
                params: { workflowId: { $sim: 'resource', kind: 'workflow', key: 'enrich-lead' } },
                modes: { workflowId: 'basic' },
                usageControl: 'auto',
              },
            ],
          },
        }),
      ],
      edges: [edge('start', 'assistant')],
    }),
  },
  {
    name: 'input-format-sugar',
    workflow: wf({
      blocks: [
        start('Start', [
          { name: 'question', type: 'string', value: '' },
          { name: 'limit', type: 'number', value: 10, description: 'Max results', required: true },
          { name: 'tags', type: 'array' },
        ]),
        blk('Hook', 'generic_webhook', {
          params: {
            inputFormat: [
              { name: '1', type: 'string', value: '' },
              { name: 'id', type: 'string', value: '', extraKey: true },
            ],
          },
        }),
      ],
    }),
  },
  {
    name: 'json-code-fields',
    workflow: wf({
      blocks: [
        start('Start', [
          { name: 'input', type: 'string', value: '' },
          { name: 'count', type: 'number', value: '' },
        ]),
        blk('Sugared', 'agent', {
          params: { model: 'm', responseFormat: '{\n  "name": "ticket",\n  "strict": true\n}' },
        }),
        blk('Compact', 'agent', {
          params: { model: 'm', responseFormat: '{"name":"ticket"}' },
        }),
        blk('Refs in json', 'api', {
          params: { url: 'https://x.test', body: '{\n  "q": <start.input>\n}' },
        }),
        blk('Typed refs', 'table_v2', {
          params: {
            operation: 'insert_row',
            tableSelector: { $sim: 'resource', kind: 'table', key: 'tickets' },
            data: '{\n  "subject": "<start.input>",\n  "count": <start.count>,\n  "asText": "<start.count>",\n  "note": "re: <start.input>",\n  "tags": [\n    "a",\n    <start.count>\n  ]\n}',
          },
          modes: { tableId: 'basic' },
        }),
      ],
      edges: [edge('start', 'sugared')],
    }),
  },
  {
    name: 'response-body',
    workflow: wf({
      blocks: [
        start('Start', [
          { name: 'input', type: 'string', value: '' },
          { name: 'count', type: 'number', value: '' },
        ]),
        blk('Created', 'response', {
          params: {
            dataMode: 'json',
            data: '{\n  "ok": true,\n  "subject": "<start.input>",\n  "count": <start.count>\n}',
            status: '201',
            headers: [{ cells: { Key: 'X-Trace', Value: '<start.input>' } }],
          },
        }),
        blk('Echo', 'response', { params: { dataMode: 'json', data: '<start.input>' } }),
        blk('Built', 'response', {
          params: {
            dataMode: 'structured',
            builderData: [{ id: 'f1', name: 'ok', type: 'boolean', value: 'true' }],
          },
        }),
      ],
      edges: [edge('start', 'created')],
    }),
  },
  {
    name: 'stored-secrets',
    workflow: wf({
      blocks: [
        start(),
        blk('Pasted key', 'agent', {
          params: { model: 'gpt-5.5', apiKey: 'sk-live-0123456789' },
        }),
        blk('Env key', 'agent', {
          params: { model: 'gpt-5.5', apiKey: '{{OPENAI_API_KEY}}' },
        }),
      ],
      edges: [edge('start', 'pastedkey'), edge('start', 'envkey')],
    }),
  },
  {
    name: 'function-languages',
    workflow: wf({
      blocks: [
        start('Start', [{ name: 'total', type: 'number', value: '' }]),
        blk('Js code', 'function', {
          params: {
            language: 'javascript',
            code: 'const total = <start.total> + {{TAX_RATE}}\n// keep `ticks` and $\u007bbraces}\nreturn total',
          },
        }),
        blk('Py code', 'function', {
          params: { language: 'python', code: 'def main():\n    return <start.total>\n' },
        }),
        blk('Sh code', 'function', { params: { language: 'shell', code: 'echo "{{HOME_DIR}}"' } }),
      ],
      edges: [edge('jscode', 'pycode'), edge('pycode', 'shcode'), edge('start', 'jscode')],
    }),
  },
  {
    name: 'comments-at-anchors',
    workflow: wf({
      blocks: [
        start(),
        blk('Classify', 'agent', { params: { model: 'm', temperature: 0.5 } }),
        blk('Done', 'response', {}),
      ],
      variables: [{ key: 'count', name: 'count', type: 'number', value: 1 }],
      edges: [edge('classify', 'done'), edge('start', 'classify')],
      comments: [
        [encodeAnchor({ kind: 'header' }), [line('Owned by the support team.')]],
        [
          encodeAnchor({ kind: 'block', block: 'classify' }),
          [line('Cheap model first.'), line('see runbook', 'trailing')],
        ],
        [
          encodeAnchor({ kind: 'param', block: 'classify', param: 'temperature' }),
          [line('tuned 2026-10')],
        ],
        [
          encodeAnchor({ kind: 'param', block: 'classify', param: 'systemPrompt' }),
          [line('param not printed')],
        ],
        [
          encodeAnchor({ kind: 'edges', block: 'classify', port: 'out' }),
          [line('happy path', 'trailing')],
        ],
        [encodeAnchor({ kind: 'wiring' }), [line('Wiring')]],
        [encodeAnchor({ kind: 'var', variable: 'count' }), [line('starts at one')]],
        [encodeAnchor({ kind: 'block', block: 'deleted' }), [line('dropped')]],
        [
          encodeAnchor({ kind: 'block', block: 'done' }),
          [{ text: '*\n     * Final reply.\n     ', kind: 'block', placement: 'leading' }],
        ],
        [encodeAnchor({ kind: 'footer' }), [line('end of file')]],
      ],
    }),
  },
  {
    name: 'identifier-collisions',
    workflow: wf({
      blocks: [
        start(),
        blk('Default', 'api', { params: { url: 'https://a.test' } }),
        blk('Table', 'api', { params: { url: 'https://b.test' } }),
        blk('Workflow', 'api', { params: { url: 'https://c.test' } }),
        blk('Slack', 'api', { params: { url: 'https://d.test' } }),
        blk('Send Email', 'api', { params: { url: 'https://e.test' } }),
        blk('send-email', 'api', { params: { url: 'https://f.test' } }),
        blk('1st step', 'api', { params: { url: 'https://g.test' } }),
        blk('日本語', 'api', { params: { url: 'https://h.test' } }),
        blk('Hinted', 'api', { params: { url: 'https://i.test <default.data>' } }),
        blk('Bad hint', 'api', { params: { url: 'https://j.test' } }),
      ],
    }),
    hints: { blocks: { hinted: { ident: 'myHinted' }, badhint: { ident: 'class' } } },
  },
  {
    name: 'lock-order',
    workflow: wf({
      blocks: [
        blk('Zeta', 'api', { params: { url: 'https://z.test' } }),
        blk('Alpha', 'api', { params: { url: 'https://a.test' } }),
        blk('Mid', 'api', { params: { url: 'https://m.test <alpha.data>' } }),
        start(),
      ],
      edges: [edge('start', 'zeta')],
    }),
    hints: { blocks: { zeta: { order: 0 }, mid: { order: 1 }, alpha: { order: 2 } } },
  },
  {
    name: 'raw-and-odd-edges',
    workflow: wf({
      blocks: [
        start(),
        blk('Gate', 'condition', {
          branches: {
            kind: 'condition',
            rows: [
              { key: 'if', value: 'true' },
              { key: 'else', value: '' },
            ],
          },
        }),
        blk('A', 'api', { params: { url: 'https://a.test' } }),
        blk('B', 'api', { params: { url: 'https://b.test' } }),
      ],
      edges: [
        edge('a', 'b', { kind: 'raw', handle: 'right-legacy' }),
        edge('gate', 'a', { kind: 'out' }),
        edge('gate', 'b', { kind: 'branch', key: 'if' }),
        edge('start', 'gate'),
      ],
    }),
  },
  {
    name: 'fan-out-wrapping',
    workflow: wf({
      blocks: [
        start(),
        ...[
          'Enrich company profile',
          'Enrich contact details',
          'Score lead quality',
          'Notify sales channel',
          'Archive raw payload',
        ].map((name) => blk(name, 'api', { params: { url: 'https://x.test' } })),
      ],
      edges: [
        'enrichcompanyprofile',
        'enrichcontactdetails',
        'scoreleadquality',
        'notifysaleschannel',
        'archiverawpayload',
      ].map((to) => edge('start', to)),
    }),
  },
  {
    name: 'legacy-dropdown-and-todo',
    workflow: wf({
      blocks: [
        start(),
        blk('Legacy method', 'api', { params: { method: 'PATCH' } }),
        blk('Drafted', 'agent', { params: {} }),
      ],
    }),
  },
  {
    name: 'layout-widths',
    workflow: wf({
      blocks: [
        start(),
        blk('Widths', 'api', {
          params: {
            url: 'https://example.com/a/very/long/path/that/keeps/going/and/going/until/it/overflows/the/line',
            headers: [
              { cells: { Key: 'Authorization', Value: 'Bearer {{API_TOKEN}}' } },
              { cells: { Key: 'Accept', Value: 'application/json' } },
            ],
            method: 'GET',
          },
        }),
        blk('Numbers', 'custom_block_metrics', {
          params: {
            model: 'm',
            temperature: 1e21,
            messages: [
              1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
              25, 26, 27, 28, 29, 30, -0.5,
            ],
          },
        }),
        blk('Short key', 'slack_v2', {
          params: {
            operation: 'send',
            text: 'a very long message body that will never fit on the same line as its very short key',
          },
          modes: { channel: 'basic' },
        }),
      ],
    }),
  },
  {
    name: 'trigger-mode-builders',
    workflow: wf({
      blocks: [
        blk('Invoice email', 'gmail_v2', {
          triggerMode: true,
          params: {
            selectedTriggerId: 'gmail_poller',
            triggerCredentials: { $sim: 'resource', kind: 'credential', key: 'finance-gmail' },
            labelIds: ['INBOX'],
            markAsRead: true,
          },
        }),
        blk('Send summary', 'gmail_v2', {
          params: {
            operation: 'send_gmail',
            credential: { $sim: 'resource', kind: 'credential', key: 'finance-gmail' },
            to: 'cfo@acme.test',
            subject: 'Invoices',
            body: '<invoiceemail.email.subject>',
          },
        }),
        blk('Odd trigger', 'gmail_v2', {
          triggerMode: true,
          params: {
            selectedTriggerId: 'gmail_other',
            triggerCredentials: { $sim: 'resource', kind: 'credential', key: 'finance-gmail' },
            markAsRead: false,
          },
        }),
      ],
      edges: [edge('invoiceemail', 'sendsummary')],
    }),
  },
  {
    name: 'note-markdown',
    workflow: wf({
      blocks: [
        start(),
        blk('How this works', 'note', {
          params: { content: 'Polls **INBOX**;\nappends to the `finance` sheet.' },
        }),
      ],
    }),
  },
]
