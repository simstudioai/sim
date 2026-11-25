// @sim-sdk 1
import {
  agent,
  condition,
  credential,
  env,
  fn,
  human,
  js,
  knowledge,
  knowledgeBase,
  loop,
  response,
  slack,
  t,
  table,
  trigger,
  workflow,
} from '@sim/workflow-sdk'

// Index: file:line, a name on that line, what it shows (the comment above each line explains it).
//   cookbook.ts:50 trigger.schedule: daily schedule (trigger.start just above)
//   cookbook.ts:59 agent: structured output (responseFormat), retry as block meta
//   cookbook.ts:86 condition: keys tested in order, first true wins, else: true last
//   cookbook.ts:93 fn: inline JavaScript in js``
//   cookbook.ts:98 table.queryRows: outputs rows, each row { id, data }
//   cookbook.ts:109 table.upsertRow: conflictColumn; insertRow, updateRowsByFilter
//   cookbook.ts:116 knowledge.search: knowledge base search
//   cookbook.ts:132 human: human in the loop: approval.submission.<field>
//   cookbook.ts:147 loop.forEach: p.currentItem, p.index, each.results; $ref.loop in code files
//   cookbook.ts:180 fn: branches that rejoin: ?? picks the one that ran
//   cookbook.ts:186 response: body and status
//   cookbook.ts:215 onError: error path: x.error, a Function's x.errorMessage
//   integrations.ts:24 trigger.webhook: webhook with a token
//   integrations.ts:31 trigger.schedule: cron schedule
//   integrations.ts:40 api: HTTP request: headers, retries, retryDelayMs
//   integrations.ts:50 table.updateRowById: update one row by id
//   integrations.ts:87 onError: error path to a response
//   agents.ts:31 router: routes the model picks from
//   agents.ts:51 tools: agent tools: custom, MCP, integration, child workflow
//   agents.ts:62 runWorkflow: child workflow: inputMapping, enrich.result.data.<field>
//   agents.ts:71 parallel.collection: parallel fan-out

// An example to copy from, not a workflow of yours: `orders`, `policies`, `ops-slack` and
// ANTHROPIC_API_KEY stand in for this workspace's resources, whose real keys
// .sim/sdk/workspace.d.ts types.
export default workflow('Cookbook', { description: 'One example of each common block.' }, () => {
  // Triggers: trigger.start (API/manual input), trigger.schedule, trigger.webhook.
  const start = trigger.start('Start', { inputFormat: { orderId: 'string', amount: 'number' } })
  const nightly = trigger.schedule('Nightly', {
    scheduleType: 'daily',
    dailyTime: '02:00',
    timezone: 'UTC',
  })

  // Agent: structured output via responseFormat; its fields become outputs (check.risk).
  // apiKey: needed on self-hosted Sim; hosted Sim supplies one. Retry is block meta, the third
  // argument of any builder: a failed run of the block is tried again, up to maxTries in all.
  const check = agent(
    'Check Order',
    {
      model: 'claude-sonnet-4-6',
      apiKey: env.ANTHROPIC_API_KEY,
      messages: [
        { role: 'system', content: 'Rate the fraud risk of an order as low, med or high.' },
        { role: 'user', content: t`Order ${start.orderId} for ${start.amount}` },
      ],
      responseFormat: {
        name: 'risk',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            risk: { type: 'string', enum: ['low', 'med', 'high'] },
            reason: { type: 'string' },
          },
          required: ['risk', 'reason'],
          additionalProperties: false,
        },
      },
    },
    { retry: { enabled: true, maxTries: 3, waitBetweenTriesMs: 2000 } }
  )

  // Condition: one branch per key, `else: true` last; wire with route.<key>.to(...).
  const route = condition('Route Risk', {
    high: js`${check.risk} === 'high'`,
    med: js`${check.risk} === 'med'`,
    else: true,
  })

  // Function: inline JavaScript; reference outputs with ${...}. Result is fn.result.
  const shape = fn('Shape', {
    code: js`return { id: ${start.orderId}, cents: Math.round(${start.amount} * 100) }`,
  })

  // Tables: query rows (each row is { id, data }: recent.rows[0].data.status) and write one.
  const recent = table.queryRows('Recent Orders', {
    tableId: table('orders'),
    filterInput: { all: [{ field: 'status', op: 'eq', value: 'open' }] },
    limit: 50,
  })
  // Upsert: replaces the row whose conflictColumn (a unique column, by name) matches data, else
  // inserts one, so a second run for the same order rewrites it and a column missing from data
  // is cleared (table.updateRowsByFilter changes only the columns it names). table.insertRow
  // takes the same data without conflictColumn and adds a row every run. data is keyed by column
  // name: a column declared as `phone: column.string({ name: 'mobile' })` is written as
  // { mobile: ... }.
  const save = table.upsertRow('Save Order', {
    tableId: table('orders'),
    data: { orderId: start.orderId, status: 'open' },
    conflictColumn: 'orderId',
  })

  // Knowledge base search: results is the list of matching chunks.
  const docs = knowledge.search('Policy Search', {
    knowledgeBaseId: knowledgeBase('policies'),
    query: check.reason,
    topK: 3,
  })

  // Slack: a saved credential by key (see .sim/sdk/workspace.d.ts).
  const alert = slack.sendMessage('Alert Ops', {
    credential: credential('ops-slack'),
    destinationType: 'channel',
    channel: 'ops-alerts',
    messageFormat: 'text',
    text: t`High-risk order ${start.orderId}: ${check.reason}`,
  })

  // Human in the loop: inputFormat is the form; answers are approval.submission.<field>.
  const approval = human('Manager Review', {
    builderData: [{ name: 'orderId', type: 'string', value: start.orderId }],
    inputFormat: { approved: { type: 'boolean', required: true }, note: 'string' },
  })
  const decided = condition('Approved', {
    yes: js`${approval.submission.approved} === true`,
    else: true,
  })

  // Loop over a list: p.currentItem is one element and p.index its position; the loop's results
  // is the list of iteration outputs. In js`` code a reference is the value itself, not text
  // spliced in: write it where an expression goes, never inside quotes ('${x}' would give the
  // JSON, quotes included). A function code file (code: codeFile('./functions/line.js')) reads
  // other blocks as $ref.<block key>.<path> ($ref.recentorders.rows) and, inside the loop body,
  // the iteration as $ref.loop.currentItem and $ref.loop.index.
  const each = loop.forEach('Each Order', { collection: recent.rows }, (p) => {
    const line = fn('Line', {
      code: js`return ${p.currentItem.data.orderId} + ': ' + ${p.currentItem.data.status}`,
    })
    p.to(line)
  })
  const report = agent('Report', {
    model: 'claude-sonnet-4-6',
    apiKey: env.ANTHROPIC_API_KEY,
    messages: [{ role: 'user', content: t`Summarize these orders in 3 lines:\n${each.results}` }],
  })
  const post = slack.sendMessage('Post Report', {
    credential: credential('ops-slack'),
    destinationType: 'channel',
    channel: 'ops-daily',
    messageFormat: 'text',
    text: report.content,
  })

  // Branches that rejoin: a block both lead to runs once, after whichever branch ran. A block
  // that did not run reads as null in js`` code and as '' in t`` text, so a function picks the
  // branch's value with ?? and one response replies for both.
  const size = condition('Order Size', { large: js`${shape.result.cents} >= 100000`, else: true })
  const review = table.upsertRow('Keep Open', {
    tableId: table('orders'),
    data: { orderId: start.orderId, status: 'open' },
    conflictColumn: 'orderId',
  })
  const accept = table.upsertRow('Mark Answered', {
    tableId: table('orders'),
    data: { orderId: start.orderId, status: 'answered' },
    conflictColumn: 'orderId',
  })
  const status = fn('Pick Status', {
    code: js`return ${review.row.data.status} ?? ${accept.row.data.status}`,
  })

  // Response: the API reply body. Wrap an untyped value (fn.result.x) in t`` when it is text.
  // body is the short form of the editor's JSON mode: { dataMode: 'json', data } as below.
  const reply = response('Respond', {
    body: { risk: check.risk, id: t`${shape.result.id}`, status: t`${status.result}` },
  })
  const rejected = response('Respond Rejected', {
    dataMode: 'json',
    data: { status: 'rejected' },
  })
  // Error path: shape.onError(invalid) runs invalid when the code throws. shape.error leads with
  // the line and code that threw; shape.errorMessage is the thrown message alone, for the caller.
  const invalid = response('Respond Invalid', { body: { error: shape.errorMessage }, status: 422 })

  // Wiring: a.to(b) chains; a block can fan out to several targets.
  start.to(check)
  check.to(save)
  save.to(route)
  route.high.to(alert)
  alert.to(approval)
  approval.to(decided)
  decided.yes.to(shape)
  decided.else.to(rejected)
  route.med.to(docs)
  docs.to(shape)
  route.else.to(shape)
  shape.to(size)
  size.large.to(review)
  size.else.to(accept)
  review.to(status)
  accept.to(status)
  status.to(reply)
  shape.onError(invalid)
  nightly.to(recent)
  recent.to(each)
  each.to(report)
  report.to(post)
})
