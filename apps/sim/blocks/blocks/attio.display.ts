import { AttioIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const AttioBlockDisplay = {
  type: 'attio',
  name: 'Attio',
  description: 'Manage records, notes, tasks, lists, comments, and more in Attio CRM',
  category: 'tools',
  bgColor: '#1D1E20',
  icon: AttioIcon,
  longDescription:
    'Connect to Attio to manage CRM records (people, companies, custom objects), notes, tasks, lists, list entries, comments, workspace members, and webhooks.',
  docsLink: 'https://docs.sim.ai/integrations/attio',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const AttioBlockMeta = {
  tags: ['sales-engagement', 'enrichment'],
  url: 'https://attio.com',
  templates: [
    {
      icon: AttioIcon,
      title: 'Attio enrichment pipeline',
      prompt:
        'Build a workflow that watches new Attio records, enriches each contact with company size, funding, and tech stack via Apollo, and writes the enriched fields back to Attio.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'research'],
      alsoIntegrations: ['apollo'],
    },
    {
      icon: AttioIcon,
      title: 'Attio deal pipeline tracker',
      prompt:
        'Create a scheduled workflow that mirrors Attio deals into a Sim table, calculates pipeline velocity per stage, and posts a daily Slack summary of deals at risk.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AttioIcon,
      title: 'Attio email-to-record logger',
      prompt:
        'Build a workflow that watches Gmail for emails to or from Attio contacts, logs each as an interaction on the matching record, and creates a follow-up task if mentioned.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: AttioIcon,
      title: 'Attio call-summary updater',
      prompt:
        'Create a workflow that runs after a Fireflies sales call, summarizes the transcript into a deal-ready summary, and updates the matching Attio deal record.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['fireflies'],
    },
    {
      icon: AttioIcon,
      title: 'Attio win/loss analyzer',
      prompt:
        'Build a scheduled monthly workflow that pulls closed Attio deals, analyzes patterns in wins vs losses, and writes an insights report file for the sales team.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'analysis'],
    },
    {
      icon: AttioIcon,
      title: 'Attio outreach orchestrator',
      prompt:
        'Create a workflow that watches Attio for contacts entering the outreach stage, drafts a personalized first-touch email, and queues it for the rep to review and send.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: AttioIcon,
      title: 'Attio Slack channel-per-deal',
      prompt:
        'Build a workflow that for Attio deals above a threshold creates a Slack channel, invites the account team, and pins the deal record link.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'upsert-record',
      description:
        'Create or update a person, company, or deal record in Attio, matching on a key field to avoid duplicates. Use to sync external data into the CRM.',
      content:
        '# Upsert Record\n\nKeep an Attio record in sync without creating duplicates.\n\n## Steps\n1. Identify the target object (people, companies, or a custom object) and the matching attribute, such as email or domain.\n2. Assemble the record values to set.\n3. Use assert record to upsert on the matching attribute so an existing record is updated and a new one is created only when needed.\n4. Verify the resulting record by getting it back.\n\n## Output\nReport whether the record was created or updated and its record ID.',
    },
    {
      name: 'log-note-on-record',
      description:
        'Attach a note to an Attio record capturing a call, meeting, or update. Use to keep CRM context current after interactions.',
      content:
        '# Log Note on Record\n\nRecord context against the right Attio record.\n\n## Steps\n1. Find the target record — by ID, or search records to locate it by name or domain.\n2. Compose the note title and body summarizing the interaction or update.\n3. Create the note on that record.\n4. Optionally create a follow-up task if next steps were agreed.\n\n## Output\nConfirm the record the note was attached to and the note ID, plus any follow-up task created.',
    },
    {
      name: 'create-followup-task',
      description:
        'Create a task in Attio linked to a record with an owner and due date. Use to capture follow-ups and next steps from deals or conversations.',
      content:
        '# Create Follow-up Task\n\nTurn a next step into a tracked Attio task.\n\n## Steps\n1. Identify the related record and the work to be done.\n2. Determine the assignee and a due date.\n3. Create the task with a clear description, linked record, owner, and deadline.\n4. Confirm the task was created against the right record.\n\n## Output\nReport the created task ID, the linked record, assignee, and due date.',
    },
    {
      name: 'manage-list-pipeline',
      description:
        'Query and update entries in an Attio list to move records through a pipeline or segment. Use for managing deal stages and curated segments.',
      content:
        '# Manage List Pipeline\n\nMove records through an Attio list-based pipeline.\n\n## Steps\n1. Resolve the target list, then query list entries to see current state.\n2. Identify which entries need to change stage or attributes.\n3. Create, update, or remove list entries as needed to reflect the new state.\n4. Summarize the pipeline distribution after the changes.\n\n## Output\nReport which entries moved and their new stage, plus the resulting count of records per stage.',
    },
  ],
} as const satisfies BlockMeta
