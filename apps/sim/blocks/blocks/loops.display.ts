import { LoopsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const LoopsBlockDisplay = {
  type: 'loops',
  name: 'Loops',
  description: 'Manage contacts and send emails with Loops',
  category: 'tools',
  bgColor: '#FAFAF9',
  icon: LoopsIcon,
  longDescription:
    'Integrate Loops into the workflow. Create and manage contacts, send transactional emails, and trigger event-based automations.',
  docsLink: 'https://docs.sim.ai/integrations/loops',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay

export const LoopsBlockMeta = {
  tags: ['email-marketing', 'marketing', 'automation'],
  url: 'https://loops.so',
  templates: [
    {
      icon: LoopsIcon,
      title: 'Loops product event tracker',
      prompt:
        'Build a workflow that listens for product events from my tables, sends matching Loops events for each user with structured properties, and updates contact properties so Loops automations can branch on real product behavior.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'product'],
    },
    {
      icon: LoopsIcon,
      title: 'Loops list hygiene',
      prompt:
        'Create a scheduled workflow that reads a Sim table of user activity to find accounts inactive for 90 days, updates each contact in Loops to the dormant user group and unsubscribes them from non-essential mailing lists, and writes a hygiene report to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'analysis'],
    },
    {
      icon: LoopsIcon,
      title: 'Loops onboarding orchestrator',
      prompt:
        'Build a workflow triggered on signup that creates a Loops contact, kicks off the onboarding event sequence, and updates user group as the user completes activation steps so the right Loops email goes out at every milestone.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'communication'],
    },
    {
      icon: LoopsIcon,
      title: 'Loops contact property enricher',
      prompt:
        'Create a scheduled workflow that reads a Sim table of contacts missing key custom properties, enriches each one using Clay or web research, updates the matching contact in Loops with the new properties, and tracks enrichment coverage in a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'crm', 'sync'],
      alsoIntegrations: ['clay'],
    },
    {
      icon: LoopsIcon,
      title: 'Loops signup welcome flow',
      prompt:
        'Build a workflow that on a new product signup creates the contact in Loops with their plan and source, sends a transactional welcome email, and fires a signup event so the onboarding campaign starts automatically.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'communication'],
    },
    {
      icon: LoopsIcon,
      title: 'Loops milestone event sender',
      prompt:
        'Create a workflow that watches product usage in a table for key milestones — first integration, team invite, plan upgrade — and sends the matching Loops event for each so lifecycle emails fire on real behavior instead of guesses.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'product'],
    },
    {
      icon: LoopsIcon,
      title: 'Loops churn win-back',
      prompt:
        'Build a scheduled workflow that reads a Sim table of product-usage data to identify users who have gone inactive, sends each a personalized transactional win-back email through Loops, fires a re-engagement event, and logs who was contacted to a table for follow-up.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'communication'],
    },
  ],
  skills: [
    {
      name: 'onboard-new-contact',
      description: 'Create a Loops contact on signup and send a transactional welcome email.',
      content:
        '# Onboard New Contact\n\nAdd a new signup to Loops and welcome them.\n\n## Steps\n1. Create Contact with the email, first and last name, and any source or user group, plus custom properties like plan.\n2. Send Transactional Email using the welcome template ID, passing the contact data as data variables.\n3. Optionally Send Event with a signup event name so any onboarding automation begins.\n\n## Output\nThe created contact ID, confirmation the welcome email was sent, and any event fired.',
    },
    {
      name: 'send-product-event',
      description:
        'Fire a Loops event for a user with structured properties to trigger lifecycle automations.',
      content:
        '# Send Product Event\n\nDrive Loops automations from real product behavior.\n\n## Steps\n1. Identify the contact by email or user ID and the event that occurred.\n2. Build event properties as a JSON object with the relevant values, such as plan and amount.\n3. Send Event with the event name, the contact identifier, and the properties.\n4. Optionally update mailing list subscriptions in the same call.\n\n## Output\nConfirmation the event was sent, the contact it was attributed to, and the properties included.',
    },
    {
      name: 'enrich-contact-properties',
      description:
        'Find a Loops contact and update it with enriched custom properties and user group.',
      content:
        '# Enrich Contact Properties\n\nKeep Loops contact data complete and current.\n\n## Steps\n1. Find Contact by email or user ID to read existing fields and spot gaps.\n2. Gather the missing or stale values from your source or research.\n3. Update Contact with the new custom properties, user group, and any name fields.\n\n## Output\nThe updated contact ID and a summary of the properties that were set or changed.',
    },
    {
      name: 'send-transactional-email',
      description:
        'Send a Loops transactional email from a template with personalized data variables.',
      content:
        '# Send Transactional Email\n\nDeliver a templated transactional email through Loops.\n\n## Steps\n1. Confirm the transactional email template ID to use.\n2. Build the data variables JSON to match the variable names in the template, such as name and a confirmation URL.\n3. Send Transactional Email with the recipient email, template ID, and data variables, attaching files if needed.\n\n## Output\nConfirmation of send success and the template ID and recipient used.',
    },
  ],
} as const satisfies BlockMeta
