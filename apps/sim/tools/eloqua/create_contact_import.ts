import { createEloquaBulkDefinitionTool } from '@/tools/eloqua/factories'

export const eloquaCreateContactImportTool = createEloquaBulkDefinitionTool({
  id: 'eloqua_create_contact_import',
  name: 'Create Oracle Eloqua Contact Import',
  description: 'Create a Bulk API contact import definition with up to 100 field aliases.',
  path: '/api/bulk/2.0/contacts/imports',
  definitionKind: 'contactImport',
})
