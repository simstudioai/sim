import { createEloquaBulkDefinitionTool } from '@/tools/eloqua/factories'

export const eloquaCreateContactExportTool = createEloquaBulkDefinitionTool({
  id: 'eloqua_create_contact_export',
  name: 'Create Oracle Eloqua Contact Export',
  description: 'Create a Bulk API contact export definition with dynamic field aliases.',
  path: '/api/bulk/2.0/contacts/exports',
  definitionKind: 'contactExport',
})
