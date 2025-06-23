import { WealthboxIcon } from '@/components/icons'
import type {
    WealthboxReadResponse,
    WealthboxWriteResponse,
} from '@/tools/wealthbox/types'
import type { BlockConfig } from '../types'

type WealthboxResponse =
  | WealthboxReadResponse
  | WealthboxWriteResponse

export const WealthboxBlock: BlockConfig<WealthboxResponse> = {
  type: 'wealthbox',
  name: 'Wealthbox',
  description: 'Interact with Wealthbox',
  longDescription:
    'Integrate Wealthbox functionality to manage notes, contacts, and tasks. Read content from existing notes, contacts, and tasks and write to them using OAuth authentication. Supports text content manipulation for note creation and editing.',
  docsLink: 'https://docs.simstudio.ai/tools/wealthbox',
  category: 'tools',
  bgColor: '#106ED4',
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
      },
      {
        id: 'credential',
        title: 'Wealthbox Account',
        type: 'oauth-input',
        layout: 'full',
        provider: 'wealthbox',
        serviceId: 'wealthbox',
        requiredScopes: [
            //TODO: Add required scopes
        ],
        placeholder: 'Select Wealthbox account',
      },
      {
        id: 'noteId',
        title: 'Select Note',
        type: 'file-selector',
        provider: 'wealthbox',
        serviceId: 'wealthbox',
        requiredScopes: [],
        layout: 'full',
        placeholder: 'Select the note to read',
        condition: { field: 'operation', value: ['read_note', 'write_note'] },
      },
      {
        id: 'contactId',
        title: 'Select Contact',
        type: 'file-selector',
        provider: 'wealthbox',
        serviceId: 'wealthbox',
        requiredScopes: [],
        layout: 'full',
        placeholder: 'Enter Contact ID',
        condition: { field: 'operation', value: ['read_contact', 'write_task'] },
      },
      {
        id: 'taskId',
        title: 'Select Task',
        type: 'file-selector',
        provider: 'wealthbox',
        serviceId: 'wealthbox',
        requiredScopes: [],
        layout: 'full',
        placeholder: 'Enter Task ID',
        condition: { field: 'operation', value: ['read_task'] },
      },
      {
        id: 'title',
        title: 'Title',
        type: 'short-input',
        layout: 'full',
        placeholder: 'Enter Title',
        condition: { field: 'operation', value: ['write_task'] },
      },
      {
        id: 'time',
        title: 'Due Time',
        type: 'time-input',
        layout: 'full',
        placeholder: 'Enter Due Date',
        condition: { field: 'operation', value: ['write_task'] },
      },
      {
        id: 'date',
        title: 'Due Date',
        type: 'date-input',
        layout: 'full',
        placeholder: 'Enter Due Date',
        condition: { field: 'operation', value: ['write_task'] },
      },
      {
        id: 'firstName',
        title: 'First Name',
        type: 'short-input',
        layout: 'full',
        placeholder: 'Enter First Name',
        condition: { field: 'operation', value: ['write_contact'] },
      },
      {
        id: 'lastName',
        title: 'Last Name',
        type: 'short-input',
        layout: 'full',
        placeholder: 'Enter Last Name',
        condition: { field: 'operation', value: ['write_contact'] },
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
        const { credential, operation, ...rest } = params

        // Build the parameters based on operation type
        const baseParams = {
          ...rest,
          credential,
        }

        // For note operations, we need noteId
        if (operation === 'read_note' || operation === 'write_note') {
          if (!params.noteId) {
            throw new Error('Note ID is required for note operations')
          }
          return {
            ...baseParams,
            noteId: params.noteId,
          }
        }

        // For contact operations, we need contactId
        if (operation === 'read_contact' || operation === 'read_note') {
          if (!params.contactId) {
            throw new Error('Contact ID is required for contact operations')
          }
          return {
            ...baseParams,
            contactId: params.contactId,
          }
        }

        // For task operations, we need taskId
        if (operation === 'read_task') {
          if (!params.taskId) {
            throw new Error('Task ID is required for task operations')
          }
          return {
            ...baseParams,
            taskId: params.taskId,
          }
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    noteId: { type: 'string', required: false },
    contactId: { type: 'string', required: false },
    taskId: { type: 'string', required: false },
    content: { type: 'string', required: true },
    firstName: { type: 'string', required: true },
    lastName: { type: 'string', required: true },
    emailAddress: { type: 'string', required: false },
    backgroundInformation: { type: 'string', required: false },
    title: { type: 'string', required: true },
    time: { type: 'string', required: true },
    date: { type: 'string', required: true },
  },
  outputs: {
    response: {
      type: {
        note: 'any',
        notes: 'any',
        contact: 'any',
        contacts: 'any',
        task: 'any',
        tasks: 'any',
        metadata: 'json',
        success: 'any'
      },
    },
  },
}