import { WealthboxIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { WealthboxResponse } from '@/tools/wealthbox/types'

export const WealthboxBlock: BlockConfig<WealthboxResponse> = {
  type: 'wealthbox',
  name: 'Wealthbox',
  description: 'Interact with Wealthbox',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Wealthbox into the workflow. Can read and write notes, read and write contacts, and read and write tasks.',
  docsLink: 'https://docs.sim.ai/tools/wealthbox',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#FFFFFF',
  icon: WealthboxIcon,
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
  tags: ['sales-engagement', 'customer-support'],
  templates: [
    {
      icon: WealthboxIcon,
      title: 'Wealthbox CRM mirror',
      prompt:
        'Build a scheduled workflow that mirrors Wealthbox contacts and tasks into a Sim table for unified reporting alongside other sales-pipeline data.',
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
        'Create a scheduled workflow that audits Wealthbox client records monthly for missing KYC fields or stale notes and writes a compliance backlog to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'legal'],
    },
    {
      icon: WealthboxIcon,
      title: 'Wealthbox birthday reminder',
      prompt:
        'Build a scheduled workflow that runs daily, surfaces Wealthbox client birthdays for the next 7 days, and emails advisors a reminder with a personalized message draft.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: WealthboxIcon,
      title: 'Wealthbox book-of-business digest',
      prompt:
        'Create a scheduled weekly workflow that summarizes Wealthbox book-of-business metrics by advisor, writes a digest table, and posts the summary to leadership.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: WealthboxIcon,
      title: 'Wealthbox referral tracker',
      prompt:
        'Build a workflow that watches Wealthbox for new referral notes, captures the source and prospect, writes the referral chain into a CRM table, and pings the advisor.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['slack'],
    },
  ],
} as const satisfies BlockMeta
