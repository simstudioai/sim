// @sim-sdk 1
import {
  agent,
  binding,
  customTool,
  gmail,
  googleSheets,
  mcp,
  md,
  note,
  picked,
  t,
  trigger,
  workflow,
} from '@sim/workflow-sdk'

export default workflow('Invoice report', {}, () => {
  const mail = trigger.gmail.poller('Invoice email', {
    oauthCredential: binding('finance-gmail'),
    labelIds: ['INBOX'],
    markAsRead: true,
  })
  const extract = agent('Extract', {
    model: 'claude-sonnet-5-5',
    messages: [{ role: 'user', content: t`Extract totals:\n${mail.email.bodyText}` }],
    tools: [
      googleSheets.tool.appendData(
        { oauthCredential: binding('finance-google'), spreadsheetId: picked('1AbC') },
        { usageControl: 'auto' }
      ),
      customTool('lookup-vendor'),
      mcp('linear').tool('create_issue'),
    ],
  })
  const send = gmail.sendEmail('Send summary', {
    oauthCredential: binding('finance-gmail'),
    to: 'cfo@acme.com',
    subject: 'Invoices',
    body: extract.content,
  })
  mail.to(extract).to(send)
  note('How this works', { content: md`Polls **INBOX**; appends to the finance sheet.` })
})
