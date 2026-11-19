// @sim-sdk 1
import {
  api,
  credential,
  env,
  gmail,
  response,
  t,
  table,
  trigger,
  workflow,
} from '@sim/workflow-sdk'

// An example to copy from, not a workflow of yours: `leads`, `ops-gmail`, CLEARBIT_KEY and
// LEADS_WEBHOOK_TOKEN stand in for this workspace's resources (.sim/sdk/workspace.d.ts).
// Integration builders are named by service, not block type: `gmail_v2` is `gmail.*`, and a
// hidden older version lives under `legacy.*`. .sim/sdk/INDEX.md lists every builder.
export default workflow(
  'Cookbook: integrations',
  { description: 'Webhook, weekday schedule, HTTP with headers, table update, Gmail, error path.' },
  () => {
    // Webhook trigger: inputFormat types the posted JSON fields (hook.leadId). With requireAuth
    // the caller must send the token; keep it in an env var.
    const hook = trigger.webhook('Lead Webhook', {
      requireAuth: true,
      token: env.LEADS_WEBHOOK_TOKEN,
      inputFormat: { leadId: 'string', email: 'string', domain: 'string' },
    })

    // Schedule: no weekday preset exists, so scheduleType 'custom' takes a 5-field cron.
    const weekdays = trigger.schedule('Weekdays 8am', {
      scheduleType: 'custom',
      cronExpression: '0 8 * * 1-5',
      timezone: 'America/New_York',
    })

    // HTTP request: headers (and query params) are table rows, { cells: { Key, Value } }.
    const lookup = api('Company Lookup', {
      url: t`https://company.clearbit.com/v2/companies/find?domain=${hook.domain}`,
      method: 'GET',
      headers: [{ cells: { Key: 'Authorization', Value: t`Bearer ${env.CLEARBIT_KEY}` } }],
    })

    // Update one row by id: data holds only the columns to change. lookup.data is untyped JSON,
    // so a text field from it is wrapped in t``.
    const save = table.updateRowById('Save Company', {
      tableId: table('leads'),
      rowId: hook.leadId,
      data: { company: t`${lookup.data.name}`, enriched: true },
    })

    // Gmail (gmail_v2): send one email with a saved Google credential.
    const welcome = gmail.sendEmail('Welcome Email', {
      credential: credential('ops-gmail'),
      to: hook.email,
      subject: 'Welcome aboard',
      body: t`Thanks for signing up from ${hook.domain}.`,
    })

    // Query rows, then email them as one digest. A typed column filter: { field, op, value }.
    const pending = table.queryRows('Pending Leads', {
      tableId: table('leads'),
      filterInput: { all: [{ field: 'enriched', op: 'eq', value: false }] },
      limit: 100,
    })
    const digest = gmail.sendEmail('Pending Digest', {
      credential: credential('ops-gmail'),
      to: 'ops@example.com',
      subject: 'Leads still to enrich',
      body: t`${pending.rows}`,
    })

    // Error path: x.onError(y) runs y when x fails, instead of failing the run; y reads the
    // failure message as x.error.
    const failed = response('Lookup Failed', {
      body: { ok: false, error: lookup.error },
      status: 502,
    })
    const done = response('Done', { body: { ok: true, row: save.row } })

    hook.to(lookup)
    lookup.to(save)
    lookup.onError(failed)
    save.to(welcome)
    welcome.to(done)
    weekdays.to(pending)
    pending.to(digest)
  }
)
