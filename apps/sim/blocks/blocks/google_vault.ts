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
        const { credential, ...rest } = params
        return {
          ...rest,
          credential,
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

    // Create hold inputs
    holdName: { type: 'string', description: 'Name for the hold' },

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
    matters: { type: 'json', description: 'Array of matter objects (for list_matters)' },
    exports: { type: 'json', description: 'Array of export objects (for list_matters_export)' },
    holds: { type: 'json', description: 'Array of hold objects (for list_matters_holds)' },
    matter: { type: 'json', description: 'Created matter object (for create_matters)' },
    export: { type: 'json', description: 'Created export object (for create_matters_export)' },
    hold: { type: 'json', description: 'Created hold object (for create_matters_holds)' },
    file: { type: 'json', description: 'Downloaded export file (UserFile) from execution files' },
    nextPageToken: {
      type: 'string',
      description: 'Token for fetching next page of results (for list operations)',
    },
  },
}
