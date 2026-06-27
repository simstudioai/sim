import { PersonaBlockDisplay } from '@/blocks/blocks/persona.display'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { PersonaResponse } from '@/tools/persona/types'

export const PersonaBlock: BlockConfig<PersonaResponse> = {
  ...PersonaBlockDisplay,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Inquiry', id: 'create_inquiry' },
        { label: 'Get Inquiry', id: 'get_inquiry' },
        { label: 'List Inquiries', id: 'list_inquiries' },
        { label: 'Update Inquiry', id: 'update_inquiry' },
        { label: 'Approve Inquiry', id: 'approve_inquiry' },
        { label: 'Decline Inquiry', id: 'decline_inquiry' },
        { label: 'Mark Inquiry for Review', id: 'mark_inquiry_for_review' },
        { label: 'Resume Inquiry', id: 'resume_inquiry' },
        { label: 'Expire Inquiry', id: 'expire_inquiry' },
        { label: 'Generate Inquiry Link', id: 'generate_inquiry_link' },
        { label: 'Print Inquiry PDF', id: 'print_inquiry_pdf' },
        { label: 'Redact Inquiry', id: 'redact_inquiry' },
        { label: 'Create Account', id: 'create_account' },
        { label: 'Get Account', id: 'get_account' },
        { label: 'List Accounts', id: 'list_accounts' },
        { label: 'Update Account', id: 'update_account' },
        { label: 'Import Accounts (CSV)', id: 'import_accounts' },
        { label: 'Redact Account', id: 'redact_account' },
        { label: 'List Cases', id: 'list_cases' },
        { label: 'Get Case', id: 'get_case' },
        { label: 'Create Report', id: 'create_report' },
        { label: 'Get Report', id: 'get_report' },
        { label: 'List Reports', id: 'list_reports' },
        { label: 'Get Verification', id: 'get_verification' },
        { label: 'Get Document', id: 'get_document' },
        { label: 'List Inquiry Templates', id: 'list_inquiry_templates' },
      ],
      value: () => 'create_inquiry',
    },
    {
      id: 'inquiryTemplateId',
      title: 'Inquiry Template ID',
      type: 'short-input',
      placeholder: 'itmpl_ABC123',
      condition: { field: 'operation', value: 'create_inquiry' },
      required: true,
    },
    {
      id: 'inquiryId',
      title: 'Inquiry ID',
      type: 'short-input',
      placeholder: 'inq_ABC123',
      condition: {
        field: 'operation',
        value: [
          'get_inquiry',
          'update_inquiry',
          'approve_inquiry',
          'decline_inquiry',
          'mark_inquiry_for_review',
          'resume_inquiry',
          'expire_inquiry',
          'generate_inquiry_link',
          'print_inquiry_pdf',
          'redact_inquiry',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_inquiry',
          'update_inquiry',
          'approve_inquiry',
          'decline_inquiry',
          'mark_inquiry_for_review',
          'resume_inquiry',
          'expire_inquiry',
          'generate_inquiry_link',
          'print_inquiry_pdf',
          'redact_inquiry',
        ],
      },
    },
    {
      id: 'accountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'act_ABC123',
      condition: {
        field: 'operation',
        value: [
          'create_inquiry',
          'get_account',
          'update_account',
          'redact_account',
          'list_inquiries',
          'list_cases',
          'create_report',
          'list_reports',
        ],
      },
      required: {
        field: 'operation',
        value: ['get_account', 'update_account', 'redact_account'],
      },
    },
    {
      id: 'referenceId',
      title: 'Reference ID',
      type: 'short-input',
      placeholder: 'ID of this user in your system',
      condition: {
        field: 'operation',
        value: [
          'create_inquiry',
          'create_account',
          'update_account',
          'list_inquiries',
          'list_accounts',
          'list_cases',
          'list_reports',
        ],
      },
    },
    {
      id: 'fields',
      title: 'Fields',
      type: 'long-input',
      placeholder: '{"name-first": "Jane", "name-last": "Doe"}',
      condition: {
        field: 'operation',
        value: ['create_inquiry', 'update_inquiry', 'create_account', 'update_account'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of Persona field name to field value pairs (e.g. {"name-first": "Jane", "name-last": "Doe", "email-address": "jane@example.com"}). Field names are defined by the inquiry template or account type. Return ONLY the JSON object.',
        generationType: 'json-object',
        placeholder: 'Describe the fields to pre-fill...',
      },
    },
    {
      id: 'note',
      title: 'Note',
      type: 'short-input',
      placeholder: 'Free-form note for the inquiry',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_inquiry', 'update_inquiry'] },
    },
    {
      id: 'redirectUri',
      title: 'Redirect URI',
      type: 'short-input',
      placeholder: 'https://example.com/verified',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_inquiry', 'update_inquiry'] },
    },
    {
      id: 'expiresInSeconds',
      title: 'Link Expiry (Seconds)',
      type: 'short-input',
      placeholder: '3600',
      mode: 'advanced',
      condition: { field: 'operation', value: 'generate_inquiry_link' },
    },
    {
      id: 'accountTypeId',
      title: 'Account Type ID',
      type: 'short-input',
      placeholder: 'acttp_ABC123',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_account' },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'long-input',
      placeholder: '["vip", "beta-user"]',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_account', 'update_account', 'update_inquiry'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of tag name strings (e.g. ["vip", "beta-user"]). The output must be a JSON array, not an object. Return ONLY the JSON array.',
        placeholder: 'Describe the tags to apply...',
      },
    },
    {
      id: 'importFile',
      title: 'CSV File',
      type: 'file-upload',
      canonicalParamId: 'file',
      acceptedTypes: 'text/csv',
      placeholder: 'Upload a CSV of accounts to import',
      mode: 'basic',
      multiple: false,
      condition: { field: 'operation', value: 'import_accounts' },
      required: true,
    },
    {
      id: 'importFileRef',
      title: 'CSV File Reference',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference a CSV file from a previous block',
      mode: 'advanced',
      condition: { field: 'operation', value: 'import_accounts' },
      required: true,
    },
    {
      id: 'status',
      title: 'Status Filter',
      type: 'short-input',
      placeholder: 'e.g. approved (inquiries) or Open (cases)',
      condition: { field: 'operation', value: ['list_inquiries', 'list_cases'] },
    },
    {
      id: 'createdAtStart',
      title: 'Created After',
      type: 'short-input',
      placeholder: '2024-01-01T00:00:00Z',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_inquiries' },
      wandConfig: {
        enabled: true,
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp string.',
        generationType: 'timestamp',
        placeholder: 'Describe the start of the date range...',
      },
    },
    {
      id: 'createdAtEnd',
      title: 'Created Before',
      type: 'short-input',
      placeholder: '2024-12-31T23:59:59Z',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_inquiries' },
      wandConfig: {
        enabled: true,
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp string.',
        generationType: 'timestamp',
        placeholder: 'Describe the end of the date range...',
      },
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '10',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'list_inquiries',
          'list_accounts',
          'list_cases',
          'list_reports',
          'list_inquiry_templates',
        ],
      },
    },
    {
      id: 'pageAfter',
      title: 'Page After Cursor',
      type: 'short-input',
      placeholder: 'Object ID to paginate after',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'list_inquiries',
          'list_accounts',
          'list_cases',
          'list_reports',
          'list_inquiry_templates',
        ],
      },
    },
    {
      id: 'caseId',
      title: 'Case ID',
      type: 'short-input',
      placeholder: 'case_ABC123',
      condition: { field: 'operation', value: 'get_case' },
      required: true,
    },
    {
      id: 'reportType',
      title: 'Report Type',
      type: 'dropdown',
      options: [
        { label: 'Watchlist', id: 'watchlist' },
        { label: 'Adverse Media', id: 'adverse-media' },
        { label: 'Politically Exposed Person', id: 'politically-exposed-person' },
      ],
      value: () => 'watchlist',
      condition: { field: 'operation', value: 'create_report' },
      required: true,
    },
    {
      id: 'reportTemplateId',
      title: 'Report Template ID',
      type: 'short-input',
      placeholder: 'rptp_ABC123',
      condition: { field: 'operation', value: 'create_report' },
      required: true,
    },
    {
      id: 'term',
      title: 'Search Term',
      type: 'short-input',
      placeholder: 'Jane Q Doe (or use the name fields below)',
      condition: { field: 'operation', value: 'create_report' },
    },
    {
      id: 'nameFirst',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'Jane',
      condition: { field: 'operation', value: 'create_report' },
    },
    {
      id: 'nameMiddle',
      title: 'Middle Name',
      type: 'short-input',
      placeholder: 'Q',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_report' },
    },
    {
      id: 'nameLast',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Doe',
      condition: { field: 'operation', value: 'create_report' },
    },
    {
      id: 'birthdate',
      title: 'Birthdate',
      type: 'short-input',
      placeholder: '1991-10-07',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_report' },
    },
    {
      id: 'countryCode',
      title: 'Country Code',
      type: 'short-input',
      placeholder: 'US',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_account', 'update_account', 'create_report'],
      },
    },
    {
      id: 'reportId',
      title: 'Report ID',
      type: 'short-input',
      placeholder: 'rep_ABC123',
      condition: { field: 'operation', value: 'get_report' },
      required: true,
    },
    {
      id: 'verificationId',
      title: 'Verification ID',
      type: 'short-input',
      placeholder: 'ver_ABC123',
      condition: { field: 'operation', value: 'get_verification' },
      required: true,
    },
    {
      id: 'documentId',
      title: 'Document ID',
      type: 'short-input',
      placeholder: 'doc_ABC123',
      condition: { field: 'operation', value: 'get_document' },
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Persona API key',
      password: true,
      required: true,
    },
  ],

  tools: {
    access: [
      'persona_create_inquiry',
      'persona_get_inquiry',
      'persona_list_inquiries',
      'persona_update_inquiry',
      'persona_approve_inquiry',
      'persona_decline_inquiry',
      'persona_mark_inquiry_for_review',
      'persona_resume_inquiry',
      'persona_expire_inquiry',
      'persona_generate_inquiry_link',
      'persona_print_inquiry_pdf',
      'persona_redact_inquiry',
      'persona_create_account',
      'persona_get_account',
      'persona_list_accounts',
      'persona_update_account',
      'persona_import_accounts',
      'persona_redact_account',
      'persona_list_cases',
      'persona_get_case',
      'persona_create_report',
      'persona_get_report',
      'persona_list_reports',
      'persona_get_verification',
      'persona_get_document',
      'persona_list_inquiry_templates',
    ],
    config: {
      tool: (params) => `persona_${params.operation || 'create_inquiry'}`,
      params: (params) => {
        const result: Record<string, unknown> = {}

        if (params.operation === 'import_accounts') {
          const file = normalizeFileInput(params.file, { single: true })
          if (!file) {
            throw new Error('A CSV file is required to import accounts')
          }
          result.file = file
        }

        if (params.pageSize) {
          result.pageSize = Number(params.pageSize)
        }
        if (params.expiresInSeconds) {
          result.expiresInSeconds = Number(params.expiresInSeconds)
        }

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Persona API key' },
    inquiryTemplateId: {
      type: 'string',
      description: 'Inquiry template ID (itmpl_/itmplv_/tmpl_)',
    },
    inquiryId: { type: 'string', description: 'Inquiry ID (inq_)' },
    accountId: { type: 'string', description: 'Account ID (act_)' },
    referenceId: { type: 'string', description: 'Reference ID in your user model' },
    fields: { type: 'json', description: 'Field name to field value pairs' },
    note: { type: 'string', description: 'Free-form inquiry note' },
    redirectUri: { type: 'string', description: 'Redirect URI after inquiry completion' },
    expiresInSeconds: { type: 'number', description: 'One-time link expiry in seconds' },
    accountTypeId: { type: 'string', description: 'Account type ID (acttp_)' },
    tags: { type: 'json', description: 'Tag names to set on the account or inquiry' },
    file: { type: 'file', description: 'CSV file of accounts to import' },
    status: { type: 'string', description: 'Status filter for list operations' },
    createdAtStart: { type: 'string', description: 'Created-after ISO 8601 filter' },
    createdAtEnd: { type: 'string', description: 'Created-before ISO 8601 filter' },
    pageSize: { type: 'number', description: 'Results per page (1-100)' },
    pageAfter: { type: 'string', description: 'Pagination cursor' },
    caseId: { type: 'string', description: 'Case ID (case_)' },
    reportType: {
      type: 'string',
      description: 'Report type (watchlist, adverse-media, politically-exposed-person)',
    },
    reportTemplateId: { type: 'string', description: 'Report template ID (rptp_)' },
    term: { type: 'string', description: 'Full-name search term for reports' },
    nameFirst: { type: 'string', description: 'First name to screen' },
    nameMiddle: { type: 'string', description: 'Middle name to screen' },
    nameLast: { type: 'string', description: 'Last name to screen' },
    birthdate: { type: 'string', description: 'Birthdate (YYYY-MM-DD)' },
    countryCode: { type: 'string', description: 'ISO 3166-1 alpha-2 country code' },
    reportId: { type: 'string', description: 'Report ID (rep_)' },
    verificationId: { type: 'string', description: 'Verification ID (ver_)' },
    documentId: { type: 'string', description: 'Document ID (doc_)' },
  },

  outputs: {
    inquiry: {
      type: 'json',
      description:
        'Inquiry (id, status, referenceId, note, tags, fields, createdAt, startedAt, completedAt, failedAt, expiredAt, decisionedAt)',
    },
    inquiries: {
      type: 'json',
      description:
        'List of inquiries [{id, status, referenceId, note, tags, fields, createdAt, startedAt, completedAt, failedAt, expiredAt, decisionedAt}]',
    },
    oneTimeLink: { type: 'string', description: 'One-time inquiry link' },
    oneTimeLinkShort: { type: 'string', description: 'Shortened one-time inquiry link' },
    sessionToken: { type: 'string', description: 'Session token from resuming an inquiry' },
    file: { type: 'file', description: 'Inquiry PDF stored in execution files' },
    account: {
      type: 'json',
      description:
        'Account (id, referenceId, accountTypeName, accountStatus, tags, fields, createdAt, updatedAt)',
    },
    accounts: {
      type: 'json',
      description:
        'List of accounts [{id, referenceId, accountTypeName, accountStatus, tags, fields, createdAt, updatedAt}]',
    },
    importer: {
      type: 'json',
      description:
        'Account importer (id, status, successfulCount, errorCount, duplicateCount, createdAt, completedAt)',
    },
    case: {
      type: 'json',
      description:
        'Case (id, status, name, resolution, assigneeId, tags, fields, createdAt, assignedAt, resolvedAt)',
    },
    cases: {
      type: 'json',
      description:
        'List of cases [{id, status, name, resolution, assigneeId, tags, fields, createdAt, assignedAt, resolvedAt}]',
    },
    report: {
      type: 'json',
      description: 'Report (id, type, status, hasMatch, tags, createdAt, completedAt, attributes)',
    },
    reports: {
      type: 'json',
      description:
        'List of reports [{id, type, status, hasMatch, tags, createdAt, completedAt, attributes}]',
    },
    verification: {
      type: 'json',
      description:
        'Verification (id, type, status, checks, countryCode, createdAt, submittedAt, completedAt, attributes)',
    },
    document: {
      type: 'json',
      description: 'Document (id, type, status, kind, files, createdAt, processedAt, attributes)',
    },
    inquiryTemplates: {
      type: 'json',
      description: 'List of inquiry templates [{id, name, status}]',
    },
    nextCursor: { type: 'string', description: 'Cursor for the next page of list results' },
  },
}
