/**
 * Hand-built canonical workflows, one per printer construct (golden snapshots in `__golden__/`).
 * Each case names the behavior it pins so a golden diff points at the construct that changed.
 */

import { normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'
import { encodeAnchor } from '../../anchors'
import type { LockHints } from '../../api'
import type {
  AnchorKey,
  CanonicalBlock,
  CanonicalEdge,
  CanonicalParam,
  CanonicalTool,
  CanonicalVariable,
  CanonicalWorkflow,
  CodeComment,
  Port,
  Value,
} from '../../model'

export interface PrintCase {
  name: string
  workflow: CanonicalWorkflow
  hints?: LockHints
}

type BlockInit = Partial<Omit<CanonicalBlock, 'params' | 'name' | 'type' | 'key'>> & {
  params?: Record<string, Value>
  tools?: Record<string, CanonicalTool[]>
}

function blk(name: string, type: string, init: BlockInit = {}): CanonicalBlock {
  const { params = {}, tools = {}, ...rest } = init
  const canonicalParams: Record<string, CanonicalParam> = {}
  for (const [id, value] of Object.entries(params)) canonicalParams[id] = { kind: 'value', value }
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
  inactive?: Record<string, string[]>
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
      inactive: init.inactive ?? {},
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
        blk('Ticket in', 'webhook', {
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
        blk('Log ticket', 'table', {
          params: {
            operation: 'insert_row',
            tableSelector: { $sim: 'resource', kind: 'table', key: 'tickets' },
            data: '{\n  "subject": "<ticketin.subject>"\n}',
          },
          modes: { tableId: 'basic' },
        }),
        blk('Notify', 'slack', {
          params: {
            operation: 'send',
            authMethod: 'oauth',
            credential: { $sim: 'resource', kind: 'credential', key: 'support-slack' },
            channel: 'C0SUPPORT',
            text: 'New <classify.content> ticket: <ticketin.subject>',
          },
          modes: { channel: 'basic' },
          errorPort: true,
        }),
        blk('Reply', 'response', {
          params: { dataMode: 'structured', builderData: { ok: true } },
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
              'back\\slash `tick` $\u007bnotInterp} tab\there\r\ncrlf line\u2028ls\u2029ps \ud800 lone 漢字 🎉',
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
        start(),
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
        blk('Alpha', 'agent', { params: { model: 'm', systemPrompt: 'See <beta.content>' } }),
        blk('Beta', 'agent', { params: { model: 'm', systemPrompt: 'See <alpha.content>' } }),
        blk('Self', 'agent', { params: { model: 'm', systemPrompt: 'Me: <self.content>' } }),
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
          params: { model: 'm', systemPrompt: 'Results: <eachlead.results> and <score.result>' },
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
        start(),
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
            systemPrompt:
              'loop <loop.index> parallel <parallel.currentItem> named <outer.index> fan <fan.index>',
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
          params: { model: 'm', systemPrompt: 'cannot see <work.content>' },
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
        blk('Pick', 'router', {
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
        start(),
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
        blk('Triage', 'router', {
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
        start(),
        blk('Picked basic', 'slack', {
          params: { operation: 'send', channel: 'C0ONE', text: 'a' },
          modes: { channel: 'basic' },
        }),
        blk('Manual advanced', 'slack', {
          params: { operation: 'send', manualChannel: '<start.channel>', text: 'b' },
          modes: { channel: 'advanced' },
        }),
        blk('Basic holding text', 'slack', {
          params: { operation: 'send', channel: '<start.channel>', text: 'c' },
          modes: { channel: 'basic' },
        }),
        blk('Advanced empty', 'slack', {
          params: { operation: 'send', text: 'd' },
          modes: { channel: 'advanced' },
        }),
        blk('Both members', 'slack', {
          params: { operation: 'send', channel: 'C0OLD', manualChannel: 'C0NEW', text: 'e' },
          modes: { channel: 'advanced' },
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
        blk('Query', 'table', {
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
              { variable: { $sim: 'var', key: 'retries' }, value: '<variable.retries>' },
              { variable: { $sim: 'var', key: 'lastrun' }, value: '<query.rows>' },
            ],
          },
        }),
      ],
      edges: [edge('query', 'setvars'), edge('start', 'query')],
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
      inactive: { remember: ['conversationId'] },
      edges: [edge('start', 'remember')],
    }),
  },
  {
    name: 'generic-block-unknown-type',
    workflow: wf({
      blocks: [
        start(),
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
        blk('Old table op', 'table', {
          params: { operation: 'delete_everything', limit: '10' },
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
          opaque: { data: { canvasNote: 'x', width: 300 } },
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
        start(),
        blk('Assistant', 'agent', {
          params: { model: 'claude-sonnet-5-5' },
          tools: {
            tools: [
              {
                type: 'slack',
                operation: 'send',
                params: { channel: 'C0OPS', text: 'Approve: <start.input>' },
                modes: { channel: 'basic' },
                usageControl: 'auto',
              },
              {
                type: 'custom-tool-type',
                title: 'Lookup vendor',
                params: { query: '' },
                modes: {},
                customTool: {
                  ref: { $sim: 'resource', kind: 'custom-tool', key: 'lookup-vendor' },
                },
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
        blk('Hook', 'webhook', {
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
        start(),
        blk('Sugared', 'agent', {
          params: { model: 'm', responseFormat: '{\n  "name": "ticket",\n  "strict": true\n}' },
        }),
        blk('Compact', 'agent', {
          params: { model: 'm', responseFormat: '{"name":"ticket"}' },
        }),
        blk('Refs in json', 'api', {
          params: { url: 'https://x.test', body: '{\n  "q": <start.input>\n}' },
        }),
      ],
      edges: [edge('start', 'sugared')],
    }),
  },
  {
    name: 'function-languages',
    workflow: wf({
      blocks: [
        start(),
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
    hints: { blocks: { hinted: { binding: 'myHinted' }, badhint: { binding: 'class' } } },
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
              { key: 'Authorization', value: 'Bearer {{API_TOKEN}}' },
              { key: 'Accept', value: 'application/json' },
            ],
            method: 'GET',
          },
        }),
        blk('Numbers', 'agent', {
          params: {
            model: 'm',
            temperature: 1e21,
            messages: [
              1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
              25, 26, 27, 28, 29, 30, -0.5,
            ],
          },
        }),
        blk('Short key', 'slack', {
          params: {
            operation: 'send',
            text: 'a very long message body that will never fit on the same line as its very short key',
          },
        }),
      ],
    }),
  },
  {
    name: 'trigger-mode-builders',
    workflow: wf({
      blocks: [
        blk('Invoice email', 'gmail', {
          triggerMode: true,
          params: {
            selectedTriggerId: 'gmail_poller',
            credential: { $sim: 'resource', kind: 'credential', key: 'finance-gmail' },
            labelIds: ['INBOX'],
            markAsRead: true,
          },
        }),
        blk('Send summary', 'gmail', {
          params: {
            operation: 'send_gmail',
            credential: { $sim: 'resource', kind: 'credential', key: 'finance-gmail' },
            to: 'cfo@acme.test',
            subject: 'Invoices',
            body: '<invoiceemail.email.body_text>',
          },
        }),
        blk('Odd trigger', 'gmail', {
          triggerMode: true,
          params: { selectedTriggerId: 'gmail_other', markAsRead: false },
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
