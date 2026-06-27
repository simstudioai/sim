import { AirtableIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const AirtableBlockDisplay = {
  type: 'airtable',
  name: 'Airtable',
  description: 'Read, create, and update Airtable',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: AirtableIcon,
  longDescription:
    'Integrates Airtable into the workflow. Can list bases, list tables (with schema), and create, get, list, or update records. Can also be used in trigger mode to trigger a workflow when an update is made to an Airtable table.',
  docsLink: 'https://docs.sim.ai/integrations/airtable',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay

export const AirtableBlockMeta = {
  tags: ['spreadsheet', 'automation'],
  url: 'https://www.airtable.com',
  templates: [
    {
      icon: AirtableIcon,
      title: 'Airtable data sync',
      prompt:
        'Create a scheduled workflow that syncs records from my Airtable base into a Sim table every hour, keeping both in sync. Use an agent to detect changes, resolve conflicts, and flag any discrepancies for review in Slack.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['sync', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AirtableIcon,
      title: 'Airtable two-way sync',
      prompt:
        'Build a scheduled workflow that mirrors records between an Airtable base and a Sim table, detects conflicts, and pings Slack on records that need manual resolution.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['sync', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AirtableIcon,
      title: 'Airtable form-to-CRM',
      prompt:
        'Create a workflow that watches Airtable form submissions, enriches each row with company data, and pushes qualifying leads into HubSpot with the right owner.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: AirtableIcon,
      title: 'Airtable content calendar publisher',
      prompt:
        'Build a workflow that reads an Airtable content calendar, publishes due posts to WordPress with proper formatting, and writes the live URL back to the row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
      alsoIntegrations: ['wordpress'],
    },
    {
      icon: AirtableIcon,
      title: 'Airtable approval workflow',
      prompt:
        'Create a workflow that watches Airtable for new approval rows, posts a Slack message with quick-action buttons, captures the decision, and updates the row state.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['team', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AirtableIcon,
      title: 'Airtable digest reporter',
      prompt:
        'Build a scheduled weekly workflow that summarizes activity in a chosen Airtable base — new rows, status changes, completed items — and emails a digest to the project owner.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: AirtableIcon,
      title: 'Airtable to data-warehouse sync',
      prompt:
        'Create a scheduled workflow that exports an Airtable base to BigQuery nightly with schema mapping, partitions by ingestion date, and writes the run history to a control table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['sync', 'enterprise'],
      alsoIntegrations: ['google_bigquery'],
    },

    {
      icon: AirtableIcon,
      title: 'Trigger Gmail from Airtable records',
      prompt:
        'Build a workflow that watches Airtable for new or updated records and sends a personalised Gmail message for each one, so outreach and follow-ups go out automatically.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication'],
      featured: true,
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'sync-records-to-table',
      description:
        'Parse incoming emails, forms, or documents and create or update structured Airtable records.',
      content:
        '# Sync Records to Airtable\n\nTurn unstructured inbound data into clean Airtable records.\n\n## Steps\n1. Read the source content (email body, form payload, or document text).\n2. Extract the fields that map to the target table columns (name, email, company, amount, status, etc.).\n3. Search the table for an existing record matching a unique key (such as email or order ID).\n4. Update the existing record if found; otherwise create a new one.\n5. Set any derived fields (category, priority, owner) based on the content.\n\n## Output\nReport how many records were created vs updated and list the record IDs. Flag any rows skipped for missing required fields.',
    },
    {
      name: 'triage-and-route-records',
      description:
        'Classify new Airtable records (leads, tickets, requests) and assign owner, priority, and due dates.',
      content:
        '# Triage and Route Records\n\nAutomatically qualify and route new Airtable records.\n\n## Steps\n1. List recently created records in the target table.\n2. For each record, read the free-text fields (notes, message, transcript) and classify intent, urgency, and category.\n3. Set the owner, priority, and status fields based on the classification.\n4. Compute and set a due date for time-sensitive items.\n\n## Output\nSummarize the records triaged grouped by owner and priority. Note any records that need human review.',
    },
    {
      name: 'generate-status-report',
      description:
        'Query an Airtable table or view and produce a rolled-up status report of progress, blockers, and trends.',
      content:
        '# Generate Status Report\n\nBuild a concise report from an Airtable table or view.\n\n## Steps\n1. Read records from the specified table or filtered view.\n2. Group by the relevant dimension (project, status, owner, or stage).\n3. Count totals per group and identify overdue or stalled items.\n4. Highlight notable changes or anomalies in the data.\n\n## Output\nA short report: totals per group, items at risk, and 2-3 takeaways. Keep it scannable with bullet points.',
    },
  ],
} as const satisfies BlockMeta
