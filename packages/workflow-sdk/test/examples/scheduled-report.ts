// @sim-sdk 1
import {
  agent,
  credential,
  gmail,
  googleSheets,
  md,
  note,
  t,
  trigger,
  workflow,
} from '@sim/workflow-sdk'

export default workflow('Invoice report', {}, () => {
  const mail = trigger.gmail.poller('Invoice email', {
    credential: credential('finance-gmail'),
    labelIds: ['INBOX'],
    markAsRead: true,
  })
  const extract = agent('Extract', {
    model: 'claude-sonnet-5-5',
    messages: [{ role: 'user', content: t`Extract totals:\n${mail.email.bodyText}` }],
    tools: [
      googleSheets.tool.appendData(
        { credential: credential('finance-google'), spreadsheetId: '1AbC' },
        { usageControl: 'auto' }
      ),
    ],
  })
  const send = gmail.sendEmail('Send summary', {
    credential: credential('finance-gmail'),
    to: 'cfo@acme.com',
    subject: 'Invoices',
    body: extract.content,
  })
  mail.to(extract).to(send)
  note('How this works', { content: md`Polls **INBOX**; appends to the finance sheet.` })
})
