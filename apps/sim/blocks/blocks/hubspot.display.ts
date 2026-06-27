import { HubspotIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const HubSpotBlockDisplay = {
  type: 'hubspot',
  name: 'HubSpot',
  description: 'Interact with HubSpot CRM or trigger workflows from HubSpot events',
  category: 'tools',
  bgColor: '#FF7A59',
  icon: HubspotIcon,
  iconColor: '#FF7A59',
  longDescription:
    'Integrate HubSpot into your workflow. Manage contacts, companies, deals, tickets, and other CRM objects with powerful automation capabilities. Can be used in trigger mode to start workflows when records are created, updated, a specific property changes, or a contact joins a list.',
  docsLink: 'https://docs.sim.ai/integrations/hubspot',
  integrationType: IntegrationType.Sales,
  triggerAllowed: true,
} satisfies BlockDisplay

export const HubSpotBlockMeta = {
  tags: ['marketing', 'sales-engagement', 'customer-support'],
  url: 'https://www.hubspot.com',
  templates: [
    {
      icon: HubspotIcon,
      title: 'HubSpot deal search',
      prompt:
        'Create a knowledge base connected to my HubSpot account so all deals, contacts, and activity history are automatically synced and searchable. Then build an agent I can ask things like "what happened with the Stripe integration deal?" or "which deals closed last quarter over $50k?" and get answers with HubSpot record links.',
      modules: ['knowledge-base', 'agent'],
      category: 'sales',
      tags: ['sales', 'crm', 'research'],
    },
    {
      icon: HubspotIcon,
      title: 'Win/loss analyzer',
      prompt:
        'Build a workflow that pulls closed deals from HubSpot each week, analyzes patterns in wins vs losses — deal size, industry, sales cycle length, objections — and generates a report file with actionable insights on what to change. Schedule it to run every Monday.',
      modules: ['agent', 'files', 'scheduled', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'analysis', 'reporting'],
    },

    {
      icon: HubspotIcon,
      title: 'Get HubSpot deal alerts in Slack',
      prompt:
        'Build a workflow that watches HubSpot for deal stage changes, new contacts, and revenue milestones, then posts instant Slack notifications to your sales team.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication'],
      featured: true,
      alsoIntegrations: ['slack'],
    },
    {
      icon: HubspotIcon,
      title: 'Send personalised emails from HubSpot events',
      prompt:
        'Build a workflow that triggers whenever a HubSpot contact enters a new lifecycle stage and sends a personalised Gmail message tailored to that stage.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication'],
      featured: true,
      alsoIntegrations: ['gmail'],
    },
    {
      icon: HubspotIcon,
      title: 'HubSpot lead enrichment and dedupe',
      prompt:
        'Build a workflow that on a new HubSpot contact searches for existing duplicates, enriches the record with company size, industry, and verified email, and updates the contact and its associated company with the cleaned data.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'automation', 'enrichment'],
    },
    {
      icon: HubspotIcon,
      title: 'HubSpot pipeline weekly digest',
      prompt:
        'Create a scheduled weekly workflow that lists HubSpot deals by stage, computes movement and at-risk deals with an agent, logs the snapshot to a table, and emails a pipeline summary to the sales leadership team.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'reporting', 'crm'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: HubspotIcon,
      title: 'HubSpot ticket triage',
      prompt:
        'Build a workflow that on a new HubSpot support ticket classifies priority and topic, adds a triage note, associates it with the right company, and posts an alert to the support Slack channel for high-priority cases.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'crm'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: HubspotIcon,
      title: 'Backfill HubSpot contact email history from Gmail',
      prompt:
        'Build a workflow that finds HubSpot contacts in the lead stage with no logged email activity, searches my Gmail for each person’s thread, and logs it back to HubSpot as an email engagement associated with the contact.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'automation'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'upsert-contact',
      description:
        'Find a HubSpot contact by email and update it, or create it if it does not exist.',
      content:
        '# Upsert Contact\n\nKeep a contact record current without creating duplicates.\n\n## Steps\n1. Search contacts by the email address to check if the person already exists.\n2. If a match is found, update the contact with the new property values.\n3. If no match exists, create a new contact with the email and known properties.\n4. Read the contact back to confirm the final property values.\n\n## Output\nReturn the contact ID and whether it was created or updated, along with the properties that were set.',
    },
    {
      name: 'create-deal-for-account',
      description: 'Create a HubSpot deal and associate it with the right company and contact.',
      content:
        '# Create Deal For Account\n\nLog a new opportunity tied to the correct account.\n\n## Steps\n1. Search companies to resolve the company by name or domain; create it if missing.\n2. Search contacts to find the primary contact for the deal.\n3. Create the deal with name, amount, pipeline, and stage, associating it with the company and contact.\n4. Read the deal back to confirm associations and stage.\n\n## Output\nReturn the deal ID, its stage and amount, and the associated company and contact IDs.',
    },
    {
      name: 'triage-support-ticket',
      description:
        'Classify a HubSpot ticket, set priority, and associate it with the correct company.',
      content:
        '# Triage Support Ticket\n\nRoute and prioritize an incoming support ticket.\n\n## Steps\n1. Get the ticket to read its subject and content.\n2. Classify topic and priority from the content.\n3. Update the ticket with the priority and any pipeline stage change.\n4. Search companies to find the requesting account and associate the ticket with it.\n\n## Output\nReturn the ticket ID, assigned priority and topic, and the associated company. Flag high-priority tickets for escalation.',
    },
    {
      name: 'summarize-open-deals',
      description: 'Search HubSpot deals by stage and produce a pipeline summary with totals.',
      content:
        '# Summarize Open Deals\n\nReport on the active sales pipeline.\n\n## Steps\n1. Search deals filtered to open stages, paginating through all results.\n2. Group deals by pipeline stage and capture amount and close date.\n3. Sum amounts per stage and overall, and flag deals with a close date in the past.\n4. Identify the largest deals and any missing key properties.\n\n## Output\nReturn a per-stage breakdown with deal counts and total value, a grand total, and a flagged list of overdue or incomplete deals. Suitable for a sales pipeline review.',
    },
    {
      name: 'build-quote-from-deal',
      description: 'Gather a HubSpot deal and its line items to assemble a quote summary.',
      content:
        '# Build Quote From Deal\n\nCompile the commercial details needed to quote a deal.\n\n## Steps\n1. Get the deal by ID for its name, amount, and stage.\n2. List line items and get details to capture product, quantity, and price for each.\n3. Get the associated quote if one exists, or summarize the line items into a draft quote.\n4. Total the line items and compare against the deal amount, flagging mismatches.\n\n## Output\nReturn the deal summary, an itemized line-item list with totals, and any existing quote reference. Flag discrepancies between the line-item total and the deal amount.',
    },
    {
      name: 'log-email-to-contact',
      description: 'Log an email engagement in HubSpot and associate it with a contact.',
      content:
        '# Log Email To Contact\n\nRecord an email activity on a contact’s timeline.\n\n## Steps\n1. Search contacts by email to resolve the contact ID.\n2. Create an email engagement with hs_timestamp, subject, body, and direction.\n3. Associate the email with the contact (associationTypeId 198, or the default association).\n4. List associations from the contact to emails to confirm the link.\n\n## Output\nReturn the email engagement ID and the associated contact ID.',
    },
    {
      name: 'audit-contacts-missing-activity',
      description: 'Find contacts in a lead stage that have no logged email activity.',
      content:
        '# Audit Contacts Missing Activity\n\nSurface leads with no recorded email history.\n\n## Steps\n1. Get properties for contacts to read the hs_lead_status options and confirm the target stage value.\n2. Search contacts filtered to that lead status, paginating through all results.\n3. For each contact, list associations to emails and flag those with zero associated emails.\n4. Collect the contacts that need follow-up.\n\n## Output\nReturn the list of contact IDs with no logged email activity, ready for backfill.',
    },
    {
      name: 'inspect-property-options',
      description: 'Read the enumeration (picklist) values for a HubSpot property.',
      content:
        '# Inspect Property Options\n\nList the allowed values for a dropdown property.\n\n## Steps\n1. Get properties for the object type (e.g., contacts).\n2. Find the property by name (e.g., lifecyclestage or hs_lead_status).\n3. Read its options array for label/value pairs.\n\n## Output\nReturn the property label and its enumeration options as label/value pairs.',
    },
  ],
} as const satisfies BlockMeta
