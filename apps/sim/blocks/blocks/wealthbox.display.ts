import { WealthboxIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const WealthboxBlockDisplay = {
  type: 'wealthbox',
  name: 'Wealthbox',
  description: 'Interact with Wealthbox',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: WealthboxIcon,
  longDescription:
    'Integrate Wealthbox into the workflow. Can read and write notes, read and write contacts, and read and write tasks.',
  docsLink: 'https://docs.sim.ai/integrations/wealthbox',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const WealthboxBlockMeta = {
  tags: ['sales-engagement'],
  url: 'https://www.wealthbox.com',
  templates: [
    {
      icon: WealthboxIcon,
      title: 'Wealthbox CRM mirror',
      prompt:
        'Build a scheduled workflow that reads the Wealthbox contacts and tasks listed by ID in a Sim table, refreshes each row with the latest details, and keeps the table in sync for unified reporting.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'sync'],
    },
    {
      icon: WealthboxIcon,
      title: 'Wealthbox client review prep',
      prompt:
        'Create a workflow that runs the morning of each Wealthbox client meeting, gathers recent emails, notes, and tasks for that client, and emails the advisor a prep brief.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: WealthboxIcon,
      title: 'Wealthbox task auto-creator',
      prompt:
        'Build a workflow that listens for Gmail messages tagged "client action", classifies the action, and creates a matching task on the Wealthbox client record.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: WealthboxIcon,
      title: 'Wealthbox compliance audit',
      prompt:
        'Create a scheduled workflow that reads each Wealthbox contact listed in a tracking table monthly, checks for missing KYC fields or stale notes, and writes a compliance backlog to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'legal'],
    },
    {
      icon: WealthboxIcon,
      title: 'Wealthbox birthday reminder',
      prompt:
        'Build a scheduled workflow that runs daily, reads the Wealthbox contacts tracked in a table to find birthdays in the next 7 days, and emails advisors a reminder with a personalized message draft.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: WealthboxIcon,
      title: 'Wealthbox book-of-business digest',
      prompt:
        'Create a scheduled weekly workflow that reads the contacts and open tasks for each advisor from a tracking table, summarizes the book-of-business activity, and posts the digest to leadership in Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: WealthboxIcon,
      title: 'Wealthbox referral tracker',
      prompt:
        'Build a scheduled workflow that polls Wealthbox notes for new referrals, captures the source and prospect, writes the referral chain into a CRM table, and pings the advisor in Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'log-client-note',
      description: 'Write a note to a Wealthbox contact record to capture meeting or call details.',
      content:
        '# Log a Wealthbox Client Note\n\nRecord a note on a client record so the interaction history stays complete.\n\n## Steps\n1. Use the Write Note operation and select your Wealthbox account.\n2. Select the Contact the note belongs to (or enter the Contact ID in advanced mode).\n3. Write the note Content, summarizing the meeting, call, or decision.\n\n## Output\nReturn the created note with its ID and linked contact so the entry can be referenced later.',
    },
    {
      name: 'create-followup-task',
      description: 'Create a follow-up task on a Wealthbox contact with a title and due date.',
      content:
        '# Create a Wealthbox Follow-up Task\n\nAdd a task to a client record so an advisor follow-up is not missed.\n\n## Steps\n1. Use the Write Task operation and select your Wealthbox account.\n2. Select the Contact the task is for.\n3. Set the Title, the Content describing the work, and a Due Date (natural language like "tomorrow at 2pm" works).\n\n## Output\nReturn the created task with its ID and due date so it can be tracked to completion.',
    },
    {
      name: 'upsert-contact',
      description:
        'Create or read a Wealthbox contact with name, email, and background information.',
      content:
        '# Manage a Wealthbox Contact\n\nAdd a new client or pull an existing client record.\n\n## Steps\n1. To add a client, use the Write Contact operation with First Name, Last Name, and optionally Email Address and Background Information.\n2. To read a client, use the Read Contact operation and select the Contact or enter its Contact ID.\n3. Select your Wealthbox account for either operation.\n\n## Output\nReturn the contact record including name, email, and background info so downstream steps can use it.',
    },
    {
      name: 'prepare-client-brief',
      description:
        'Read a Wealthbox contact plus their recent notes and tasks to build a meeting brief.',
      content:
        '# Prepare a Wealthbox Client Brief\n\nGather everything about a client ahead of a meeting.\n\n## Steps\n1. Use Read Contact with the Contact ID to pull the client profile and background.\n2. Use Read Note to retrieve recent notes for the contact.\n3. Use Read Task to pull open and recent tasks tied to the client.\n4. Have an agent synthesize the records into a concise prep brief.\n\n## Output\nReturn a brief covering the client profile, recent notes, and outstanding tasks, ready to email to the advisor.',
    },
  ],
} as const satisfies BlockMeta
