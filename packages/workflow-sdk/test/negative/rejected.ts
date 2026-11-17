// @sim-sdk 1
// Each `@ts-expect-error` must see an error, or the type-check fails with "unused directive".
import {
  agent,
  condition,
  credential,
  env,
  gmail,
  js,
  knowledge,
  knowledgeBase,
  loop,
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
    data: { status: 'closed' },
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
    // @ts-expect-error `email` is a cell: read it as `currentItem.data.email`
    agent('Read flat', {
      model: 'claude-sonnet-5-5',
      messages: [{ role: 'user', content: t`${p.currentItem.email}` }],
    })
  })

  // An operation that does not exist.
  // @ts-expect-error `sendMesage` is not a Slack operation
  slack.sendMesage('Typo', {})
})
