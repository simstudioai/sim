import { WealthboxIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { WealthboxResponse } from '@/tools/wealthbox/types'

export const WealthboxBlock: BlockConfig<WealthboxResponse> = {
  type: 'wealthbox',
  name: 'Wealthbox',
  description: 'Interact with Wealthbox',
  longDescription:
    'Integrate Wealthbox into the workflow. Can read and write notes, read and write contacts, and read and write tasks. Requires OAuth.',
  docsLink: 'https://docs.sim.ai/tools/wealthbox',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: WealthboxIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
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
      layout: 'full',
      provider: 'wealthbox',
      serviceId: 'wealthbox',
      requiredScopes: ['login', 'data'],
      placeholder: 'Select Wealthbox account',
      required: true,
    },
    {
      id: 'noteId',
      title: 'Note ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Note ID (optional)',
      condition: { field: 'operation', value: ['read_note'] },
    },
    {
      id: 'contactId',
      title: 'Select Contact',
      type: 'file-selector',
      provider: 'wealthbox',
      serviceId: 'wealthbox',
      requiredScopes: ['login', 'data'],
      layout: 'full',
      placeholder: 'Enter Contact ID',
      mode: 'basic',
      canonicalParamId: 'contactId',
      condition: { field: 'operation', value: ['read_contact', 'write_task', 'write_note'] },
    },
    {
      id: 'manualContactId',
      title: 'Contact ID',
      type: 'short-input',
      layout: 'full',
      canonicalParamId: 'contactId',
      placeholder: 'Enter Contact ID',
      mode: 'advanced',
      condition: { field: 'operation', value: ['read_contact', 'write_task', 'write_note'] },
    },
    {
      id: 'taskId',
      title: 'Task ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Task ID',
      mode: 'basic',
      canonicalParamId: 'taskId',
      condition: { field: 'operation', value: ['read_task'] },
    },
    {
      id: 'manualTaskId',
      title: 'Task ID',
      type: 'short-input',
      layout: 'full',
      canonicalParamId: 'taskId',
      placeholder: 'Enter Task ID',
      mode: 'advanced',
      condition: { field: 'operation', value: ['read_task'] },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Title',
      condition: { field: 'operation', value: ['write_task'] },
      required: true,
    },
    {
      id: 'dueDate',
      title: 'Due Date',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter due date (e.g., 2015-05-24 11:00 AM -0400)',
      condition: { field: 'operation', value: ['write_task'] },
      required: true,
    },
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter First Name',
      condition: { field: 'operation', value: ['write_contact'] },
      required: true,
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Last Name',
      condition: { field: 'operation', value: ['write_contact'] },
      required: true,
    },
    {
      id: 'emailAddress',
      title: 'Email Address',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Email Address',
      condition: { field: 'operation', value: ['write_contact'] },
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter Content',
      condition: { field: 'operation', value: ['write_note', 'write_event', 'write_task'] },
      required: true,
    },
    {
      id: 'backgroundInformation',
      title: 'Background Information',
      type: 'long-input',
      layout: 'full',
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
        const { credential, operation, contactId, manualContactId, taskId, manualTaskId, ...rest } =
          params

        // Handle both selector and manual inputs
        const effectiveContactId = (contactId || manualContactId || '').trim()
        const effectiveTaskId = (taskId || manualTaskId || '').trim()

        const baseParams = {
          ...rest,
          credential,
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
    credential: { type: 'string', description: 'Wealthbox access token' },
    noteId: { type: 'string', description: 'Note identifier' },
    contactId: { type: 'string', description: 'Contact identifier' },
    manualContactId: { type: 'string', description: 'Manual contact identifier' },
    taskId: { type: 'string', description: 'Task identifier' },
    manualTaskId: { type: 'string', description: 'Manual task identifier' },
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
      description: 'Operation metadata including item IDs, types, and operation details',
    },
    success: {
      type: 'boolean',
      description: 'Boolean indicating whether the operation completed successfully',
    },
  },
}
