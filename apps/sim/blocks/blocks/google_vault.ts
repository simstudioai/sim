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
      layout: 'full',
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
      layout: 'full',
      required: true,
      provider: 'google-vault',
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
      layout: 'full',
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
      layout: 'full',
      placeholder: 'Vault export bucket (from cloudStorageSink.files.bucketName)',
      condition: { field: 'operation', value: 'download_export_file' },
      required: true,
    },
    {
      id: 'objectName',
      title: 'Object Name',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Vault export object (from cloudStorageSink.files.objectName)',
      condition: { field: 'operation', value: 'download_export_file' },
      required: true,
    },
    {
      id: 'fileName',
      title: 'File Name (optional)',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Override filename used for storage/display',
      condition: { field: 'operation', value: 'download_export_file' },
    },
    {
      id: 'exportName',
      title: 'Export Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Name for the export',
      condition: { field: 'operation', value: 'create_matters_export' },
      required: true,
    },
    {
      id: 'holdName',
      title: 'Hold Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Name of the hold',
      condition: { field: 'operation', value: 'create_matters_holds' },
      required: true,
    },
    {
      id: 'corpus',
      title: 'Corpus',
      type: 'dropdown',
      layout: 'half',
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
      layout: 'full',
      placeholder: 'Comma-separated emails (alternative to Org Unit)',
      condition: { field: 'operation', value: ['create_matters_holds', 'create_matters_export'] },
    },
    {
      id: 'orgUnitId',
      title: 'Org Unit ID',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Org Unit ID (alternative to emails)',
      condition: { field: 'operation', value: ['create_matters_holds', 'create_matters_export'] },
    },
    {
      id: 'exportId',
      title: 'Export ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Export ID (optional to fetch a specific export)',
      condition: { field: 'operation', value: 'list_matters_export' },
    },
    {
      id: 'holdId',
      title: 'Hold ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Hold ID (optional to fetch a specific hold)',
      condition: { field: 'operation', value: 'list_matters_holds' },
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      layout: 'half',
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
      layout: 'half',
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
      layout: 'full',
      placeholder: 'Enter Matter name',
      condition: { field: 'operation', value: 'create_matters' },
      required: true,
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Optional description for the matter',
      condition: { field: 'operation', value: 'create_matters' },
    },
    // Optional get specific matter by ID
    {
      id: 'matterId',
      title: 'Matter ID',
      type: 'short-input',
      layout: 'full',
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
    // Common outputs
    output: { type: 'json', description: 'Vault API response data' },
    // Download export file output
    file: { type: 'json', description: 'Downloaded export file (UserFile) from execution files' },
  },
}
