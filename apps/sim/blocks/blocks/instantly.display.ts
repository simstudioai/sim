import { InstantlyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const InstantlyBlockDisplay = {
  type: 'instantly',
  name: 'Instantly',
  description: 'Manage Instantly leads, campaigns, emails, and lead lists',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: InstantlyIcon,
  longDescription:
    'Integrate Instantly API V2 into workflows. Create and list leads, manage lead interest status, delete leads in bulk, list and create campaigns, reply to emails, and manage lead lists.',
  docsLink: 'https://docs.sim.ai/integrations/instantly',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay

export const InstantlyBlockMeta = {
  tags: ['sales-engagement', 'email-marketing', 'automation'],
  url: 'https://instantly.ai',
  templates: [
    {
      icon: InstantlyIcon,
      title: 'Instantly lead loader',
      prompt:
        'Build a workflow that reads new prospects from a table and creates each as a lead in the right Instantly campaign, then writes the Instantly lead ID back so the sender table stays in sync.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
    },
    {
      icon: InstantlyIcon,
      title: 'Instantly reply triager',
      prompt:
        'Create a workflow triggered when an Instantly reply is received that classifies intent, updates the lead interest status, and posts a Slack alert for positive replies so reps follow up fast.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: InstantlyIcon,
      title: 'Instantly campaign launcher',
      prompt:
        'Build a workflow that creates a new Instantly campaign from a brief, builds a lead list, loads the prospects, and activates the campaign once the list is ready.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
    },
    {
      icon: InstantlyIcon,
      title: 'Instantly performance report',
      prompt:
        'Create a scheduled weekly workflow that lists Instantly campaigns and emails, computes reply and interest rates per campaign, logs them to a table for trend tracking, and Slacks a summary to the sales team.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: InstantlyIcon,
      title: 'Instantly meeting-booked sync',
      prompt:
        'Build a workflow triggered when an Instantly lead is marked meeting booked that creates or updates the matching HubSpot contact and deal so the CRM reflects pipeline from outbound.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: InstantlyIcon,
      title: 'Hunter + Instantly outbound',
      prompt:
        'Create a workflow that finds verified prospect emails with Hunter, validates each, and loads the deliverable contacts into an active Instantly campaign.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['hunter'],
    },
    {
      icon: InstantlyIcon,
      title: 'Instantly reply router',
      prompt:
        "Build a scheduled workflow that lists new Instantly campaign email replies, classifies each as interested, objection, or out-of-office with an agent, updates the lead's interest status, and posts hot replies to the sales Slack channel for a fast follow-up.",
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation', 'communication'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'add-leads-to-campaign',
      description:
        'Push a batch of prospects into an Instantly campaign as new leads with personalization fields.',
      content:
        '# Add Leads to a Campaign\n\nLoad a set of prospects into an Instantly cold-email campaign so they enter the sending sequence.\n\n## Steps\n1. List campaigns and identify the target campaign by name.\n2. For each prospect, create a lead with email, first name, last name, company, and any custom personalization variables.\n3. Attach each lead to the chosen campaign.\n\n## Output\nReturn how many leads were added, the campaign name, and any rows skipped for missing or invalid emails.',
    },
    {
      name: 'launch-outreach-campaign',
      description: 'Create a cold-email campaign, load a lead list, and activate it for sending.',
      content:
        '# Launch an Outreach Campaign\n\nStand up a new Instantly campaign end to end and start sending.\n\n## Steps\n1. Create a lead list and add the target prospects to it.\n2. Create the campaign with its sending sequence and schedule.\n3. Add the leads to the campaign.\n4. Activate the campaign so sending begins.\n\n## Output\nReturn the campaign name, lead count, and activation status. Confirm the campaign is live.',
    },
    {
      name: 'triage-campaign-replies',
      description: 'Review recent campaign email replies and update each lead interest status.',
      content:
        '# Triage Campaign Replies\n\nProcess inbound replies on a campaign and route each lead by interest.\n\n## Steps\n1. List recent emails for the campaign and identify replies from leads.\n2. Read each reply and classify intent (interested, not interested, out of office, wrong person).\n3. Update the matching lead interest status to reflect the classification.\n4. For interested leads, draft a reply to the email.\n\n## Output\nReturn a summary of replies by category, the leads marked interested, and any drafted responses for review.',
    },
    {
      name: 'campaign-performance-snapshot',
      description:
        'Summarize active campaigns and their leads into a quick outreach performance snapshot.',
      content:
        '# Campaign Performance Snapshot\n\nGive a quick read on how outreach is going across campaigns.\n\n## Steps\n1. List campaigns and note which are active.\n2. For each active campaign, list leads and tally counts by interest status.\n3. Pull recent emails to gauge reply volume.\n\n## Output\nReturn a per-campaign snapshot: total leads, breakdown by interest status, and reply activity, highlighting the top-performing campaign.',
    },
  ],
} as const satisfies BlockMeta
