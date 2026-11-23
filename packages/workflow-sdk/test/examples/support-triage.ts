// @sim-sdk 1
import {
  agent,
  condition,
  credential,
  env,
  js,
  response,
  slack,
  t,
  table,
  trigger,
  workflow,
} from '@sim/workflow-sdk'

export default workflow(
  'Support triage',
  { variables: { escalations: { type: 'number', value: 0 } } },
  () => {
    const ticketIn = trigger.webhook('Ticket in', {
      requireAuth: true,
      token: env.TICKETS_WEBHOOK_TOKEN,
      inputFormat: { subject: 'string', body: 'string', contacts: 'array' },
    })
    const classify = agent('Classify', {
      model: 'claude-sonnet-5-5',
      messages: [
        { role: 'system', content: 'Classify support tickets.' },
        { role: 'user', content: t`${ticketIn.subject}\n\n${ticketIn.body}` },
      ],
      responseFormat: {
        name: 'ticket',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['category', 'urgent'],
          properties: {
            category: { type: 'string', enum: ['billing', 'bug', 'other'] },
            urgent: { type: 'boolean' },
          },
        },
      },
    })
    const byCategory = condition('By category', {
      billing: js`${classify.category} === 'billing'`,
      urgent: js`${classify.urgent} === true`,
      else: true,
    })
    const logTicket = table.insertRow('Log ticket', {
      tableId: table('tickets'),
      data: { subject: ticketIn.subject, category: classify.category },
    })
    const notify = slack.sendMessage('Notify', {
      credential: credential('support-slack'),
      channel: 'C0SUPPORT',
      text: t`New ${classify.category} ticket: ${ticketIn.subject}`,
    })
    const reply = response('Reply', {
      body: { ok: true, category: classify.category, urgent: classify.urgent },
      status: 202,
    })

    ticketIn.to(classify).to(byCategory)
    byCategory.billing.to(logTicket).to(notify)
    byCategory.urgent.to(notify)
    byCategory.else.to(reply)
    notify.to(reply)
    logTicket.onError(notify)
  }
)
