import { PipedriveIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const PipedriveBlockDisplay = {
  type: 'pipedrive',
  name: 'Pipedrive',
  description: 'Interact with Pipedrive CRM',
  category: 'tools',
  bgColor: '#2E6936',
  icon: PipedriveIcon,
  iconColor: '#26A65B',
  longDescription:
    'Integrate Pipedrive into your workflow. Manage deals, contacts, sales pipeline, projects, activities, files, and communications with powerful CRM capabilities.',
  docsLink: 'https://docs.sim.ai/integrations/pipedrive',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const PipedriveBlockMeta = {
  tags: ['sales-engagement', 'project-management'],
  url: 'https://www.pipedrive.com',
  templates: [
    {
      icon: PipedriveIcon,
      title: 'Pipedrive deal pipeline tracker',
      prompt:
        'Create a scheduled workflow that mirrors Pipedrive deals into a Sim table, calculates pipeline velocity per stage, and posts a daily Slack summary of deals at risk.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PipedriveIcon,
      title: 'Pipedrive lead enrichment pipeline',
      prompt:
        'Build a scheduled workflow that polls Pipedrive for new leads, enriches each via Apollo with role, seniority, and tech stack, and updates the lead with the enriched details.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'research'],
      alsoIntegrations: ['apollo'],
    },
    {
      icon: PipedriveIcon,
      title: 'Pipedrive activity-from-email logger',
      prompt:
        'Create a workflow that watches Gmail for emails to or from Pipedrive contacts, logs each as an activity, and creates a follow-up task if next steps are mentioned.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: PipedriveIcon,
      title: 'Pipedrive call-summary updater',
      prompt:
        'Build a workflow that runs after a Fireflies sales call, summarizes the transcript, and updates the matching Pipedrive deal with the call summary and next steps.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['fireflies'],
    },
    {
      icon: PipedriveIcon,
      title: 'Pipedrive win/loss analyzer',
      prompt:
        'Create a scheduled monthly workflow that pulls closed Pipedrive deals, analyzes patterns in wins vs losses, and writes an insights report file for the sales team.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'analysis'],
    },
    {
      icon: PipedriveIcon,
      title: 'Pipedrive renewal forecast',
      prompt:
        'Build a workflow that pulls Pipedrive customer renewals due in the next 90 days, generates a personalized renewal-prep brief, and emails the account owner.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: PipedriveIcon,
      title: 'Pipedrive Slack channel-per-deal',
      prompt:
        'Create a workflow that for Pipedrive deals above a threshold creates a Slack channel, invites the account team, and pins the deal record link.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'create-deal',
      description:
        'Create a Pipedrive deal with a title, value, pipeline stage, and linked person or organization.',
      content:
        '# Create Deal\n\nAdd a new opportunity to the sales pipeline.\n\n## Steps\n1. Use the Create Deal operation with a clear Title.\n2. Set Value and Currency, the target Pipeline and Stage ID, and Status (open, won, or lost).\n3. Link the deal to a Person ID or Organization ID, and set an Expected Close Date.\n4. Capture the returned deal ID for follow-up activities.\n\n## Output\nConfirm the new deal title, value, pipeline stage, and ID so it can be referenced in later steps.',
    },
    {
      name: 'review-pipeline',
      description:
        'List Pipedrive deals in a pipeline and summarize stage distribution and deals at risk.',
      content:
        '# Review Pipeline\n\nGet a snapshot of the current sales pipeline.\n\n## Steps\n1. Use Get All Deals (or Get Pipeline Deals for one pipeline) filtered to open status.\n2. Optionally scope by Pipeline, Person ID, or Organization ID and set Updated Since to focus on recent movement.\n3. Group deals by stage and total their value, flagging stale deals with no recent update.\n4. Page with the cursor or start offset for large pipelines.\n\n## Output\nA stage-by-stage breakdown with deal counts and total value, plus a short list of at-risk deals that have gone quiet.',
    },
    {
      name: 'log-activity',
      description:
        'Create a Pipedrive activity such as a call, meeting, or task linked to a deal or contact.',
      content:
        '# Log Activity\n\nSchedule or record follow-up work against a record.\n\n## Steps\n1. Use the Create Activity operation with a Subject and an activity Type (call, meeting, task, deadline, email, or lunch).\n2. Set the Due Date and optional Due Time, Duration, and Notes.\n3. Link the activity to the relevant Deal ID, Person ID, or Organization ID.\n4. Use Update Activity later to mark it done.\n\n## Output\nConfirm the activity subject, type, due date, and the record it is linked to.',
    },
    {
      name: 'manage-leads',
      description:
        'Create or update Pipedrive leads with value, contacts, and expected close date.',
      content:
        '# Manage Leads\n\nCapture and maintain top-of-funnel leads.\n\n## Steps\n1. Use Create Lead with a Title and link a Person ID or Organization ID and an Owner ID.\n2. Set the Value Amount and Value Currency and an Expected Close Date.\n3. Use Update Lead to revise details or archive a lead once it converts or goes cold.\n4. Use Get Leads to review active or archived leads.\n\n## Output\nThe lead title, linked contact, value, and current state (active or archived) with its ID.',
    },
  ],
} as const satisfies BlockMeta
