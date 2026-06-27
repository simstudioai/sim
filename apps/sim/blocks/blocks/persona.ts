import { PersonaIcon } from '@/components/icons'
import { PersonaBlockDisplay } from '@/blocks/blocks/persona.display'
import { AuthMode, type BlockConfig, type BlockMeta } from '@/blocks/types'
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

export const PersonaBlockMeta = {
  tags: ['identity'],
  url: 'https://withpersona.com',
  templates: [
    {
      icon: PersonaIcon,
      title: 'Customer onboarding identity verification',
      prompt:
        'Build a workflow triggered when a new customer signs up that creates a Persona inquiry from our KYC template with their name and email pre-filled, generates a one-time verification link, and emails it to the customer.',
      modules: ['workflows', 'agent'],
      category: 'operations',
      tags: ['onboarding', 'compliance'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: PersonaIcon,
      title: 'Verification decision router',
      prompt:
        'Build a workflow that takes an inquiry ID, fetches the inquiry from Persona, and routes on its status: approved customers get a welcome email, needs-review inquiries post to a compliance Slack channel with a summary, and declined inquiries update our CRM.',
      modules: ['workflows', 'agent'],
      category: 'operations',
      tags: ['compliance', 'automation'],
      alsoIntegrations: ['slack', 'gmail'],
    },
    {
      icon: PersonaIcon,
      title: 'Daily pending-review digest',
      prompt:
        'Build a scheduled workflow that runs every morning, lists Persona inquiries with needs_review status from the last 24 hours, summarizes each one, and posts a digest to the compliance team in Slack.',
      modules: ['scheduled', 'workflows', 'agent'],
      category: 'operations',
      tags: ['compliance', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PersonaIcon,
      title: 'Watchlist screening on signup',
      prompt:
        "Build a workflow that takes a new user's name and birthdate, runs a Persona watchlist report against them, polls until the report is ready, and creates a case in our tracking table if the report has a match.",
      modules: ['workflows', 'tables', 'agent'],
      category: 'operations',
      tags: ['compliance', 'screening'],
    },
    {
      icon: PersonaIcon,
      title: 'Bulk account import from CRM export',
      prompt:
        'Build a workflow that takes an uploaded CSV export of customers, imports them into Persona as accounts using the account importer, polls the importer status, and reports how many rows succeeded, errored, or were duplicates.',
      modules: ['files', 'workflows', 'agent'],
      category: 'operations',
      tags: ['migration', 'automation'],
    },
    {
      icon: PersonaIcon,
      title: 'Compliance audit PDF archive',
      prompt:
        'Build a workflow that takes an approved inquiry ID, downloads the inquiry summary PDF from Persona, and uploads it to a compliance archive folder in Google Drive named by customer reference ID.',
      modules: ['workflows', 'files', 'agent'],
      category: 'operations',
      tags: ['compliance', 'audit'],
      alsoIntegrations: ['google_drive'],
    },
    {
      icon: PersonaIcon,
      title: 'Manual review case triage agent',
      prompt:
        'Build an agent that lists open Persona cases, fetches the linked inquiry and verification details for each, drafts a recommended approve/decline decision with reasoning, and posts the triage summary to Slack for a human reviewer.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['compliance', 'triage'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PersonaIcon,
      title: 'Re-verification campaign for stale accounts',
      prompt:
        'Build a scheduled workflow that lists Persona accounts, finds ones whose latest approved inquiry is older than a year, creates a new inquiry for each from our re-verification template, and emails customers a one-time verification link.',
      modules: ['scheduled', 'workflows', 'agent'],
      category: 'operations',
      tags: ['compliance', 'lifecycle'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'verify-customer-identity',
      description:
        'Create a Persona inquiry for a customer and send them a one-time verification link.',
      content:
        '# Verify Customer Identity\n\nStart an identity verification for a customer using Persona.\n\n## Steps\n1. Use the Create Inquiry operation with your inquiry template ID. Pass the customer reference ID so the inquiry links to an account in your user model, and pre-fill known fields (e.g. {"name-first": "Jane", "name-last": "Doe"}).\n2. Use the Generate Inquiry Link operation with the new inquiry ID to mint a one-time verification link. Set a custom expiry only if the default (24 hours) does not fit.\n3. Deliver the one-time link to the customer (email, SMS, or chat).\n\n## Output\nReturn the inquiry ID, its status, and the one-time link. Note when the link expires so follow-ups can be scheduled.',
    },
    {
      name: 'check-verification-status',
      description:
        'Look up a Persona inquiry and report whether the individual passed, failed, or needs review.',
      content:
        '# Check Verification Status\n\nRead the current state of an identity verification from Persona.\n\n## Steps\n1. Use the Get Inquiry operation with the inquiry ID (or List Inquiries filtered by reference ID to find it).\n2. Read the status: approved or completed means verified; needs_review means a human should look; failed, expired, or declined means not verified.\n3. For deeper detail, use Get Verification with a verification ID to inspect the individual checks that ran.\n\n## Output\nReturn the status, decision timestamps, and collected fields. Recommend the next action (proceed, route to review, or re-verify).',
    },
    {
      name: 'screen-against-watchlists',
      description:
        'Run a Persona watchlist, adverse media, or PEP report on a person and surface matches.',
      content:
        '# Screen Against Watchlists\n\nScreen an individual for sanctions, adverse media, or political exposure using Persona reports.\n\n## Steps\n1. Use the Create Report operation with the report type (watchlist, adverse-media, or politically-exposed-person) and your report template ID. Provide the name parts or a full-name term, plus birthdate and country code when known to reduce false positives.\n2. Reports run asynchronously: poll Get Report with the report ID until the status is ready.\n3. Check hasMatch and the report attributes for matched lists and match details.\n\n## Output\nReturn whether the screening found matches, the matched lists, and the report ID for the audit trail.',
    },
    {
      name: 'triage-pending-reviews',
      description:
        'List Persona inquiries awaiting manual review and approve or decline them after assessment.',
      content:
        '# Triage Pending Reviews\n\nWork through identity verifications that need a manual decision in Persona.\n\n## Steps\n1. Use the List Inquiries operation with status needs_review (optionally bounded by created-after/created-before).\n2. For each inquiry, use Get Inquiry for collected fields and List Cases / Get Case to see any linked review case.\n3. After assessment, use Approve Inquiry or Decline Inquiry. Both are final: they prevent further progress and trigger associated workflows and webhooks.\n\n## Output\nReturn a summary of inquiries reviewed and the decision taken for each, with inquiry IDs for the audit trail.',
    },
    {
      name: 'import-accounts-from-csv',
      description: 'Bulk-import existing users into Persona as accounts from a CSV file.',
      content:
        '# Import Accounts from CSV\n\nMigrate an existing user base into Persona using the account importer.\n\n## Steps\n1. Prepare a CSV of users (one row per account, with reference IDs and account fields).\n2. Use the Import Accounts (CSV) operation with the file.\n3. The importer runs asynchronously and returns pending at first; report the importer ID and counts once available.\n\n## Output\nReturn the importer ID, status, and the successful, errored, and duplicate row counts.',
    },
    {
      name: 'archive-verification-pdf',
      description: 'Download the PDF summary of a Persona inquiry for compliance record-keeping.',
      content:
        '# Archive Verification PDF\n\nKeep a permanent record of an identity verification decision.\n\n## Steps\n1. Use the Print Inquiry PDF operation with the inquiry ID.\n2. The PDF lands in execution files; pass it to a storage integration (Google Drive, S3, SharePoint) named by customer reference ID and date.\n\n## Output\nReturn the stored file and where it was archived.',
    },
  ],
} as const satisfies BlockMeta
