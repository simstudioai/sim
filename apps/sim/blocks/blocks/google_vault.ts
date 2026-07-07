import { ShieldCheck } from '@sim/emcn/icons'
import { GoogleVaultIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { SERVICE_ACCOUNT_SUBBLOCKS } from '@/blocks/utils'

export const GoogleVaultBlock: BlockConfig = {
  type: 'google_vault',
  name: 'Google Vault',
  description: 'Search, export, and manage matters, holds, exports, and saved queries in Vault',
  authMode: AuthMode.OAuth,
  longDescription:
    'Connect Google Vault to manage the full matter lifecycle, create and manage holds and exports, and save reusable search queries for eDiscovery and compliance.',
  docsLink: 'https://docs.sim.ai/integrations/google_vault',
  category: 'tools',
  integrationType: IntegrationType.Security,
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
        { label: 'Delete Export', id: 'delete_matters_export' },
        { label: 'Download Export File', id: 'download_export_file' },
        { label: 'Create Hold', id: 'create_matters_holds' },
        { label: 'List Holds', id: 'list_matters_holds' },
        { label: 'Update Hold', id: 'update_matters_holds' },
        { label: 'Delete Hold', id: 'delete_matters_holds' },
        { label: 'Add Held Accounts', id: 'add_held_accounts' },
        { label: 'Remove Held Accounts', id: 'remove_held_accounts' },
        { label: 'Create Matter', id: 'create_matters' },
        { label: 'List Matters', id: 'list_matters' },
        { label: 'Update Matter', id: 'update_matters' },
        { label: 'Close Matter', id: 'close_matters' },
        { label: 'Reopen Matter', id: 'reopen_matters' },
        { label: 'Delete Matter', id: 'delete_matters' },
        { label: 'Undelete Matter', id: 'undelete_matters' },
        { label: 'Add Matter Collaborator', id: 'add_matters_permissions' },
        { label: 'Remove Matter Collaborator', id: 'remove_matters_permissions' },
        { label: 'Create Saved Query', id: 'create_saved_query' },
        { label: 'List Saved Queries', id: 'list_saved_queries' },
        { label: 'Delete Saved Query', id: 'delete_saved_query' },
      ],
      value: () => 'list_matters_export',
    },

    {
      id: 'credential',
      title: 'Google Vault Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'google-vault',
      requiredScopes: getScopesForService('google-vault'),
      placeholder: 'Select Google Vault account',
    },
    {
      id: 'manualCredential',
      title: 'Google Vault Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    ...SERVICE_ACCOUNT_SUBBLOCKS,
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
          'delete_matters_export',
          'download_export_file',
          'create_matters_holds',
          'list_matters_holds',
          'update_matters_holds',
          'delete_matters_holds',
          'add_held_accounts',
          'remove_held_accounts',
          'list_matters',
          'update_matters',
          'close_matters',
          'reopen_matters',
          'delete_matters',
          'undelete_matters',
          'add_matters_permissions',
          'remove_matters_permissions',
          'create_saved_query',
          'list_saved_queries',
          'delete_saved_query',
        ],
      }),
      required: () => ({
        field: 'operation',
        value: [
          'create_matters_export',
          'list_matters_export',
          'delete_matters_export',
          'download_export_file',
          'create_matters_holds',
          'list_matters_holds',
          'update_matters_holds',
          'delete_matters_holds',
          'add_held_accounts',
          'remove_held_accounts',
          'update_matters',
          'close_matters',
          'reopen_matters',
          'delete_matters',
          'undelete_matters',
          'add_matters_permissions',
          'remove_matters_permissions',
          'create_saved_query',
          'list_saved_queries',
          'delete_saved_query',
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
      condition: { field: 'operation', value: ['create_matters_holds', 'update_matters_holds'] },
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
      condition: {
        field: 'operation',
        value: [
          'create_matters_holds',
          'update_matters_holds',
          'create_matters_export',
          'create_saved_query',
        ],
      },
      required: true,
    },
    {
      id: 'accountEmails',
      title: 'Account Emails',
      type: 'long-input',
      placeholder: 'Comma-separated emails (alternative to Org Unit)',
      condition: {
        field: 'operation',
        value: [
          'create_matters_holds',
          'update_matters_holds',
          'create_matters_export',
          'create_saved_query',
        ],
      },
    },
    {
      id: 'orgUnitId',
      title: 'Org Unit ID',
      type: 'short-input',
      placeholder: 'Org Unit ID (alternative to emails)',
      condition: {
        field: 'operation',
        value: [
          'create_matters_holds',
          'update_matters_holds',
          'create_matters_export',
          'create_saved_query',
        ],
      },
    },
    // Date filtering for exports (works with all corpus types)
    {
      id: 'startTime',
      title: 'Start Time',
      type: 'short-input',
      placeholder: 'YYYY-MM-DDTHH:mm:ssZ',
      condition: { field: 'operation', value: ['create_matters_export', 'create_saved_query'] },
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
      condition: { field: 'operation', value: ['create_matters_export', 'create_saved_query'] },
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
        value: ['create_matters_holds', 'update_matters_holds'],
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
        value: ['create_matters_holds', 'update_matters_holds'],
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
      condition: { field: 'operation', value: ['create_matters_export', 'create_saved_query'] },
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
        value: ['create_matters_holds', 'update_matters_holds'],
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
        value: ['create_matters_holds', 'update_matters_holds'],
        and: { field: 'corpus', value: 'DRIVE' },
      },
    },
    {
      id: 'exportId',
      title: 'Export ID',
      type: 'short-input',
      placeholder: 'Enter Export ID (optional to fetch a specific export)',
      condition: { field: 'operation', value: ['list_matters_export', 'delete_matters_export'] },
      required: () => ({ field: 'operation', value: 'delete_matters_export' }),
    },
    {
      id: 'holdId',
      title: 'Hold ID',
      type: 'short-input',
      placeholder: 'Enter Hold ID (optional to fetch a specific hold)',
      condition: {
        field: 'operation',
        value: [
          'list_matters_holds',
          'update_matters_holds',
          'delete_matters_holds',
          'add_held_accounts',
          'remove_held_accounts',
        ],
      },
      required: () => ({
        field: 'operation',
        value: [
          'update_matters_holds',
          'delete_matters_holds',
          'add_held_accounts',
          'remove_held_accounts',
        ],
      }),
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: 'Number of items to return',
      condition: {
        field: 'operation',
        value: ['list_matters_export', 'list_matters_holds', 'list_matters', 'list_saved_queries'],
      },
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Pagination token',
      condition: {
        field: 'operation',
        value: ['list_matters_export', 'list_matters_holds', 'list_matters', 'list_saved_queries'],
      },
    },

    {
      id: 'name',
      title: 'Matter Name',
      type: 'short-input',
      placeholder: 'Enter Matter name',
      condition: { field: 'operation', value: ['create_matters', 'update_matters'] },
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
      condition: { field: 'operation', value: ['create_matters', 'update_matters'] },
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
    // Held account management
    {
      id: 'heldAccountEmails',
      title: 'Account Emails',
      type: 'long-input',
      placeholder: 'Comma-separated emails (e.g., user1@example.com, user2@example.com)',
      condition: { field: 'operation', value: 'add_held_accounts' },
      required: true,
    },
    {
      id: 'heldAccountIds',
      title: 'Account IDs',
      type: 'long-input',
      placeholder: 'Comma-separated Admin SDK account IDs',
      condition: { field: 'operation', value: 'remove_held_accounts' },
      required: true,
    },
    // Matter collaborator management
    {
      id: 'accountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'Admin SDK account ID',
      condition: {
        field: 'operation',
        value: ['add_matters_permissions', 'remove_matters_permissions'],
      },
      required: true,
    },
    {
      id: 'role',
      title: 'Role',
      type: 'dropdown',
      options: [
        { id: 'COLLABORATOR', label: 'Collaborator' },
        { id: 'OWNER', label: 'Owner' },
      ],
      condition: { field: 'operation', value: 'add_matters_permissions' },
      required: true,
      value: () => 'COLLABORATOR',
    },
    {
      id: 'sendEmails',
      title: 'Send Notification Email',
      type: 'switch',
      condition: { field: 'operation', value: 'add_matters_permissions' },
      mode: 'advanced',
    },
    {
      id: 'ccMe',
      title: 'CC Me',
      type: 'switch',
      condition: { field: 'operation', value: 'add_matters_permissions' },
      mode: 'advanced',
    },
    // Saved query management
    {
      id: 'displayName',
      title: 'Saved Query Name',
      type: 'short-input',
      placeholder: 'Name for the saved query',
      condition: { field: 'operation', value: 'create_saved_query' },
      required: true,
    },
    {
      id: 'savedQueryId',
      title: 'Saved Query ID',
      type: 'short-input',
      placeholder: 'Enter Saved Query ID (optional to fetch a specific saved query)',
      condition: { field: 'operation', value: ['list_saved_queries', 'delete_saved_query'] },
      required: () => ({ field: 'operation', value: 'delete_saved_query' }),
    },
  ],
  tools: {
    access: [
      'google_vault_create_matters_export',
      'google_vault_list_matters_export',
      'google_vault_delete_matters_export',
      'google_vault_download_export_file',
      'google_vault_create_matters_holds',
      'google_vault_list_matters_holds',
      'google_vault_update_matters_holds',
      'google_vault_delete_matters_holds',
      'google_vault_add_held_accounts',
      'google_vault_remove_held_accounts',
      'google_vault_create_matters',
      'google_vault_list_matters',
      'google_vault_update_matters',
      'google_vault_close_matters',
      'google_vault_reopen_matters',
      'google_vault_delete_matters',
      'google_vault_undelete_matters',
      'google_vault_add_matters_permissions',
      'google_vault_remove_matters_permissions',
      'google_vault_create_saved_query',
      'google_vault_list_saved_queries',
      'google_vault_delete_saved_query',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'create_matters_export':
            return 'google_vault_create_matters_export'
          case 'list_matters_export':
            return 'google_vault_list_matters_export'
          case 'delete_matters_export':
            return 'google_vault_delete_matters_export'
          case 'download_export_file':
            return 'google_vault_download_export_file'
          case 'create_matters_holds':
            return 'google_vault_create_matters_holds'
          case 'list_matters_holds':
            return 'google_vault_list_matters_holds'
          case 'update_matters_holds':
            return 'google_vault_update_matters_holds'
          case 'delete_matters_holds':
            return 'google_vault_delete_matters_holds'
          case 'add_held_accounts':
            return 'google_vault_add_held_accounts'
          case 'remove_held_accounts':
            return 'google_vault_remove_held_accounts'
          case 'create_matters':
            return 'google_vault_create_matters'
          case 'list_matters':
            return 'google_vault_list_matters'
          case 'update_matters':
            return 'google_vault_update_matters'
          case 'close_matters':
            return 'google_vault_close_matters'
          case 'reopen_matters':
            return 'google_vault_reopen_matters'
          case 'delete_matters':
            return 'google_vault_delete_matters'
          case 'undelete_matters':
            return 'google_vault_undelete_matters'
          case 'add_matters_permissions':
            return 'google_vault_add_matters_permissions'
          case 'remove_matters_permissions':
            return 'google_vault_remove_matters_permissions'
          case 'create_saved_query':
            return 'google_vault_create_saved_query'
          case 'list_saved_queries':
            return 'google_vault_list_saved_queries'
          case 'delete_saved_query':
            return 'google_vault_delete_saved_query'
          default:
            throw new Error(`Invalid Google Vault operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          oauthCredential,
          holdStartTime,
          holdEndTime,
          holdTerms,
          heldAccountEmails,
          heldAccountIds,
          ...rest
        } = params
        return {
          ...rest,
          oauthCredential,
          // Map hold-specific fields to their tool parameter names
          ...(holdStartTime && { startTime: holdStartTime }),
          ...(holdEndTime && { endTime: holdEndTime }),
          ...(holdTerms && { terms: holdTerms }),
          ...(heldAccountEmails && { accountEmails: heldAccountEmails }),
          ...(heldAccountIds && { accountIds: heldAccountIds }),
        }
      },
    },
  },
  inputs: {
    // Core inputs
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Google Vault OAuth credential' },
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

    // Create/update matter inputs
    name: { type: 'string', description: 'Matter name' },
    description: { type: 'string', description: 'Matter description' },

    // Hold account management inputs
    heldAccountEmails: { type: 'string', description: 'Comma-separated emails to add to a hold' },
    heldAccountIds: {
      type: 'string',
      description: 'Comma-separated account IDs to remove from a hold',
    },

    // Matter collaborator inputs
    accountId: { type: 'string', description: 'Admin SDK account ID for collaborator management' },
    role: { type: 'string', description: 'Matter permission role (COLLABORATOR or OWNER)' },
    sendEmails: { type: 'boolean', description: 'Send a notification email to the added account' },
    ccMe: { type: 'boolean', description: 'CC the requestor on the notification email' },

    // Saved query inputs
    displayName: { type: 'string', description: 'Name for the saved query' },
    savedQueryId: { type: 'string', description: 'Specific saved query ID to fetch or delete' },
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
    success: {
      type: 'boolean',
      description: 'Whether the delete/remove operation succeeded',
    },
    responses: {
      type: 'json',
      description:
        '[{account: {accountId, email}, status: {code, message}}] (for add_held_accounts)',
    },
    statuses: {
      type: 'json',
      description: '[{code, message}] per-account removal status (for remove_held_accounts)',
    },
    permission: {
      type: 'json',
      description: 'Matter permission (accountId, role) (for add_matters_permissions)',
    },
    savedQuery: {
      type: 'json',
      description:
        'Single saved query object (for create_saved_query or list_saved_queries with savedQueryId)',
    },
    savedQueries: {
      type: 'json',
      description: 'Array of saved query objects (for list_saved_queries without savedQueryId)',
    },
  },
}

export const GoogleVaultBlockMeta = {
  tags: ['google-workspace', 'document-processing'],
  url: 'https://support.google.com/vault',
  templates: [
    {
      icon: ShieldCheck,
      title: 'Google Vault legal hold automator',
      prompt:
        'Build a scheduled workflow that polls Salesforce for new legal-hold instructions, creates a Google Vault matter and hold for the named custodians, and notifies legal with the hold details.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: ShieldCheck,
      title: 'Google Vault hold auditor',
      prompt:
        'Create a scheduled workflow that lists Google Vault matters and holds, flags custodians missing expected holds, and writes the findings to a compliance review table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: ShieldCheck,
      title: 'Google Vault eDiscovery exporter',
      prompt:
        'Build a workflow that takes an eDiscovery request, runs a Google Vault search, exports the matters into structured archives, and writes the export manifest.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: ShieldCheck,
      title: 'Google Vault hold reviewer',
      prompt:
        'Create a scheduled workflow that lists Google Vault holds across matters, summarizes their custodians and scope, and writes a review report for the legal team to approve.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: ShieldCheck,
      title: 'Google Vault sensitive-term exporter',
      prompt:
        'Build a scheduled workflow that creates Google Vault exports for sensitive search terms weekly, downloads the export results, and writes the matching items to a compliance review queue.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: ShieldCheck,
      title: 'Google Vault export archiver',
      prompt:
        'Create a scheduled workflow that creates Google Vault matter exports, downloads the export files, archives them to S3 long-term storage, and writes the manifest to a compliance table.',
      modules: ['scheduled', 'tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['s3'],
    },
    {
      icon: ShieldCheck,
      title: 'Google Vault custodian dashboard',
      prompt:
        'Build a scheduled monthly workflow that summarizes Google Vault holds and custodians, generates a status dashboard, and writes it to a legal review file.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
  ],
  skills: [
    {
      name: 'open-legal-hold',
      description:
        'Create a Vault matter and place a legal hold on custodians for an investigation or litigation.',
      content:
        '# Open Legal Hold\n\nStand up a Vault matter and preserve data for the relevant custodians.\n\n## Steps\n1. Create a matter with a clear name and description tied to the case or investigation.\n2. List existing matters first to avoid creating a duplicate for the same case.\n3. Create a hold on the matter for the named custodians and the relevant service (mail, Drive, etc.).\n4. List holds on the matter to confirm the custodians were preserved.\n\n## Output\nReturn the matterId, the holdId, and the list of custodians now under hold. Note any custodian that could not be added.',
    },
    {
      name: 'run-discovery-export',
      description:
        'Create a Vault export for a matter using a search query, then retrieve the export files.',
      content:
        '# Run Discovery Export\n\nProduce an export of matching data for eDiscovery or compliance review.\n\n## Steps\n1. Identify or create the matter for the export.\n2. Create an export with the search query, date range, and target accounts/org unit scoped as narrowly as possible.\n3. List exports on the matter and poll until the new export status is completed.\n4. Download the export files once the export is ready.\n\n## Output\nReturn the exportId, its status, and the downloaded file references. Summarize the query and scope used so the export is auditable.',
    },
    {
      name: 'audit-active-holds',
      description:
        'List Vault matters and their holds to produce a custodian preservation status report.',
      content:
        '# Audit Active Holds\n\nGenerate a status report of which matters and custodians are currently preserved.\n\n## Steps\n1. List all matters and capture their IDs, names, and states.\n2. For each open matter, list its holds and the custodians and services covered.\n3. Flag matters with no holds and custodians that appear across multiple matters.\n\n## Output\nReturn a per-matter summary listing holds, services, and custodians, plus a flagged section for matters missing holds. Suitable for a monthly legal review.',
    },
    {
      name: 'close-out-matter',
      description:
        'Wind down a resolved matter by closing it, and permanently delete it once retention requirements are satisfied.',
      content:
        '# Close Out Matter\n\nRetire a matter once the underlying investigation or litigation is resolved.\n\n## Steps\n1. List the holds on the matter and confirm none still need to be preserved; delete any holds that are no longer required.\n2. Close the matter.\n3. If the matter should be permanently removed and your retention policy allows it, delete the closed matter (reopen or undelete if this was done in error).\n\n## Output\nReturn the matterId, its final state, and which holds (if any) were deleted before close-out.',
    },
    {
      name: 'manage-hold-scope',
      description:
        'Add or remove custodians from an existing legal hold as the custodian list for a matter changes.',
      content:
        '# Manage Hold Scope\n\nKeep an existing hold in sync with the current custodian list without recreating it.\n\n## Steps\n1. List the holds on the matter and identify the target hold.\n2. Add newly relevant custodians to the hold by email.\n3. Remove custodians who have left the investigation scope by account ID.\n4. Fetch the hold again by its ID to confirm the accounts field reflects the change.\n\n## Output\nReturn the holdId and the accounts added and removed, noting any that failed with their error status.',
    },
  ],
} as const satisfies BlockMeta
