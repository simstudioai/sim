// @sim-sdk 1
import {
  condition,
  credential,
  human,
  js,
  ref,
  response,
  router,
  slack,
  t,
  trigger,
  workflow,
} from '@sim/workflow-sdk'

export default workflow('Approval flow', {}, () => {
  const req = trigger.start('Start', { inputFormat: { amount: 'number', reason: 'string' } })
  const triage = router('Triage', {
    context: t`${req.amount} for ${req.reason}`,
    model: 'claude-sonnet-5-5',
    routes: { small: 'Under $100, auto-approve', review: 'Needs a manager' },
  })
  // A const cannot reference itself in its own initializer, so the block's own URL is a `ref`.
  const approve = human('Manager approval', {
    builderData: [{ name: 'amount', type: 'number', value: req.amount }],
    notification: [
      slack.tool.sendMessage({
        credential: credential('ops-slack'),
        channel: 'C0OPS',
        text: t`Approve: ${ref('managerapproval.url')}`,
      }),
    ],
    inputFormat: { approved: 'boolean', note: 'string' },
  })
  const decide = condition('Approved?', { yes: js`${approve.submission.approved}`, else: true })
  // The resumed block also carries each form field at its top level, as the runtime copies them.
  const done = response('Done', { body: { approved: approve.approved, note: approve.note } })
  const notConfigured = condition('Not configured yet', {})

  req.to(triage)
  triage.small.to(done)
  triage.review.to(approve).to(decide)
  decide.yes.to(done)
  decide.else.to(notConfigured)
  notConfigured.if.to(done)
  notConfigured.else.to(done)
})
