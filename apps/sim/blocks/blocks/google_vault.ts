import { GoogleVaultIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const GoogleVaultBlock: BlockConfig = {
  type: 'google_vault',
  name: 'Google Vault',
  description: 'Search, export, and manage holds/exports for Vault matters',
  authMode: AuthMode.OAuth,
  longDescription:
    'Connect Google Vault to create exports, list exports, and manage holds within matters.',
  docsLink: 'https://developers.google.com/vault',
  category: 'tools',
  bgColor: '#E8F0FE',
  icon: GoogleVaultIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Export', id: 'create_matters_export' },
        { label: 'List Exports', id: 'list_matters_export' },
        { label: 'Download Export File', id: 'download_export_file' },
        { label: 'Create Hold', id: 'create_matters_holds' },
        { label: 'List Holds', id: 'list_matters_holds' },
        { label: 'Create Matter', id: 'create_matters' },
        { label: 'List Matters', id: 'list_matters' },
      ],
      value: () => 'list_matters_export',
    },

    {
      id: 'credential',
      title: 'Google Vault Account',
      type: 'oauth-input',
      required: true,
      serviceId: 'google-vault',
      requiredScopes: [
        'https://www.googleapis.com/auth/ediscovery',
        'https://www.googleapis.com/auth/devstorage.read_only',
      ],
      placeholder: 'Select Google Vault account',
    },
    // Create Hold inputs
    {
      id: 'matterId',
      title: 'Matter ID',
      type: 'short-input',
      placeholder: 'Enter Matter ID',
      condition: () => ({
        field: 'operation',
        value: [
          'create_matters_export',
          'list_matters_export',
          'download_export_file',
          'create_matters_holds',
          'list_matters_holds',
        ],
      }),
    },
    // Download Export File inputs
    {
      id: 'bucketName',
      title: 'Bucket Name',
      type: 'short-input',
      placeholder: 'Vault export bucket (from cloudStorageSink.files.bucketName)',
      condition: { field: 'operation', value: 'download_export_file' },
      required: true,
    },
    {
      id: 'objectName',
      title: 'Object Name',
      type: 'long-input',
      placeholder: 'Vault export object (from cloudStorageSink.files.objectName)',
      condition: { field: 'operation', value: 'download_export_file' },
      required: true,
    },
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Override filename used for storage/display',
      condition: { field: 'operation', value: 'download_export_file' },
    },
    {
      id: 'exportName',
      title: 'Export Name',
      type: 'short-input',
      placeholder: 'Name for the export',
      condition: { field: 'operation', value: 'create_matters_export' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a descriptive export name for Google Vault based on the user's description.
The name should be:
- Clear and descriptive
- Include relevant identifiers (date, case, scope)
- Professional and concise

Examples:
- "email export for Q4" -> Q4_2024_Email_Export
- "drive files for legal case" -> Legal_Case_Drive_Files_Export
- "john's messages" -> John_Doe_Messages_Export

Return ONLY the export name - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the export...',
      },
    },
    {
      id: 'holdName',
      title: 'Hold Name',
      type: 'short-input',
      placeholder: 'Name of the hold',
      condition: { field: 'operation', value: 'create_matters_holds' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a descriptive hold name for Google Vault based on the user's description.
The name should be:
- Clear and descriptive
- Include relevant identifiers (case name, scope, date)
- Professional and concise

Examples:
- "hold for investigation" -> Investigation_Hold_2024
- "preserve emails for John" -> John_Doe_Email_Preservation
- "legal hold for project alpha" -> Project_Alpha_Legal_Hold

Return ONLY the hold name - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the hold...',
      },
    },
    {
      id: 'corpus',
      title: 'Corpus',
      type: 'dropdown',
      options: [
        { id: 'MAIL', label: 'MAIL' },
        { id: 'DRIVE', label: 'DRIVE' },
        { id: 'GROUPS', label: 'GROUPS' },
        { id: 'HANGOUTS_CHAT', label: 'HANGOUTS_CHAT' },
        { id: 'VOICE', label: 'VOICE' },
      ],
      condition: { field: 'operation', value: ['create_matters_holds', 'create_matters_export'] },
      required: true,
    },
    {
      id: 'accountEmails',
      title: 'Account Emails',
      type: 'long-input',
      placeholder: 'Comma-separated emails (alternative to Org Unit)',
      condition: { field: 'operation', value: ['create_matters_holds', 'create_matters_export'] },
    },
    {
      id: 'orgUnitId',
      title: 'Org Unit ID',
      type: 'short-input',
      placeholder: 'Org Unit ID (alternative to emails)',
      condition: { field: 'operation', value: ['create_matters_holds', 'create_matters_export'] },
    },
    // Date filtering for exports (works with all corpus types)
    {
      id: 'startTime',
      title: 'Start Time',
      type: 'short-input',
      placeholder: 'YYYY-MM-DDTHH:mm:ssZ',
      condition: { field: 'operation', value: 'create_matters_export' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp in GMT based on the user's description for Google Vault date filtering.
The timestamp should be in the format: YYYY-MM-DDTHH:mm:ssZ (UTC timezone).
Note: Google Vault rounds times to 12 AM on the specified date.
Examples:
- "yesterday" -> Calculate yesterday's date at 00:00:00Z
- "last week" -> Calculate 7 days ago at 00:00:00Z
- "beginning of this month" -> Calculate the 1st of current month at 00:00:00Z
- "January 1, 2024" -> 2024-01-01T00:00:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start date (e.g., "last month", "January 1, 2024")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endTime',
      title: 'End Time',
      type: 'short-input',
      placeholder: 'YYYY-MM-DDTHH:mm:ssZ',
      condition: { field: 'operation', value: 'create_matters_export' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp in GMT based on the user's description for Google Vault date filtering.
The timestamp should be in the format: YYYY-MM-DDTHH:mm:ssZ (UTC timezone).
Note: Google Vault rounds times to 12 AM on the specified date.
Examples:
- "now" -> Current timestamp
- "today" -> Today's date at 23:59:59Z
- "end of last month" -> Last day of previous month at 23:59:59Z
- "December 31, 2024" -> 2024-12-31T23:59:59Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end date (e.g., "today", "end of last quarter")...',
        generationType: 'timestamp',
      },
    },
    // Date filtering for holds (only works with MAIL and GROUPS corpus)
    {
      id: 'holdStartTime',
      title: 'Start Time',
      type: 'short-input',
      placeholder: 'YYYY-MM-DDTHH:mm:ssZ',
      condition: {
        field: 'operation',
        value: 'create_matters_holds',
        and: { field: 'corpus', value: ['MAIL', 'GROUPS'] },
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp in GMT based on the user's description for Google Vault date filtering.
The timestamp should be in the format: YYYY-MM-DDTHH:mm:ssZ (UTC timezone).
Note: Google Vault rounds times to 12 AM on the specified date.
Examples:
- "yesterday" -> Calculate yesterday's date at 00:00:00Z
- "last week" -> Calculate 7 days ago at 00:00:00Z
- "beginning of this month" -> Calculate the 1st of current month at 00:00:00Z
- "January 1, 2024" -> 2024-01-01T00:00:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start date (e.g., "last month", "January 1, 2024")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'holdEndTime',
      title: 'End Time',
      type: 'short-input',
      placeholder: 'YYYY-MM-DDTHH:mm:ssZ',
      condition: {
        field: 'operation',
        value: 'create_matters_holds',
        and: { field: 'corpus', value: ['MAIL', 'GROUPS'] },
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp in GMT based on the user's description for Google Vault date filtering.
The timestamp should be in the format: YYYY-MM-DDTHH:mm:ssZ (UTC timezone).
Note: Google Vault rounds times to 12 AM on the specified date.
Examples:
- "now" -> Current timestamp
- "today" -> Today's date at 23:59:59Z
- "end of last month" -> Last day of previous month at 23:59:59Z
- "December 31, 2024" -> 2024-12-31T23:59:59Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end date (e.g., "today", "end of last quarter")...',
        generationType: 'timestamp',
      },
    },
    // Search terms for exports (works with all corpus types)
    {
      id: 'terms',
      title: 'Search Terms',
      type: 'long-input',
      placeholder: 'Enter search query (e.g., from:user@example.com subject:confidential)',
      condition: { field: 'operation', value: 'create_matters_export' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Google Vault search query based on the user's description.
The query can use Gmail-style search operators for MAIL corpus:
- from:user@example.com - emails from specific sender
- to:user@example.com - emails to specific recipient  
- subject:keyword - emails with keyword in subject
- has:attachment - emails with attachments
- filename:pdf - emails with PDF attachments
- before:YYYY/MM/DD - emails before date
- after:YYYY/MM/DD - emails after date

For DRIVE corpus, use Drive search operators:
- owner:user@example.com - files owned by user
- type:document - specific file types

Return ONLY the search query - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe what content to search for...',
      },
    },
    // Search terms for holds (only works with MAIL and GROUPS corpus)
    {
      id: 'holdTerms',
      title: 'Search Terms',
      type: 'long-input',
      placeholder: 'Enter search query (e.g., from:user@example.com subject:confidential)',
      condition: {
        field: 'operation',
        value: 'create_matters_holds',
        and: { field: 'corpus', value: ['MAIL', 'GROUPS'] },
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Google Vault search query based on the user's description.
The query can use Gmail-style search operators:
- from:user@example.com - emails from specific sender
- to:user@example.com - emails to specific recipient
- subject:keyword - emails with keyword in subject
- has:attachment - emails with attachments
- filename:pdf - emails with PDF attachments

Return ONLY the search query - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe what content to search for...',
      },
    },
    // Drive-specific option for holds
    {
      id: 'includeSharedDrives',
      title: 'Include Shared Drives',
      type: 'switch',
      condition: {
        field: 'operation',
        value: 'create_matters_holds',
        and: { field: 'corpus', value: 'DRIVE' },
      },
    },
    {
      id: 'exportId',
      title: 'Export ID',
      type: 'short-input',
      placeholder: 'Enter Export ID (optional to fetch a specific export)',
      condition: { field: 'operation', value: 'list_matters_export' },
    },
    {
      id: 'holdId',
      title: 'Hold ID',
      type: 'short-input',
      placeholder: 'Enter Hold ID (optional to fetch a specific hold)',
      condition: { field: 'operation', value: 'list_matters_holds' },
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: 'Number of items to return',
      condition: {
        field: 'operation',
        value: ['list_matters_export', 'list_matters_holds', 'list_matters'],
      },
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Pagination token',
      condition: {
        field: 'operation',
        value: ['list_matters_export', 'list_matters_holds', 'list_matters'],
      },
    },

    {
      id: 'name',
      title: 'Matter Name',
      type: 'short-input',
      placeholder: 'Enter Matter name',
      condition: { field: 'operation', value: 'create_matters' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a descriptive matter name for Google Vault based on the user's description.
The name should be:
- Clear and descriptive
- Professional and suitable for legal/compliance purposes
- Include relevant identifiers if applicable

Examples:
- "investigation into data breach" -> Data_Breach_Investigation_2024
- "lawsuit from acme corp" -> Acme_Corp_Litigation
- "HR complaint case" -> HR_Complaint_Matter_001

Return ONLY the matter name - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the matter...',
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      placeholder: 'Optional description for the matter',
      condition: { field: 'operation', value: 'create_matters' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a professional description for a Google Vault matter based on the user's request.
The description should:
- Clearly explain the purpose and scope of the matter
- Be concise but informative (1-3 sentences)
- Use professional language appropriate for legal/compliance contexts

Return ONLY the description text - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the purpose of this matter...',
      },
    },
    // Optional get specific matter by ID
    {
      id: 'matterId',
      title: 'Matter ID',
      type: 'short-input',
      placeholder: 'Enter Matter ID (optional to fetch a specific matter)',
      condition: { field: 'operation', value: 'list_matters' },
    },
  ],
  tools: {
    access: [
      'google_vault_create_matters_export',
      'google_vault_list_matters_export',
      'google_vault_download_export_file',
      'google_vault_create_matters_holds',
      'google_vault_list_matters_holds',
      'google_vault_create_matters',
      'google_vault_list_matters',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'create_matters_export':
            return 'google_vault_create_matters_export'
          case 'list_matters_export':
            return 'google_vault_list_matters_export'
          case 'download_export_file':
            return 'google_vault_download_export_file'
          case 'create_matters_holds':
            return 'google_vault_create_matters_holds'
          case 'list_matters_holds':
            return 'google_vault_list_matters_holds'
          case 'create_matters':
            return 'google_vault_create_matters'
          case 'list_matters':
            return 'google_vault_list_matters'
          default:
            throw new Error(`Invalid Google Vault operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, holdStartTime, holdEndTime, holdTerms, ...rest } = params
        return {
          ...rest,
          credential,
          // Map hold-specific fields to their tool parameter names
          ...(holdStartTime && { startTime: holdStartTime }),
          ...(holdEndTime && { endTime: holdEndTime }),
          ...(holdTerms && { terms: holdTerms }),
        }
      },
    },
  },
  inputs: {
    // Core inputs
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Google Vault OAuth credential' },
    matterId: { type: 'string', description: 'Matter ID' },

    // Create export inputs
    exportName: { type: 'string', description: 'Name for the export' },
    corpus: { type: 'string', description: 'Data corpus (MAIL, DRIVE, GROUPS, etc.)' },
    accountEmails: { type: 'string', description: 'Comma-separated account emails' },
    orgUnitId: { type: 'string', description: 'Organization unit ID' },
    startTime: { type: 'string', description: 'Start time for date filtering (ISO 8601 format)' },
    endTime: { type: 'string', description: 'End time for date filtering (ISO 8601 format)' },
    terms: { type: 'string', description: 'Search query terms' },

    // Create hold inputs
    holdName: { type: 'string', description: 'Name for the hold' },
    holdStartTime: {
      type: 'string',
      description: 'Start time for hold date filtering (ISO 8601 format, MAIL/GROUPS only)',
    },
    holdEndTime: {
      type: 'string',
      description: 'End time for hold date filtering (ISO 8601 format, MAIL/GROUPS only)',
    },
    holdTerms: {
      type: 'string',
      description: 'Search query terms for hold (MAIL/GROUPS only)',
    },
    includeSharedDrives: {
      type: 'boolean',
      description: 'Include files in shared drives (for DRIVE corpus holds)',
    },

    // Download export file inputs
    bucketName: { type: 'string', description: 'GCS bucket name from export' },
    objectName: { type: 'string', description: 'GCS object name from export' },
    fileName: { type: 'string', description: 'Optional filename override' },

    // List operations inputs
    exportId: { type: 'string', description: 'Specific export ID to fetch' },
    holdId: { type: 'string', description: 'Specific hold ID to fetch' },
    pageSize: { type: 'number', description: 'Number of items per page' },
    pageToken: { type: 'string', description: 'Pagination token' },

    // Create matter inputs
    name: { type: 'string', description: 'Matter name' },
    description: { type: 'string', description: 'Matter description' },
  },
  outputs: {
    matters: {
      type: 'json',
      description: 'Array of matter objects (for list_matters without matterId)',
    },
    exports: {
      type: 'json',
      description: 'Array of export objects (for list_matters_export without exportId)',
    },
    holds: {
      type: 'json',
      description: 'Array of hold objects (for list_matters_holds without holdId)',
    },
    matter: {
      type: 'json',
      description: 'Single matter object (for create_matters or list_matters with matterId)',
    },
    export: {
      type: 'json',
      description:
        'Single export object (for create_matters_export or list_matters_export with exportId)',
    },
    hold: {
      type: 'json',
      description:
        'Single hold object (for create_matters_holds or list_matters_holds with holdId)',
    },
    file: { type: 'file', description: 'Downloaded export file (UserFile) from execution files' },
    nextPageToken: {
      type: 'string',
      description: 'Token for fetching next page of results (for list operations)',
    },
  },
}
