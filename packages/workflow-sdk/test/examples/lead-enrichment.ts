// @sim-sdk 1
import {
  api,
  childWorkflow,
  codeFile,
  credential,
  env,
  fn,
  parallel,
  runWorkflow,
  slack,
  t,
  table,
  trigger,
  workflow,
} from '@sim/workflow-sdk'

export default workflow('Lead enrichment', {}, () => {
  const nightly = trigger.schedule('Nightly', {
    scheduleType: 'daily',
    dailyTime: '02:00',
    timezone: 'UTC',
  })
  const pending = table.queryRows('Pending leads', {
    tableId: table('leads'),
    filterInput: { all: [{ field: 'status', op: 'eq', value: 'new' }] },
    limit: '200',
  })
  const enrichAll = parallel.collection(
    'Enrich',
    { collection: pending.rows, batchSize: 10 },
    (p) => {
      const lookup = api('Lookup', {
        url: t`https://crm.example.com/c/${p.currentItem.data.email}`,
        method: 'GET',
        headers: [{ cells: { Key: 'Authorization', Value: t`Bearer ${env.CRM_KEY}` } }],
      })
      const score = fn('Score', { language: 'javascript', code: codeFile('./functions/score.js') })
      const save = table.updateRowById('Save', {
        tableId: table('leads'),
        rowId: p.currentItem.id,
        data: { score: score.result },
      })
      p.to(lookup).to(score).to(save)
    }
  )
  const handoff = runWorkflow('Hand off', {
    workflowId: childWorkflow('assign-owner'),
    inputMapping: { leads: enrichAll.results },
  })
  const legacyPing = slack.sendMessage(
    'Old ping',
    { credential: credential('sales-slack'), channel: 'C0SALES', text: 'done' },
    { disabled: true }
  )
  nightly.to(pending).to(enrichAll).to(handoff, legacyPing)
})
