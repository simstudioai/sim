import { AgiloftIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'

export const AgiloftBlock: BlockConfig = {
  type: 'agiloft',
  name: 'Agiloft',
  description: 'Manage records in Agiloft CLM',
  longDescription:
    'Integrate with Agiloft contract lifecycle management to create, read, update, delete, and search records. Supports file attachments, SQL-based selection, saved searches, and record locking across any table in your knowledge base.',
  docsLink: 'https://docs.sim.ai/tools/agiloft',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  tags: ['automation'],
  bgColor: '#FFFFFF',
  icon: AgiloftIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Record', id: 'create_record' },
        { label: 'Read Record', id: 'read_record' },
        { label: 'Update Record', id: 'update_record' },
        { label: 'Delete Record', id: 'delete_record' },
        { label: 'Search Records', id: 'search_records' },
        { label: 'Select Records', id: 'select_records' },
        { label: 'Saved Search', id: 'saved_search' },
        { label: 'Attach File', id: 'attach_file' },
        { label: 'Retrieve Attachment', id: 'retrieve_attachment' },
        { label: 'Remove Attachment', id: 'remove_attachment' },
        { label: 'Attachment Info', id: 'attachment_info' },
        { label: 'Lock Record', id: 'lock_record' },
      ],
      value: () => 'search_records',
    },
    {
      id: 'instanceUrl',
      title: 'Instance URL',
      type: 'short-input',
      placeholder: 'https://mycompany.agiloft.com',
      required: true,
      password: false,
    },
    {
      id: 'knowledgeBase',
      title: 'Knowledge Base',
      type: 'short-input',
      placeholder: 'e.g., Demo',
      required: true,
    },
    {
      id: 'login',
      title: 'Login',
      type: 'short-input',
      placeholder: 'Username',
      required: true,
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      placeholder: 'Password',
      password: true,
      required: true,
    },
    {
      id: 'table',
      title: 'Table',
      type: 'short-input',
      placeholder: 'e.g., contracts, contacts.employees',
      required: true,
    },
    {
      id: 'recordId',
      title: 'Record ID',
      type: 'short-input',
      placeholder: 'Record ID',
      condition: {
        field: 'operation',
        value: [
          'read_record',
          'update_record',
          'delete_record',
          'attach_file',
          'retrieve_attachment',
          'remove_attachment',
          'attachment_info',
          'lock_record',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'read_record',
          'update_record',
          'delete_record',
          'attach_file',
          'retrieve_attachment',
          'remove_attachment',
          'attachment_info',
          'lock_record',
        ],
      },
    },
    {
      id: 'data',
      title: 'Record Data',
      type: 'long-input',
      placeholder: '{"field_name": "value", "another_field": "value"}',
      condition: { field: 'operation', value: ['create_record', 'update_record'] },
      required: { field: 'operation', value: ['create_record', 'update_record'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object with the field names and values for an Agiloft record. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: "status='Active' AND company_name~='Acme'",
      condition: { field: 'operation', value: 'search_records' },
      required: { field: 'operation', value: 'search_records' },
      wandConfig: {
        enabled: true,
        prompt:
          "Generate an Agiloft search query. Use field_name='value' for exact match, field_name~='value' for contains, and AND/OR for combining conditions. Return ONLY the query string - no explanations, no extra text.",
      },
    },
    {
      id: 'where',
      title: 'WHERE Clause',
      type: 'short-input',
      placeholder: "summary like '%new%' AND status='Active'",
      condition: { field: 'operation', value: 'select_records' },
      required: { field: 'operation', value: 'select_records' },
      wandConfig: {
        enabled: true,
        prompt:
          "Generate a SQL WHERE clause for an Agiloft EWSelect query using database column names. Use standard SQL syntax (e.g., column='value', column like '%text%'). Return ONLY the WHERE clause - no explanations, no extra text.",
      },
    },
    {
      id: 'fieldName',
      title: 'Field Name',
      type: 'short-input',
      placeholder: 'e.g., attached_docs',
      condition: {
        field: 'operation',
        value: ['attach_file', 'retrieve_attachment', 'remove_attachment', 'attachment_info'],
      },
      required: {
        field: 'operation',
        value: ['attach_file', 'retrieve_attachment', 'remove_attachment', 'attachment_info'],
      },
    },
    {
      id: 'uploadFile',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'attachFile',
      placeholder: 'Upload file to attach',
      condition: { field: 'operation', value: 'attach_file' },
      mode: 'basic',
      multiple: false,
      required: { field: 'operation', value: 'attach_file' },
    },
    {
      id: 'fileRef',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'attachFile',
      placeholder: 'Reference file from previous block',
      condition: { field: 'operation', value: 'attach_file' },
      mode: 'advanced',
      required: { field: 'operation', value: 'attach_file' },
    },
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Optional name for the attached file',
      condition: { field: 'operation', value: 'attach_file' },
      mode: 'advanced',
    },
    {
      id: 'position',
      title: 'File Position',
      type: 'short-input',
      placeholder: '0',
      condition: {
        field: 'operation',
        value: ['retrieve_attachment', 'remove_attachment'],
      },
      required: {
        field: 'operation',
        value: ['retrieve_attachment', 'remove_attachment'],
      },
    },
    {
      id: 'lockAction',
      title: 'Lock Action',
      type: 'dropdown',
      options: [
        { label: 'Check Status', id: 'check' },
        { label: 'Lock', id: 'lock' },
        { label: 'Unlock', id: 'unlock' },
      ],
      value: () => 'check',
      condition: { field: 'operation', value: 'lock_record' },
      required: { field: 'operation', value: 'lock_record' },
    },
    {
      id: 'fields',
      title: 'Fields',
      type: 'short-input',
      placeholder: 'Comma-separated field names to return',
      mode: 'advanced',
      condition: { field: 'operation', value: ['read_record', 'search_records'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a comma-separated list of Agiloft table field names to include in the response. Return ONLY the comma-separated list - no explanations, no extra text.',
      },
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: '0',
      mode: 'advanced',
      condition: { field: 'operation', value: 'search_records' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '25',
      mode: 'advanced',
      condition: { field: 'operation', value: 'search_records' },
    },
  ],

  tools: {
    access: [
      'agiloft_attach_file',
      'agiloft_attachment_info',
      'agiloft_create_record',
      'agiloft_delete_record',
      'agiloft_lock_record',
      'agiloft_read_record',
      'agiloft_remove_attachment',
      'agiloft_retrieve_attachment',
      'agiloft_saved_search',
      'agiloft_search_records',
      'agiloft_select_records',
      'agiloft_update_record',
    ],
    config: {
      tool: (params) => `agiloft_${params.operation}`,
      params: (params) => {
        const normalizedFile = normalizeFileInput(params.attachFile, {
          single: true,
        })
        if (normalizedFile) {
          params.file = normalizedFile
        }
        return params
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    instanceUrl: { type: 'string', description: 'Agiloft instance URL' },
    knowledgeBase: { type: 'string', description: 'Knowledge base name' },
    login: { type: 'string', description: 'Agiloft username' },
    password: { type: 'string', description: 'Agiloft password' },
    table: { type: 'string', description: 'Table name' },
    recordId: { type: 'string', description: 'Record ID' },
    data: { type: 'string', description: 'Record data as JSON' },
    query: { type: 'string', description: 'Search query' },
    where: { type: 'string', description: 'SQL WHERE clause for select' },
    fieldName: { type: 'string', description: 'Attachment field name' },
    attachFile: { type: 'file', description: 'File to attach' },
    fileName: { type: 'string', description: 'Name for the attached file' },
    position: { type: 'string', description: 'Attachment position index' },
    lockAction: { type: 'string', description: 'Lock action (lock, unlock, check)' },
    fields: { type: 'string', description: 'Fields to return' },
    page: { type: 'string', description: 'Page number' },
    limit: { type: 'string', description: 'Results per page' },
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Record ID',
      condition: {
        field: 'operation',
        value: ['create_record', 'read_record', 'update_record', 'delete_record', 'lock_record'],
      },
    },
    fields: {
      type: 'json',
      description: 'Record field values',
      condition: {
        field: 'operation',
        value: ['create_record', 'read_record', 'update_record'],
      },
    },
    deleted: {
      type: 'boolean',
      description: 'Whether the record was deleted',
      condition: { field: 'operation', value: 'delete_record' },
    },
    records: {
      type: 'json',
      description: 'Array of matching records',
      condition: { field: 'operation', value: 'search_records' },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of matching results',
      condition: {
        field: 'operation',
        value: ['search_records', 'select_records', 'attachment_info'],
      },
    },
    page: {
      type: 'number',
      description: 'Current page number',
      condition: { field: 'operation', value: 'search_records' },
    },
    limit: {
      type: 'number',
      description: 'Results per page',
      condition: { field: 'operation', value: 'search_records' },
    },
    recordIds: {
      type: 'json',
      description: 'Array of record IDs matching the WHERE clause',
      condition: { field: 'operation', value: 'select_records' },
    },
    searches: {
      type: 'json',
      description: 'Array of saved search definitions (name, label, id, description)',
      condition: { field: 'operation', value: 'saved_search' },
    },
    file: {
      type: 'file',
      description: 'Downloaded attachment file',
      condition: { field: 'operation', value: 'retrieve_attachment' },
    },
    attachments: {
      type: 'json',
      description: 'Array of attachment info (position, name, size)',
      condition: { field: 'operation', value: 'attachment_info' },
    },
    recordId: {
      type: 'string',
      description: 'ID of the record the file operation was performed on',
      condition: { field: 'operation', value: ['attach_file', 'remove_attachment'] },
    },
    fieldName: {
      type: 'string',
      description: 'Name of the attachment field',
      condition: { field: 'operation', value: ['attach_file', 'remove_attachment'] },
    },
    fileName: {
      type: 'string',
      description: 'Name of the attached file',
      condition: { field: 'operation', value: 'attach_file' },
    },
    totalAttachments: {
      type: 'number',
      description: 'Total number of files attached in the field',
      condition: { field: 'operation', value: 'attach_file' },
    },
    remainingAttachments: {
      type: 'number',
      description: 'Number of attachments remaining after removal',
      condition: { field: 'operation', value: 'remove_attachment' },
    },
    lockStatus: {
      type: 'string',
      description: 'Lock status (e.g., LOCKED, UNLOCKED)',
      condition: { field: 'operation', value: 'lock_record' },
    },
    lockedBy: {
      type: 'string',
      description: 'Username of the user who locked the record',
      condition: { field: 'operation', value: 'lock_record' },
    },
    lockExpiresInMinutes: {
      type: 'number',
      description: 'Minutes until the lock expires',
      condition: { field: 'operation', value: 'lock_record' },
    },
  },
}
