import { WealthboxIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { WealthboxBlockDisplay } from '@/blocks/blocks/wealthbox.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { WealthboxResponse } from '@/tools/wealthbox/types'

export const WealthboxBlock: BlockConfig<WealthboxResponse> = {
  ...WealthboxBlockDisplay,
  authMode: AuthMode.OAuth,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Read Note', id: 'read_note' },
        { label: 'Write Note', id: 'write_note' },
        { label: 'Read Contact', id: 'read_contact' },
        { label: 'Write Contact', id: 'write_contact' },
        { label: 'Read Task', id: 'read_task' },
        { label: 'Write Task', id: 'write_task' },
      ],
      value: () => 'read_note',
    },
    {
      id: 'credential',
      title: 'Wealthbox Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'wealthbox',
      requiredScopes: getScopesForService('wealthbox'),
      placeholder: 'Select Wealthbox account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Wealthbox Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'noteId',
      title: 'Note ID',
      type: 'short-input',
      placeholder: 'Enter Note ID (optional)',
      condition: { field: 'operation', value: ['read_note'] },
    },
    {
      id: 'contactId',
      title: 'Select Contact',
      type: 'file-selector',
      serviceId: 'wealthbox',
      selectorKey: 'wealthbox.contacts',
      requiredScopes: getScopesForService('wealthbox'),
      placeholder: 'Enter Contact ID',
      mode: 'basic',
      canonicalParamId: 'contactId',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: ['read_contact', 'write_task', 'write_note'] },
    },
    {
      id: 'manualContactId',
      title: 'Contact ID',
      type: 'short-input',
      canonicalParamId: 'contactId',
      placeholder: 'Enter Contact ID',
      mode: 'advanced',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: ['read_contact', 'write_task', 'write_note'] },
    },
    {
      id: 'taskId',
      title: 'Task ID',
      type: 'short-input',
      placeholder: 'Enter Task ID',
      condition: { field: 'operation', value: ['read_task'] },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Enter Title',
      condition: { field: 'operation', value: ['write_task'] },
      required: true,
    },
    {
      id: 'dueDate',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'Enter due date (e.g., 2015-05-24 11:00 AM -0400)',
      condition: { field: 'operation', value: ['write_task'] },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a date/time string based on the user's description.
The format should be: YYYY-MM-DD HH:MM AM/PM ZZZZ (e.g., 2015-05-24 11:00 AM -0400).
Examples:
- "tomorrow at 2pm" -> Calculate tomorrow's date at 02:00 PM with local timezone offset
- "next Monday at 9am" -> Calculate next Monday at 09:00 AM with local timezone offset
- "in 3 days at noon" -> Calculate 3 days from now at 12:00 PM with local timezone offset

Return ONLY the date/time string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the due date (e.g., "tomorrow at 2pm", "next Friday morning")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'Enter First Name',
      condition: { field: 'operation', value: ['write_contact'] },
      required: true,
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Enter Last Name',
      condition: { field: 'operation', value: ['write_contact'] },
      required: true,
    },
    {
      id: 'emailAddress',
      title: 'Email Address',
      type: 'short-input',
      placeholder: 'Enter Email Address',
      condition: { field: 'operation', value: ['write_contact'] },
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Enter Content',
      condition: { field: 'operation', value: ['write_note', 'write_event', 'write_task'] },
      required: true,
    },
    {
      id: 'backgroundInformation',
      title: 'Background Information',
      type: 'long-input',
      placeholder: 'Enter Background Information',
      condition: { field: 'operation', value: ['write_contact'] },
    },
  ],
  tools: {
    access: [
      'wealthbox_read_note',
      'wealthbox_write_note',
      'wealthbox_read_contact',
      'wealthbox_write_contact',
      'wealthbox_read_task',
      'wealthbox_write_task',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read_note':
            return 'wealthbox_read_note'
          case 'write_note':
            return 'wealthbox_write_note'
          case 'read_contact':
            return 'wealthbox_read_contact'
          case 'write_contact':
            return 'wealthbox_write_contact'
          case 'read_task':
            return 'wealthbox_read_task'
          case 'write_task':
            return 'wealthbox_write_task'
          default:
            throw new Error(`Unknown operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { oauthCredential, operation, contactId, taskId, ...rest } = params

        // contactId is the canonical param for both basic (file-selector) and advanced (manualContactId) modes
        const effectiveContactId = contactId ? String(contactId).trim() : ''

        const baseParams = {
          ...rest,
          credential: oauthCredential,
        }

        if (operation === 'read_note' || operation === 'write_note') {
          return {
            ...baseParams,
            noteId: params.noteId,
            contactId: effectiveContactId,
          }
        }
        if (operation === 'read_contact') {
          if (!effectiveContactId) {
            throw new Error('Contact ID is required for contact operations')
          }
          return {
            ...baseParams,
            contactId: effectiveContactId,
          }
        }
        if (operation === 'read_task') {
          if (!taskId?.trim()) {
            throw new Error('Task ID is required for task operations')
          }
          return {
            ...baseParams,
            taskId: taskId.trim(),
          }
        }
        if (operation === 'write_task' || operation === 'write_note') {
          if (!contactId?.trim()) {
            throw new Error('Contact ID is required for this operation')
          }
          return {
            ...baseParams,
            contactId: contactId.trim(),
          }
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Wealthbox access token' },
    noteId: { type: 'string', description: 'Note identifier' },
    contactId: { type: 'string', description: 'Contact identifier' },
    taskId: { type: 'string', description: 'Task identifier' },
    content: { type: 'string', description: 'Content text' },
    firstName: { type: 'string', description: 'First name' },
    lastName: { type: 'string', description: 'Last name' },
    emailAddress: { type: 'string', description: 'Email address' },
    backgroundInformation: { type: 'string', description: 'Background information' },
    title: { type: 'string', description: 'Task title' },
    dueDate: { type: 'string', description: 'Due date' },
  },
  outputs: {
    note: {
      type: 'json',
      description: 'Single note object with ID, content, creator, and linked contacts',
    },
    notes: { type: 'json', description: 'Array of note objects from bulk read operations' },
    contact: {
      type: 'json',
      description: 'Single contact object with name, email, phone, and background info',
    },
    contacts: { type: 'json', description: 'Array of contact objects from bulk read operations' },
    task: {
      type: 'json',
      description: 'Single task object with name, due date, description, and priority',
    },
    tasks: { type: 'json', description: 'Array of task objects from bulk read operations' },
    metadata: {
      type: 'json',
      description: 'Operation metadata with itemId, noteId, contactId, taskId, itemType',
    },
    success: {
      type: 'boolean',
      description: 'Boolean indicating whether the operation completed successfully',
    },
  },
}

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
