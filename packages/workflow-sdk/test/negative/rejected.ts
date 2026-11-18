// @sim-sdk 1
// Each `@ts-expect-error` must see an error, or the type-check fails with "unused directive".

import type { Ref } from '@sim/workflow-sdk'
import {
  agent,
  childWorkflow,
  condition,
  credential,
  customTool,
  env,
  gmail,
  human,
  js,
  knowledge,
  knowledgeBase,
  loop,
  response,
  runWorkflow,
  skill,
  slack,
  t,
  table,
  trigger,
  workflow,
} from '@sim/workflow-sdk'

export default workflow('Rejected', {}, () => {
  const start = trigger.start('Start', { inputFormat: { subject: 'string' } })
  const classify = agent('Classify', {
    model: 'claude-sonnet-5-5',
    responseFormat: {
      schema: {
        type: 'object',
        properties: { category: { type: 'string', enum: ['billing', 'bug'] } },
      },
    },
  })

  // A misspelled output path.
  // @ts-expect-error `categroy` is not an output of `classify`
  js`${classify.categroy} === 'billing'`

  // A misspelled input-format field.
  // @ts-expect-error `subjct` is not a field of the start input format
  t`${start.subjct}`

  // An unknown param.
  gmail.sendEmail('Send', {
    credential: credential('finance-gmail'),
    to: 'a@b.co',
    body: 'hi',
    // @ts-expect-error `recipient` is not a param of gmail.sendEmail
    recipient: 'a@b.co',
  })

  // A wrong literal option.
  knowledge.search('Search', {
    knowledgeBaseId: knowledgeBase('docs'),
    // @ts-expect-error `semantic` is not a search mode
    searchMode: 'semantic',
  })

  // A missing required param (`to`).
  // @ts-expect-error `to` is required by gmail.sendEmail
  gmail.sendEmail('Send', { credential: credential('finance-gmail'), body: 'hi' })

  // An unknown table column, with workspace types loaded.
  table.insertRow('Log', {
    tableId: table('tickets'),
    // @ts-expect-error `priority` is not a column of the tickets table
    data: { priority: 'high' },
  })

  // Unknown workspace resources and env names.
  // @ts-expect-error `dosc` is not a knowledge base of the workspace
  knowledgeBase('dosc')
  // @ts-expect-error `CRM_KYE` is not a workspace environment variable
  t`${env.CRM_KYE}`
  agent('Skilled', {
    model: 'claude-sonnet-5-5',
    skills: [
      skill('triage'),
      // @ts-expect-error `tirage` is not a skill of the workspace
      skill('tirage'),
    ],
    tools: [
      customTool('lookup-order'),
      // @ts-expect-error `lookup-ordr` is not a custom tool of the workspace
      customTool('lookup-ordr'),
    ],
  })

  // `true` on a branch other than else.
  // @ts-expect-error only the else branch may be `true`
  condition('Pick', { yes: js`1 > 0`, no: true })
  condition('Gate', { yes: js`1 > 0`, maybe: 'x', else: true })

  // A table filter in the legacy operator-object grammar the runtime refuses.
  table.queryRows('Open', {
    tableId: table('leads'),
    // @ts-expect-error `{ column: { $eq } }` is not a filter rule list or a predicate
    filterInput: { status: { $eq: 'open' } },
  })
  table.updateRowsByFilter('Close', {
    tableId: table('leads'),
    data: { status: 'enriched' },
    // @ts-expect-error a predicate names its column as `field`, not `column`
    filterInput: { column: 'status', op: 'eq', value: 'open' },
  })

  // A row's cells live under `data`, not on the row.
  const leads = table.queryRows('Leads', { tableId: table('leads') })
  loop.forEach('Each lead', { collection: leads.rows }, (p) => {
    agent('Read cell', {
      model: 'claude-sonnet-5-5',
      messages: [{ role: 'user', content: t`${p.currentItem.data.email}` }],
    })
    agent('Read flat', {
      model: 'claude-sonnet-5-5',
      // @ts-expect-error `email` is a cell: read it as `currentItem.data.email`
      messages: [{ role: 'user', content: t`${p.currentItem.email}` }],
    })
  })

  // A declared input field replaces the built-in output of the same name, as at run time.
  const counted = trigger.start('Counted', { inputFormat: { input: 'number' } })
  counted.input satisfies Ref<number>
  // @ts-expect-error `input` is the declared number, not the built-in string
  counted.input satisfies Ref<string>

  // An operation that does not exist.
  // @ts-expect-error `sendMesage` is not a Slack operation
  slack.sendMesage('Typo', {})

  // A param required under the pinned operation, though its registry condition is a function.
  // @ts-expect-error `credential` and `text` are required by slack.sendMessage
  slack.sendMessage('Empty', {})

  // A reference whose value does not fit the param, and a whole block written into text.
  const amounts = trigger.start('Amounts', { inputFormat: { amount: 'number', files: 'file[]' } })
  table.queryRows('Columns', {
    tableId: table('leads'),
    // @ts-expect-error a number is not a list of columns
    outputColumns: amounts.amount,
  })
  slack.sendMessage('Files as text', {
    credential: credential('support-slack'),
    channel: 'C1',
    // @ts-expect-error a file list is not message text
    text: amounts.files,
  })
  // @ts-expect-error a whole block is not text: reference one of its outputs
  t`${amounts}`
  // References into untyped JSON fit any param.
  const untyped = trigger.start('Untyped', { inputFormat: { payload: 'object' } })
  table.queryRows('Untyped columns', { tableId: table('leads'), outputColumns: untyped.payload.a })

  // Cell values are checked against the column type.
  table.insertRow('Bad score', {
    tableId: table('leads'),
    // @ts-expect-error `score` is a number column
    data: { email: 'a@b.co', score: 'high' },
  })
  table.insertRow('Bad status', {
    tableId: table('leads'),
    // @ts-expect-error `closed` is not an option of the `status` select column
    data: { email: 'a@b.co', status: 'closed' },
  })
  table.insertRow('Good row', {
    tableId: table('leads'),
    data: { email: start.subject, status: 'new', score: null },
  })

  // A whole-row write holds every required column; an update merges a patch over the stored row.
  table.insertRow('No email', {
    tableId: table('leads'),
    // @ts-expect-error `email` is a required column of leads
    data: { status: 'new' },
  })
  table.upsertRow('Upsert no email', {
    tableId: table('leads'),
    // @ts-expect-error an upsert checks the whole row, so `email` is required
    data: { score: 3 },
  })
  table.batchInsertRows('Batch no email', {
    tableId: table('leads'),
    // @ts-expect-error every inserted row needs `email`
    rows: [{ status: 'new' }],
  })
  table.insertRow('Null email', {
    tableId: table('leads'),
    // @ts-expect-error a required column cannot be null
    data: { email: null },
  })
  table.updateRowById('Patch', { tableId: table('leads'), rowId: 'r1', data: { score: 2 } })

  // A credential field takes credential('key') or a run-time id, never literal text.
  slack.sendMessage('Literal token', {
    // @ts-expect-error a pasted token is literal text
    credential: ['xoxb', '1234', '5678', 'literaltoken'].join('-'),
    channel: 'C1',
    text: 'x',
  })
  slack.sendMessage('Credential id from input', {
    credential: start.subject,
    channel: 'C1',
    text: 'x',
  })
  slack.sendMessage('Credential id from env', { credential: env.CRM_KEY, channel: 'C1', text: 'x' })

  // A human-in-the-loop submission holds the fields its form declares.
  const review = human('Review', { inputFormat: { approved: { type: 'boolean', required: true } } })
  review.submission.approved satisfies Ref<boolean>
  // @ts-expect-error `aproved` is not a field of the review form
  t`${review.submission.aproved}`

  // A credential for another provider than the block's service.
  slack.sendMessage('Wrong credential', {
    // @ts-expect-error `finance-gmail` is a Google credential, not a Slack one
    credential: credential('finance-gmail'),
    channel: 'C1',
    text: 'x',
  })
  gmail.sendEmail('Wrong credential', {
    // @ts-expect-error `support-slack` is a Slack credential, not a Gmail one
    credential: credential('support-slack'),
    to: 'a@b.co',
    body: 'hi',
  })

  // Child workflow inputs are the inputs its start block declares.
  runWorkflow('Hand off', {
    workflowId: childWorkflow('assign-owner'),
    // @ts-expect-error `leadz` is not an input of assign-owner
    inputMapping: { leadz: [] },
  })
  runWorkflow('Hand off ok', {
    workflowId: childWorkflow('assign-owner'),
    inputMapping: { leads: leads.rows },
  })

  // A response status is a number.
  // @ts-expect-error `two hundred` is not an HTTP status
  response('Reply', { body: { ok: true }, status: 'two hundred' })
  response('Reply ok', { body: { ok: true }, status: 201 })

  // A multi-select cell holds a list of options; a stored column that is not required may be empty.
  table.insertRow('Tags', {
    tableId: table('leads'),
    // @ts-expect-error `tags` holds a list of options
    data: { email: 'a@b.co', tags: 'vip' },
  })
  table.insertRow('Tags ok', { tableId: table('leads'), data: { email: 'a@b.co', tags: ['vip'] } })
  const lead = table.getRowById('Lead', { tableId: table('leads'), rowId: 'r1' })
  lead.row.data.score satisfies Ref<number | null>
  // @ts-expect-error `score` is not required, so a cell may be empty
  lead.row.data.score satisfies Ref<number>

  // An operation's outputs are what its tool returns, and may be null where the tool says so.
  const sent = slack.sendMessage('Sent', {
    credential: credential('support-slack'),
    channel: 'C1',
    text: 'x',
  })
  t`${sent.ts}`
  // @ts-expect-error `canvas_id` is an output of the canvas operations, not of sendMessage
  t`${sent.canvas_id}`
  leads.nextCursor satisfies Ref<string | null>
  // @ts-expect-error `nextCursor` is null on the last page
  leads.nextCursor satisfies Ref<string>
})
